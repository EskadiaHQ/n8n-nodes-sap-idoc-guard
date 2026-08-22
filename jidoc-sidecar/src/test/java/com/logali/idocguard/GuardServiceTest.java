package com.logali.idocguard;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class GuardServiceTest {
  @TempDir Path temporary;

  @Test void persistsIdempotencyAndReturnsOriginalReceipt() {
    Configuration configuration = TestSupport.configuration(temporary, 0, true);
    TestSupport.FakeTransport transport = new TestSupport.FakeTransport();
    GuardService service = service(configuration, transport);
    Map<String, Object> first = service.submit(
        "submitPurchaseOrderIdoc", TestSupport.XML, "PO-4500001234-v1");
    Map<String, Object> duplicate = service.submit(
        "submitPurchaseOrderIdoc", TestSupport.XML, "PO-4500001234-v1");
    assertEquals(1, transport.sends);
    assertEquals(false, first.get("duplicate"));
    assertEquals(true, duplicate.get("duplicate"));
    assertEquals(first.get("requestId"), duplicate.get("requestId"));

    GuardService afterRestart = service(configuration, transport);
    assertEquals(true, afterRestart.submit(
        "submitPurchaseOrderIdoc", TestSupport.XML, "PO-4500001234-v1").get("duplicate"));
    assertEquals(1, transport.sends);
  }

  @Test void blocksChangedPayloadForSameBusinessKey() {
    GuardService service = service(TestSupport.configuration(temporary, 0, true),
        new TestSupport.FakeTransport());
    service.submit("submitPurchaseOrderIdoc", TestSupport.XML, "PO-1-v1");
    GuardException error = assertThrows(GuardException.class,
        () -> service.submit("submitPurchaseOrderIdoc",
            TestSupport.XML.replace("4500001234", "4500009999"), "PO-1-v1"));
    assertEquals("IDEMPOTENCY_CONFLICT", error.code());
  }

  @Test void recordsUnknownTransportOutcomeAndRefusesBlindRetry() {
    TestSupport.FakeTransport transport = new TestSupport.FakeTransport();
    transport.fail = true;
    GuardService service = service(TestSupport.configuration(temporary, 0, true), transport);
    assertEquals("IDOC_TRANSPORT_OUTCOME_UNKNOWN", assertThrows(GuardException.class,
        () -> service.submit("submitPurchaseOrderIdoc", TestSupport.XML, "PO-2-v1")).code());
    transport.fail = false;
    assertEquals("IDEMPOTENCY_PENDING_RECONCILIATION", assertThrows(GuardException.class,
        () -> service.submit("submitPurchaseOrderIdoc", TestSupport.XML, "PO-2-v1")).code());
    assertEquals(1, transport.sends);
    assertEquals("outcome_unknown", service.status("PO-2-v1").get("status"));
  }

  @Test void listsAndAcknowledgesInboundWithoutExposingPayload() {
    Configuration configuration = TestSupport.configuration(temporary, 0, true);
    ObjectMapper mapper = new ObjectMapper();
    StateStore store = new StateStore(temporary, mapper);
    StateStore.Inbound inbound = store.storeInbound(
        "9001", "DESADV", "DELVRY07", "SUPPLIER_1", "PO-1",
        GuardService.sha256(TestSupport.XML), TestSupport.XML);
    GuardService service = new GuardService(configuration, store, new TestSupport.FakeTransport());
    Map<String, Object> listed = service.listInbound(0, 50);
    var row = (Map<?, ?>) ((java.util.List<?>) listed.get("data")).getFirst();
    assertTrue(!row.containsKey("payloadXml"));
    assertEquals("accepted", service.acknowledge(inbound.receiptId(), "accepted", "").get("status"));
    assertEquals(true, service.acknowledge(inbound.receiptId(), "accepted", "").get("duplicate"));
  }

  private GuardService service(Configuration configuration, IdocTransport transport) {
    return new GuardService(configuration,
        new StateStore(configuration.stateDirectory(), new ObjectMapper()), transport);
  }
}
