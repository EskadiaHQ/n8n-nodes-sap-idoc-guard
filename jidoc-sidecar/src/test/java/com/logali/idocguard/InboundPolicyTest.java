package com.logali.idocguard;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.Set;
import org.junit.jupiter.api.Test;

final class InboundPolicyTest {
  private static final String XML = TestSupport.XML
      .replace("<MESTYP>ORDERS</MESTYP>", "<MESTYP>DESADV</MESTYP>")
      .replace("<IDOCTYP>ORDERS05</IDOCTYP>", "<IDOCTYP>DELVRY07</IDOCTYP>")
      .replace("<SNDPRN>N8N</SNDPRN>", "<SNDPRN>SUPPLIER_1</SNDPRN>")
      .replace("<DOCNUM></DOCNUM>", "<DOCNUM>9001</DOCNUM>");

  private final InboundPolicy policy = new InboundPolicy(
      Set.of("DESADV"), Set.of("DELVRY07"), Set.of("SUPPLIER_1"), 1_048_576);

  @Test void acceptsOnlyExactInboundAllowlists() {
    assertEquals("9001", policy.validate(XML).docnum());
    assertEquals("INBOUND_MESSAGE_TYPE_NOT_ALLOWED", assertThrows(IllegalArgumentException.class,
        () -> policy.validate(XML.replace("DESADV", "INVOIC"))).getMessage());
    assertEquals("INBOUND_SENDER_NOT_ALLOWED", assertThrows(IllegalArgumentException.class,
        () -> policy.validate(XML.replace("SUPPLIER_1", "UNKNOWN"))).getMessage());
  }

  @Test void enforcesSingleDocumentPerTransaction() {
    String duplicated = XML.replace("</ORDERS05>", XML.substring(
        XML.indexOf("<IDOC "), XML.indexOf("</IDOC>") + 7) + "</ORDERS05>");
    assertEquals("INBOUND_IDOC_DOCUMENT_COUNT_INVALID",
        assertThrows(IllegalArgumentException.class, () -> policy.validate(duplicated)).getMessage());
  }
}
