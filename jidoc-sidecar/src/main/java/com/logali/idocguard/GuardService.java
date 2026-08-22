package com.logali.idocguard;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

final class GuardService implements AutoCloseable {
  private final Configuration configuration;
  private final StateStore state;
  private final IdocTransport transport;
  private final ThreadPoolExecutor sapCalls;

  GuardService(Configuration configuration, StateStore state, IdocTransport transport) {
    this.configuration = configuration;
    this.state = state;
    this.transport = transport;
    this.sapCalls = new ThreadPoolExecutor(
        2, 4, 30, TimeUnit.SECONDS, new ArrayBlockingQueue<>(32), runnable -> {
          Thread thread = new Thread(runnable, "sap-idoc-guard-jco");
          thread.setDaemon(true);
          return thread;
        }, new ThreadPoolExecutor.AbortPolicy());
  }

  @Override public void close() { sapCalls.shutdownNow(); }

  Map<String, Object> health() {
    bounded(() -> { transport.ping(); return null; }, "SAP_CONNECTION_TIMEOUT");
    IdocTransport.Backend backend = transport.backend();
    return Map.of(
        "status", "ok",
        "version", "0.1.4",
        "capabilities", Map.of(
            "idoc", true,
            "governed", true,
            "outbound", configuration.outboundEnabled(),
            "statusRead", true,
            "inboundPull", configuration.inboundEnabled(),
            "inboundPayloadRead", configuration.inboundPayloadReadEnabled(),
            "inboundAck", configuration.inboundEnabled(),
            "operations", List.of(
                configuration.outboundOperation(), "getIdocStatus",
                "listInboundIdocs", "getInboundIdoc", "acknowledgeInboundIdoc")),
        "backend", Map.of(
            "systemId", backend.systemId(), "client", backend.client(),
            "host", backend.host(), "release", backend.release()));
  }

  Map<String, Object> submit(String operation, String xml, String idempotencyKey) {
    if (!configuration.outboundEnabled()) throw new GuardException(403, "OUTBOUND_DISABLED");
    if (!configuration.outboundOperation().equals(operation)) {
      throw new GuardException(403, "OPERATION_NOT_ALLOWED");
    }
    IdocPolicy.Validation validation;
    try {
      validation = configuration.outboundPolicy().validate(xml);
    } catch (IllegalArgumentException error) {
      throw new GuardException(400, error.getMessage(), error);
    }
    String payloadDigest = sha256(xml);
    StateStore.Reservation reservation = state.reserve(
        idempotencyKey, payloadDigest, operation, validation);
    if (reservation.duplicate()) return submissionData(reservation.submission(), true);
    try {
      StateStore.Submission completed = state.complete(
          idempotencyKey, bounded(() -> transport.send(xml), "IDOC_TRANSPORT_TIMEOUT"));
      return submissionData(completed, false);
    } catch (GuardException error) {
      if (error.code().equals("SAP_CALL_CAPACITY_EXHAUSTED")) {
        state.cancelBeforeSend(idempotencyKey);
        throw error;
      }
      state.outcomeUnknown(idempotencyKey);
      throw new GuardException(502, "IDOC_TRANSPORT_OUTCOME_UNKNOWN", error);
    } catch (RuntimeException error) {
      state.outcomeUnknown(idempotencyKey);
      throw new GuardException(502, "IDOC_TRANSPORT_OUTCOME_UNKNOWN", error);
    }
  }

  Map<String, Object> status(String reference) {
    StateStore.Submission submission = state.findSubmission(reference)
        .orElseThrow(() -> new GuardException(404, "IDOC_NOT_FOUND"));
    Map<String, Object> data = submissionData(submission, false);
    data.remove("duplicate");
    data.remove("tid");
    return data;
  }

  Map<String, Object> listInbound(int offset, int limit) {
    if (!configuration.inboundEnabled()) throw new GuardException(403, "INBOUND_DISABLED");
    List<Map<String, Object>> records = state.listPending(offset, limit).stream()
        .map(GuardService::inboundSummary)
        .toList();
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("data", records);
    if (offset + records.size() < state.pendingCount()) {
      result.put("nextCursor", Integer.toString(offset + records.size()));
    }
    return result;
  }

  Map<String, Object> acknowledge(String receiptId, String outcome, String reason) {
    if (!configuration.inboundEnabled()) throw new GuardException(403, "INBOUND_DISABLED");
    if (!List.of("accepted", "rejected", "retry").contains(outcome)) {
      throw new GuardException(400, "ACK_OUTCOME_INVALID");
    }
    if (!outcome.equals("accepted") && reason.isBlank()) {
      throw new GuardException(400, "ACK_REASON_REQUIRED");
    }
    if (reason.length() > 500) throw new GuardException(400, "ACK_REASON_TOO_LONG");
    StateStore.Acknowledgement acknowledgement = state.acknowledge(receiptId, outcome, reason);
    return Map.of(
        "receiptId", receiptId,
        "outcome", outcome,
        "status", acknowledgement.inbound().status(),
        "duplicate", acknowledgement.duplicate());
  }

  Map<String, Object> inboundDocument(String receiptId) {
    if (!configuration.inboundPayloadReadEnabled()) {
      throw new GuardException(403, "INBOUND_PAYLOAD_READ_DISABLED");
    }
    StateStore.Inbound inbound = state.inbound(receiptId);
    Map<String, Object> data = inboundSummary(inbound);
    data.put("idocXml", inbound.payloadXml());
    return data;
  }

  private static Map<String, Object> submissionData(
      StateStore.Submission submission, boolean duplicate) {
    Map<String, Object> data = new LinkedHashMap<>();
    data.put("requestId", submission.requestId());
    data.put("idempotencyKey", submission.idempotencyKey());
    data.put("tid", submission.tid());
    data.put("docnum", submission.docnum());
    data.put("messageType", submission.messageType());
    data.put("basicType", submission.basicType());
    data.put("status", submission.status());
    data.put("statusHistory", submission.statusHistory());
    data.put("duplicate", duplicate);
    return data;
  }

  private static Map<String, Object> inboundSummary(StateStore.Inbound inbound) {
    Map<String, Object> data = new LinkedHashMap<>();
    data.put("receiptId", inbound.receiptId());
    data.put("docnum", inbound.docnum());
    data.put("messageType", inbound.messageType());
    data.put("basicType", inbound.basicType());
    data.put("senderPartner", inbound.senderPartner());
    data.put("correlationId", inbound.correlationId());
    data.put("payloadDigest", inbound.payloadDigest());
    data.put("status", inbound.status());
    data.put("receivedAt", inbound.receivedAt());
    return data;
  }

  static String sha256(String value) {
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256")
          .digest(value.getBytes(StandardCharsets.UTF_8));
      return java.util.HexFormat.of().formatHex(digest);
    } catch (Exception impossible) {
      throw new IllegalStateException(impossible);
    }
  }

  private <T> T bounded(Callable<T> operation, String timeoutCode) {
    Future<T> future;
    try {
      future = sapCalls.submit(operation);
    } catch (RuntimeException saturated) {
      throw new GuardException(503, "SAP_CALL_CAPACITY_EXHAUSTED", saturated);
    }
    try {
      return future.get(configuration.requestTimeoutSeconds(), TimeUnit.SECONDS);
    } catch (TimeoutException timeout) {
      future.cancel(true);
      throw new GuardException(504, timeoutCode, timeout);
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      throw new GuardException(503, "SAP_CALL_INTERRUPTED", interrupted);
    } catch (ExecutionException failed) {
      Throwable cause = failed.getCause();
      if (cause instanceof RuntimeException runtime) throw runtime;
      throw new IllegalStateException("SAP_CALL_FAILED", cause);
    }
  }
}
