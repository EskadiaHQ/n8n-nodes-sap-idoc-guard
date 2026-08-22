package com.logali.idocguard;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsServer;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;

final class HttpApi implements AutoCloseable {
  private final Configuration configuration;
  private final GuardService service;
  private final IdocTransport transport;
  private final ObjectMapper mapper;
  private final HttpServer server;
  private final ExecutorService executor;

  HttpApi(
      Configuration configuration,
      GuardService service,
      IdocTransport transport,
      ObjectMapper mapper
  ) {
    this.configuration = configuration;
    this.service = service;
    this.transport = transport;
    this.mapper = mapper;
    this.server = createServer(configuration);
    this.executor = Executors.newFixedThreadPool(Math.max(4,
        Runtime.getRuntime().availableProcessors()));
    server.setExecutor(executor);
    server.createContext("/", this::handle);
  }

  void start() { server.start(); }

  int port() { return server.getAddress().getPort(); }

  @Override public void close() {
    server.stop(2);
    executor.shutdown();
  }

  private void handle(HttpExchange exchange) throws IOException {
    Instant started = Instant.now();
    String correlationId = correlationId(exchange);
    try {
      authorize(exchange);
      route(exchange, correlationId, started);
    } catch (GuardException error) {
      if (error.status() >= 500) logServerFailure(correlationId, error.code(), error);
      respond(exchange, error.status(), Map.of(
          "error", error.code(), "correlationId", correlationId));
    } catch (IllegalArgumentException error) {
      respond(exchange, 400, Map.of(
          "error", safeCode(error.getMessage(), "INVALID_REQUEST"),
          "correlationId", correlationId));
    } catch (Exception error) {
      logServerFailure(correlationId, "INTERNAL_ERROR", error);
      respond(exchange, 500, Map.of(
          "error", "INTERNAL_ERROR", "correlationId", correlationId));
    } finally {
      exchange.close();
    }
  }

  private static void logServerFailure(String correlationId, String code, Throwable failure) {
    StringBuilder causeChain = new StringBuilder();
    Throwable current = failure;
    for (int depth = 0; current != null && depth < 5; depth++, current = current.getCause()) {
      if (causeChain.length() > 0) causeChain.append(" <- ");
      causeChain.append(current.getClass().getSimpleName());
      String message = current.getMessage();
      if (message != null && !message.isBlank()) {
        causeChain.append(':').append(sanitizeLogMessage(message));
      }
    }
    System.err.printf("IDOC_GUARD_FAILURE correlationId=%s code=%s cause=%s%n",
        correlationId, code, causeChain);
  }

  private static String sanitizeLogMessage(String value) {
    String sanitized = value.replaceAll("[\\r\\n\\t]+", " ")
        .replaceAll("(?i)(password|passwd|token|authorization)[=: ]+[^ ,;]+", "$1=REDACTED");
    return sanitized.length() <= 500 ? sanitized : sanitized.substring(0, 500) + "...";
  }

  private void route(HttpExchange exchange, String correlationId, Instant started)
      throws IOException {
    String method = exchange.getRequestMethod();
    String path = exchange.getRequestURI().getPath();
    if (method.equals("GET") && path.equals("/v1/health")) {
      Map<String, Object> response = new LinkedHashMap<>(service.health());
      response.put("service", "sap-idoc-guard-sidecar");
      response.put("correlationId", correlationId);
      respond(exchange, 200, response);
      return;
    }

    String outboundPrefix = "/v1/outbound/";
    String outboundSuffix = "/submit";
    if (method.equals("POST") && path.startsWith(outboundPrefix)
        && path.endsWith(outboundSuffix)) {
      String operation = decode(path.substring(
          outboundPrefix.length(), path.length() - outboundSuffix.length()));
      JsonNode body = readJson(exchange);
      String bodyOperation = requiredText(body, "operation");
      String xml = requiredText(body, "idocXml");
      String key = requiredText(body, "idempotencyKey");
      validateReference(key, "IDEMPOTENCY_KEY_INVALID");
      JsonNode context = requiredObject(body, "context");
      if (!bodyOperation.equals(operation)
          || !"outbound".equals(text(context, "direction"))
          || !context.path("write").asBoolean(false)
          || !("SEND " + operation + " " + key).equals(text(context, "confirmation"))) {
        throw new GuardException(400, "OUTBOUND_CONTRACT_REQUIRED");
      }
      Map<String, Object> data = service.submit(operation, xml, key);
      respond(exchange, 200, envelope(operation, correlationId, data,
          meta("outbound", true, started)));
      return;
    }

    String statusPrefix = "/v1/status/";
    if (method.equals("GET") && path.startsWith(statusPrefix)) {
      String reference = decode(path.substring(statusPrefix.length()));
      validateReference(reference, "REFERENCE_INVALID");
      respond(exchange, 200, envelope("getIdocStatus", correlationId,
          service.status(reference), meta("status", false, started)));
      return;
    }

    if (method.equals("GET") && path.equals("/v1/inbound")) {
      Map<String, String> query = query(exchange.getRequestURI().getRawQuery());
      int limit = integer(query.getOrDefault("limit", "50"), 1, 100, "PAGINATION_INVALID");
      int cursor = integer(query.getOrDefault("cursor", "0"), 0, Integer.MAX_VALUE,
          "PAGINATION_INVALID");
      Map<String, Object> result = service.listInbound(cursor, limit);
      Map<String, Object> response = envelope("listInboundIdocs", correlationId,
          result.get("data"), meta("inbound-read", false, started));
      if (result.containsKey("nextCursor")) response.put("nextCursor", result.get("nextCursor"));
      respond(exchange, 200, response);
      return;
    }

    String inboundPrefix = "/v1/inbound/";
    String documentSuffix = "/document";
    if (method.equals("GET") && path.startsWith(inboundPrefix)
        && path.endsWith(documentSuffix)) {
      String receiptId = decode(path.substring(
          inboundPrefix.length(), path.length() - documentSuffix.length()));
      validateReference(receiptId, "RECEIPT_ID_INVALID");
      respond(exchange, 200, envelope("getInboundIdoc", correlationId,
          service.inboundDocument(receiptId), meta("inbound-payload", false, started)));
      return;
    }

    String ackSuffix = "/ack";
    if (method.equals("POST") && path.startsWith(inboundPrefix) && path.endsWith(ackSuffix)) {
      String receiptId = decode(path.substring(
          inboundPrefix.length(), path.length() - ackSuffix.length()));
      validateReference(receiptId, "RECEIPT_ID_INVALID");
      JsonNode body = readJson(exchange);
      String outcome = requiredText(body, "outcome");
      String reason = text(body, "reason").trim();
      JsonNode context = requiredObject(body, "context");
      if (!"acknowledgeInboundIdoc".equals(text(body, "operation"))
          || !receiptId.equals(text(body, "receiptId"))
          || !"inbound-ack".equals(text(context, "direction"))
          || !context.path("write").asBoolean(false)
          || !("ACK " + receiptId + " " + outcome).equals(text(context, "confirmation"))) {
        throw new GuardException(400, "ACK_CONTRACT_REQUIRED");
      }
      respond(exchange, 200, envelope("acknowledgeInboundIdoc", correlationId,
          service.acknowledge(receiptId, outcome, reason),
          meta("inbound-ack", true, started)));
      return;
    }
    throw new GuardException(403, "ROUTE_NOT_ALLOWED");
  }

  private void authorize(HttpExchange exchange) {
    String provided = exchange.getRequestHeaders().getFirst("Authorization");
    String expected = "Bearer " + configuration.apiToken();
    if (provided == null || !MessageDigest.isEqual(
        expected.getBytes(StandardCharsets.UTF_8), provided.getBytes(StandardCharsets.UTF_8))) {
      throw new GuardException(401, "UNAUTHORIZED");
    }
    if (!"governed".equals(exchange.getRequestHeaders().getFirst("X-IDoc-Guard-Mode"))) {
      throw new GuardException(400, "GOVERNED_MODE_REQUIRED");
    }
  }

  private JsonNode readJson(HttpExchange exchange) throws IOException {
    String contentType = exchange.getRequestHeaders().getFirst("Content-Type");
    if (contentType == null || !contentType.toLowerCase().startsWith("application/json")) {
      throw new GuardException(415, "CONTENT_TYPE_INVALID");
    }
    byte[] bytes = readLimited(exchange.getRequestBody(), configuration.maxBodyBytes());
    try {
      JsonNode body = mapper.readTree(bytes);
      if (body == null || !body.isObject()) throw new GuardException(400, "INVALID_JSON");
      return body;
    } catch (GuardException error) {
      throw error;
    } catch (Exception error) {
      throw new GuardException(400, "INVALID_JSON", error);
    }
  }

  private static byte[] readLimited(InputStream input, int maximum) throws IOException {
    ByteArrayOutputStream output = new ByteArrayOutputStream();
    byte[] buffer = new byte[8192];
    int read;
    int total = 0;
    while ((read = input.read(buffer)) != -1) {
      total += read;
      if (total > maximum) throw new GuardException(413, "REQUEST_TOO_LARGE");
      output.write(buffer, 0, read);
    }
    return output.toByteArray();
  }

  private Map<String, Object> meta(String direction, boolean write, Instant started) {
    IdocTransport.Backend backend = transport.backend();
    return Map.of(
        "source", "sap-jidoclib",
        "syntheticData", false,
        "direction", direction,
        "readOnly", !write,
        "write", write,
        "durationMs", Duration.between(started, Instant.now()).toMillis(),
        "backend", Map.of(
            "systemId", backend.systemId(), "client", backend.client(),
            "host", backend.host(), "release", backend.release()));
  }

  private static Map<String, Object> envelope(
      String operation,
      String correlationId,
      Object data,
      Map<String, Object> meta
  ) {
    Map<String, Object> response = new LinkedHashMap<>();
    response.put("operation", operation);
    response.put("correlationId", correlationId);
    response.put("data", data);
    response.put("meta", meta);
    return response;
  }

  private void respond(HttpExchange exchange, int status, Object value) throws IOException {
    byte[] bytes = mapper.writeValueAsBytes(value);
    exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
    exchange.getResponseHeaders().set("Cache-Control", "no-store");
    exchange.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
    exchange.sendResponseHeaders(status, bytes.length);
    exchange.getResponseBody().write(bytes);
  }

  private static String correlationId(HttpExchange exchange) {
    String value = exchange.getRequestHeaders().getFirst("X-Correlation-ID");
    if (value == null || !value.matches("[A-Za-z0-9._:/-]{1,128}")) {
      return UUID.randomUUID().toString();
    }
    return value;
  }

  private static String requiredText(JsonNode body, String field) {
    String value = text(body, field);
    if (value.isBlank()) throw new GuardException(400, "REQUIRED_FIELD_MISSING");
    return value;
  }

  private static JsonNode requiredObject(JsonNode body, String field) {
    JsonNode value = body.path(field);
    if (!value.isObject()) throw new GuardException(400, "REQUIRED_CONTEXT_MISSING");
    return value;
  }

  private static String text(JsonNode body, String field) {
    JsonNode value = body.path(field);
    return value.isTextual() ? value.asText() : "";
  }

  private static void validateReference(String value, String code) {
    if (!value.matches("[A-Za-z0-9._:/-]{1,128}")) throw new GuardException(400, code);
  }

  private static int integer(String value, int minimum, int maximum, String code) {
    try {
      int parsed = Integer.parseInt(value);
      if (parsed < minimum || parsed > maximum) throw new NumberFormatException();
      return parsed;
    } catch (NumberFormatException error) {
      throw new GuardException(400, code);
    }
  }

  private static Map<String, String> query(String rawQuery) {
    Map<String, String> result = new LinkedHashMap<>();
    if (rawQuery == null || rawQuery.isBlank()) return result;
    for (String pair : rawQuery.split("&")) {
      String[] parts = pair.split("=", 2);
      result.put(decode(parts[0]), parts.length == 2 ? decode(parts[1]) : "");
    }
    return result;
  }

  private static String decode(String value) {
    return URLDecoder.decode(value, StandardCharsets.UTF_8);
  }

  private static String safeCode(String value, String fallback) {
    return value != null && value.matches("[A-Z][A-Z0-9_]{2,64}") ? value : fallback;
  }

  private static HttpServer createServer(Configuration configuration) {
    try {
      if (configuration.tlsKeystorePath().isBlank()) {
        return HttpServer.create(new InetSocketAddress(
            InetAddress.getLoopbackAddress(), configuration.port()), 0);
      }
      HttpsServer server = HttpsServer.create(new InetSocketAddress(configuration.port()), 0);
      SSLContext context = tlsContext(
          Path.of(configuration.tlsKeystorePath()), configuration.tlsKeystorePassword());
      server.setHttpsConfigurator(new HttpsConfigurator(context));
      return server;
    } catch (Exception error) {
      throw new IllegalStateException("HTTP_SERVER_START_FAILED", error);
    }
  }

  private static SSLContext tlsContext(Path path, String password) throws Exception {
    if (password.isBlank()) throw new IllegalArgumentException("TLS keystore password is required");
    char[] secret = password.toCharArray();
    KeyStore keyStore = KeyStore.getInstance("PKCS12");
    try (InputStream input = Files.newInputStream(path)) { keyStore.load(input, secret); }
    KeyManagerFactory keys = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
    keys.init(keyStore, secret);
    TrustManagerFactory trust = TrustManagerFactory.getInstance(
        TrustManagerFactory.getDefaultAlgorithm());
    trust.init(keyStore);
    SSLContext context = SSLContext.getInstance("TLSv1.3");
    context.init(keys.getKeyManagers(), trust.getTrustManagers(), null);
    return context;
  }
}
