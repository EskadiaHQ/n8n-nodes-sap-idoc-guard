package com.logali.idocguard;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class HttpApiTest {
  @TempDir Path temporary;
  private final ObjectMapper mapper = new ObjectMapper();

  @Test void exercisesAuthenticatedHealthSubmitStatusAndInboundRoutes() throws Exception {
    Configuration configuration = TestSupport.configuration(temporary, 0, true);
    TestSupport.FakeTransport transport = new TestSupport.FakeTransport();
    StateStore state = new StateStore(temporary, mapper);
    StateStore.Inbound inbound = state.storeInbound("9001", "DESADV", "DELVRY07",
        "SUPPLIER_1", "PO-1", "digest-inbound", "<payload>secret</payload>");
    GuardService service = new GuardService(configuration, state, transport);
    try (HttpApi api = new HttpApi(configuration, service, transport, mapper)) {
      api.start();
      URI base = URI.create("http://127.0.0.1:" + api.port());

      HttpResponse<String> unauthorized = send(base.resolve("/v1/health"), "GET", null, false);
      assertEquals(401, unauthorized.statusCode());

      JsonNode health = json(send(base.resolve("/v1/health"), "GET", null, true));
      assertEquals("ok", health.path("status").asText());
      assertTrue(health.path("capabilities").path("governed").asBoolean());

      String key = "PO-4500001234-v1";
      Map<String, Object> body = Map.of(
          "operation", "submitPurchaseOrderIdoc",
          "idocXml", TestSupport.XML,
          "idempotencyKey", key,
          "context", Map.of(
              "client", "n8n-sap-idoc-guard", "direction", "outbound", "write", true,
              "confirmation", "SEND submitPurchaseOrderIdoc " + key));
      JsonNode submitted = json(send(base.resolve(
          "/v1/outbound/submitPurchaseOrderIdoc/submit"), "POST", body, true));
      assertEquals("0000000000000001", submitted.path("data").path("docnum").asText());
      assertTrue(submitted.path("meta").path("write").asBoolean());

      JsonNode status = json(send(base.resolve("/v1/status/" + key), "GET", null, true));
      assertEquals("transport_confirmed", status.path("data").path("status").asText());

      JsonNode listed = json(send(base.resolve("/v1/inbound?limit=10"), "GET", null, true));
      assertEquals(inbound.receiptId(), listed.path("data").get(0).path("receiptId").asText());
      assertFalse(listed.toString().contains("secret"));

      JsonNode document = json(send(base.resolve(
          "/v1/inbound/" + inbound.receiptId() + "/document"), "GET", null, true));
      assertEquals("<payload>secret</payload>", document.path("data").path("idocXml").asText());
      assertEquals("inbound-payload", document.path("meta").path("direction").asText());

      Map<String, Object> ack = Map.of(
          "operation", "acknowledgeInboundIdoc", "receiptId", inbound.receiptId(),
          "outcome", "accepted", "reason", "",
          "context", Map.of("direction", "inbound-ack", "write", true,
              "confirmation", "ACK " + inbound.receiptId() + " accepted"));
      JsonNode accepted = json(send(base.resolve(
          "/v1/inbound/" + inbound.receiptId() + "/ack"), "POST", ack, true));
      assertEquals("accepted", accepted.path("data").path("status").asText());
    }
  }

  private JsonNode json(HttpResponse<String> response) throws Exception {
    assertEquals(200, response.statusCode(), response.body());
    return mapper.readTree(response.body());
  }

  private HttpResponse<String> send(
      URI uri, String method, Object body, boolean authorized) throws Exception {
    HttpRequest.Builder request = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(5));
    if (authorized) {
      request.header("Authorization", "Bearer 0123456789abcdef0123456789abcdef")
          .header("X-IDoc-Guard-Mode", "governed")
          .header("X-Correlation-ID", "test-correlation");
    }
    if (body == null) request.GET();
    else request.header("Content-Type", "application/json")
        .method(method, HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)));
    return HttpClient.newHttpClient().send(request.build(), HttpResponse.BodyHandlers.ofString());
  }
}
