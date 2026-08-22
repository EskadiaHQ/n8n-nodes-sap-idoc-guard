package com.logali.idocguard;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Path;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class StateStoreTidTest {
  @TempDir Path temporary;

  @Test void promotesInboundOnlyOnTrfcCommitAndPersistsDuplicateProtection() {
    StateStore store = new StateStore(temporary, new ObjectMapper());
    assertTrue(store.checkTid("TID-1"));
    store.stageTid("TID-1", inbound());
    assertFalse(store.checkTid("TID-1"));
    assertEquals(0, store.pendingCount());
    store.commitTid("TID-1");
    assertEquals(1, store.pendingCount());
    store.confirmTid("TID-1");
    assertFalse(new StateStore(temporary, new ObjectMapper()).checkTid("TID-1"));
  }

  @Test void discardsRolledBackTransactionAndAllowsSapRetry() {
    StateStore store = new StateStore(temporary, new ObjectMapper());
    store.stageTid("TID-2", inbound());
    store.rollbackTid("TID-2");
    assertTrue(store.checkTid("TID-2"));
    assertEquals(0, store.pendingCount());
  }

  private StateStore.Inbound inbound() {
    return new StateStore.Inbound("receipt-1", "9001", "DESADV", "DELVRY07",
        "SUPPLIER_1", "TID", "digest", "pending", Instant.now().toString(),
        "<xml/>", "", "", "");
  }
}
