package com.logali.idocguard;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.nio.file.Path;
import org.junit.jupiter.api.Test;

final class IdocPolicyTest {
  private final IdocPolicy policy = TestSupport.configuration(Path.of("unused"), 0, true)
      .outboundPolicy();

  @Test void validatesExactContractAndCountsOnlySegments() {
    IdocPolicy.Validation result = policy.validate(TestSupport.XML);
    assertEquals("ORDERS", result.messageType());
    assertEquals(3, result.segmentCount());
  }

  @Test void rejectsUnknownSegmentButNotOrdinaryFieldTags() {
    IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
        () -> policy.validate(TestSupport.XML.replace("</E1EDK01>",
            "<ZSECRET SEGMENT=\"1\">x</ZSECRET></E1EDK01>")));
    assertEquals("IDOC_SEGMENT_NOT_ALLOWED", error.getMessage());
  }

  @Test void rejectsExternalEntitiesBeforeParsing() {
    IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
        () -> policy.validate("<!DOCTYPE foo [<!ENTITY xxe SYSTEM \"file:///etc/passwd\">]>"
            + TestSupport.XML));
    assertEquals("XML_EXTERNAL_ENTITY_REJECTED", error.getMessage());
  }

  @Test void rejectsRootThatDoesNotMatchBasicType() {
    IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
        () -> policy.validate(TestSupport.XML
            .replace("<ORDERS05>", "<IDOCS>")
            .replace("</ORDERS05>", "</IDOCS>")));
    assertEquals("IDOC_ROOT_TYPE_MISMATCH", error.getMessage());
  }

  @Test void rejectsChangedPartnerAndPreassignedDocumentNumber() {
    assertEquals("IDOC_RECEIVER_MISMATCH", assertThrows(IllegalArgumentException.class,
        () -> policy.validate(TestSupport.XML.replace("S4DCLNT100</RCVPRN>",
            "OTHER</RCVPRN>"))).getMessage());
    assertEquals("IDOC_DOCNUM_MUST_BE_EMPTY", assertThrows(IllegalArgumentException.class,
        () -> policy.validate(TestSupport.XML.replace("<DOCNUM></DOCNUM>",
            "<DOCNUM>0001</DOCNUM>"))).getMessage());
  }
}
