package com.logali.idocguard;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermission;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

final class StateStore {
  record StatusEvent(String code, String at) {}

  record Submission(
      String requestId,
      String idempotencyKey,
      String payloadDigest,
      String operation,
      String messageType,
      String basicType,
      String extension,
      String tid,
      String docnum,
      String status,
      String createdAt,
      String updatedAt,
      List<StatusEvent> statusHistory
  ) {}

  record Reservation(Submission submission, boolean duplicate) {}

  record Inbound(
      String receiptId,
      String docnum,
      String messageType,
      String basicType,
      String senderPartner,
      String correlationId,
      String payloadDigest,
      String status,
      String receivedAt,
      String payloadXml,
      String ackOutcome,
      String ackReason,
      String acknowledgedAt
  ) {}

  record Acknowledgement(Inbound inbound, boolean duplicate) {}

  record TidState(String state, String updatedAt, Inbound stagedInbound) {}

  private final ObjectMapper mapper;
  private final Path submissionsFile;
  private final Path inboundFile;
  private final Path tidsFile;
  private final Map<String, Submission> submissions;
  private final Map<String, Inbound> inbound;
  private final Map<String, TidState> tids;

  StateStore(Path directory, ObjectMapper mapper) {
    this.mapper = mapper;
    this.submissionsFile = directory.resolve("submissions.json");
    this.inboundFile = directory.resolve("inbound.json");
    this.tidsFile = directory.resolve("tids.json");
    try {
      Files.createDirectories(directory);
      restrict(directory, Set.of(
          PosixFilePermission.OWNER_READ,
          PosixFilePermission.OWNER_WRITE,
          PosixFilePermission.OWNER_EXECUTE));
      submissions = readMap(submissionsFile, new TypeReference<>() {});
      inbound = readMap(inboundFile, new TypeReference<>() {});
      tids = readMap(tidsFile, new TypeReference<>() {});
    } catch (IOException error) {
      throw new IllegalStateException("STATE_STORE_UNAVAILABLE", error);
    }
  }

  synchronized Reservation reserve(
      String idempotencyKey,
      String payloadDigest,
      String operation,
      IdocPolicy.Validation validation
  ) {
    Submission previous = submissions.get(idempotencyKey);
    if (previous != null) {
      if (!previous.payloadDigest().equals(payloadDigest)) {
        throw new GuardException(409, "IDEMPOTENCY_CONFLICT");
      }
      if (previous.status().equals("pending_send") || previous.status().equals("outcome_unknown")) {
        throw new GuardException(409, "IDEMPOTENCY_PENDING_RECONCILIATION");
      }
      return new Reservation(previous, true);
    }
    String now = Instant.now().toString();
    Submission created = new Submission(
        UUID.randomUUID().toString(), idempotencyKey, payloadDigest, operation,
        validation.messageType(), validation.basicType(), validation.extension(), "", "",
        "pending_send", now, now, List.of(new StatusEvent("accepted", now)));
    submissions.put(idempotencyKey, created);
    persistSubmissions();
    return new Reservation(created, false);
  }

  synchronized Submission complete(String idempotencyKey, IdocTransport.Receipt receipt) {
    Submission current = requiredSubmission(idempotencyKey);
    String now = Instant.now().toString();
    List<StatusEvent> events = append(current.statusHistory(), receipt.status(), now);
    Submission completed = new Submission(
        current.requestId(), current.idempotencyKey(), current.payloadDigest(), current.operation(),
        current.messageType(), current.basicType(), current.extension(), receipt.tid(), receipt.docnum(),
        receipt.status(), current.createdAt(), now, events);
    submissions.put(idempotencyKey, completed);
    persistSubmissions();
    return completed;
  }

  synchronized Submission outcomeUnknown(String idempotencyKey) {
    Submission current = requiredSubmission(idempotencyKey);
    String now = Instant.now().toString();
    Submission unknown = new Submission(
        current.requestId(), current.idempotencyKey(), current.payloadDigest(), current.operation(),
        current.messageType(), current.basicType(), current.extension(), current.tid(), current.docnum(),
        "outcome_unknown", current.createdAt(), now,
        append(current.statusHistory(), "outcome_unknown", now));
    submissions.put(idempotencyKey, unknown);
    persistSubmissions();
    return unknown;
  }

  synchronized void cancelBeforeSend(String idempotencyKey) {
    Submission current = requiredSubmission(idempotencyKey);
    if (!current.status().equals("pending_send")) {
      throw new IllegalStateException("SUBMISSION_ALREADY_ATTEMPTED");
    }
    submissions.remove(idempotencyKey);
    persistSubmissions();
  }

  synchronized Optional<Submission> findSubmission(String reference) {
    return submissions.values().stream()
        .filter(value -> value.idempotencyKey().equals(reference)
            || value.requestId().equals(reference)
            || (!value.docnum().isBlank() && value.docnum().equals(reference))
            || (!value.tid().isBlank() && value.tid().equals(reference)))
        .findFirst();
  }

  synchronized Inbound storeInbound(
      String docnum,
      String messageType,
      String basicType,
      String senderPartner,
      String correlationId,
      String payloadDigest,
      String payloadXml
  ) {
    Optional<Inbound> duplicate = inbound.values().stream()
        .filter(value -> value.payloadDigest().equals(payloadDigest))
        .findFirst();
    if (duplicate.isPresent()) return duplicate.get();
    String now = Instant.now().toString();
    Inbound created = new Inbound(
        UUID.randomUUID().toString(), clean(docnum), clean(messageType), clean(basicType),
        clean(senderPartner), clean(correlationId), payloadDigest, "pending", now, payloadXml,
        "", "", "");
    inbound.put(created.receiptId(), created);
    persistInbound();
    return created;
  }

  synchronized List<Inbound> listPending(int offset, int limit) {
    return inbound.values().stream()
        .filter(value -> value.status().equals("pending") || value.status().equals("pending_retry"))
        .sorted(Comparator.comparing(Inbound::receivedAt).thenComparing(Inbound::receiptId))
        .skip(offset)
        .limit(limit)
        .toList();
  }

  synchronized int pendingCount() {
    return Math.toIntExact(inbound.values().stream()
        .filter(value -> value.status().equals("pending") || value.status().equals("pending_retry"))
        .count());
  }

  synchronized Inbound inbound(String receiptId) {
    Inbound value = inbound.get(receiptId);
    if (value == null) throw new GuardException(404, "RECEIPT_NOT_FOUND");
    return value;
  }

  synchronized Acknowledgement acknowledge(String receiptId, String outcome, String reason) {
    Inbound current = inbound.get(receiptId);
    if (current == null) throw new GuardException(404, "RECEIPT_NOT_FOUND");
    if (!current.ackOutcome().isBlank()) {
      if (!current.ackOutcome().equals(outcome) || !current.ackReason().equals(reason)) {
        throw new GuardException(409, "ACK_CONFLICT");
      }
      return new Acknowledgement(current, true);
    }
    String status = outcome.equals("retry") ? "pending_retry" : outcome;
    Inbound updated = new Inbound(
        current.receiptId(), current.docnum(), current.messageType(), current.basicType(),
        current.senderPartner(), current.correlationId(), current.payloadDigest(), status,
        current.receivedAt(), current.payloadXml(), outcome, reason, Instant.now().toString());
    inbound.put(receiptId, updated);
    persistInbound();
    return new Acknowledgement(updated, false);
  }

  synchronized boolean checkTid(String tid) {
    TidState current = tids.get(tid);
    return current == null || current.state().equals("rolled_back");
  }

  synchronized void stageTid(String tid, Inbound staged) {
    TidState current = tids.get(tid);
    if (current != null && !current.state().equals("rolled_back")) {
      throw new IllegalStateException("TID_ALREADY_PROCESSED");
    }
    tids.put(tid, new TidState("staged", Instant.now().toString(), staged));
    persistTids();
  }

  synchronized void commitTid(String tid) {
    TidState current = tids.get(tid);
    if (current == null || current.stagedInbound() == null) {
      throw new IllegalStateException("TID_STAGE_MISSING");
    }
    Inbound staged = current.stagedInbound();
    Optional<Inbound> duplicate = inbound.values().stream()
        .filter(value -> value.payloadDigest().equals(staged.payloadDigest()))
        .findFirst();
    if (duplicate.isEmpty()) {
      inbound.put(staged.receiptId(), staged);
      persistInbound();
    }
    tids.put(tid, new TidState("committed", Instant.now().toString(), null));
    persistTids();
  }

  synchronized void rollbackTid(String tid) {
    tids.put(tid, new TidState("rolled_back", Instant.now().toString(), null));
    persistTids();
  }

  synchronized void confirmTid(String tid) {
    TidState current = tids.get(tid);
    if (current == null || !current.state().equals("committed")) {
      throw new IllegalStateException("TID_COMMIT_MISSING");
    }
    tids.put(tid, new TidState("confirmed", Instant.now().toString(), null));
    persistTids();
  }

  private Submission requiredSubmission(String idempotencyKey) {
    Submission current = submissions.get(idempotencyKey);
    if (current == null) throw new IllegalStateException("SUBMISSION_RESERVATION_MISSING");
    return current;
  }

  private <T> Map<String, T> readMap(Path path, TypeReference<Map<String, T>> type)
      throws IOException {
    if (!Files.exists(path)) return new LinkedHashMap<>();
    return new LinkedHashMap<>(mapper.readValue(path.toFile(), type));
  }

  private void persistSubmissions() { writeAtomic(submissionsFile, submissions); }
  private void persistInbound() { writeAtomic(inboundFile, inbound); }
  private void persistTids() { writeAtomic(tidsFile, tids); }

  private void writeAtomic(Path destination, Object value) {
    Path temporary = destination.resolveSibling(destination.getFileName() + ".tmp");
    try {
      byte[] json = mapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(value);
      Files.write(temporary, json, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
      try {
        Files.move(temporary, destination, StandardCopyOption.ATOMIC_MOVE,
            StandardCopyOption.REPLACE_EXISTING);
      } catch (IOException unsupportedAtomicMove) {
        Files.move(temporary, destination, StandardCopyOption.REPLACE_EXISTING);
      }
      restrict(destination, Set.of(
          PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE));
    } catch (IOException error) {
      throw new IllegalStateException("STATE_STORE_WRITE_FAILED", error);
    }
  }

  private static List<StatusEvent> append(List<StatusEvent> source, String code, String at) {
    List<StatusEvent> copy = new ArrayList<>(source);
    copy.add(new StatusEvent(code, at));
    return List.copyOf(copy);
  }

  private static String clean(String value) {
    return value == null ? "" : value.trim();
  }

  private static void restrict(Path path, Set<PosixFilePermission> permissions) {
    try {
      Files.setPosixFilePermissions(path, permissions);
    } catch (UnsupportedOperationException | IOException ignored) {
      // Non-POSIX hosts must enforce equivalent ACLs at deployment time.
    }
  }
}
