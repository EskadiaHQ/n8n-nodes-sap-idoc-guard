package com.logali.idocguard;

import java.nio.file.Path;
import java.util.Map;
import java.util.Set;

final class TestSupport {
  static final String XML = """
      <ORDERS05><IDOC BEGIN="1"><EDI_DC40 SEGMENT="1">
      <DOCNUM></DOCNUM><MESTYP>ORDERS</MESTYP><IDOCTYP>ORDERS05</IDOCTYP><CIMTYP></CIMTYP>
      <SNDPRT>LS</SNDPRT><SNDPRN>N8N</SNDPRN><RCVPRT>LS</RCVPRT>
      <RCVPRN>S4DCLNT100</RCVPRN><RCVPOR>S4DCLNT100</RCVPOR>
      </EDI_DC40><E1EDK01 SEGMENT="1"><BELNR>4500001234</BELNR></E1EDK01>
      <E1EDP01 SEGMENT="1"><POSEX>000010</POSEX></E1EDP01></IDOC></ORDERS05>
      """;

  private TestSupport() {}

  static Configuration configuration(Path state, int port, boolean inbound) {
    return new Configuration(
        port, "0123456789abcdef0123456789abcdef", "TEST", state,
        262_144, 100, 10, "", "", true, inbound, inbound,
        "submitPurchaseOrderIdoc",
        new IdocPolicy("ORDERS", "ORDERS05", "",
            Set.of("EDI_DC40", "E1EDK01", "E1EDP01"),
            "LS", "N8N", "LS", "S4DCLNT100", "S4DCLNT100", 100),
        new InboundPolicy(Set.of("DESADV"), Set.of("DELVRY07"), Set.of("SUPPLIER_1"),
            1_048_576),
        Map.of(), "TEST_SERVER", Map.of());
  }

  static final class FakeTransport implements IdocTransport {
    int sends;
    boolean fail;

    @Override public void ping() {}

    @Override public Backend backend() {
      return new Backend("A4H", "250", "sap.test", "2025");
    }

    @Override public Receipt send(String idocXml) {
      sends++;
      if (fail) throw new IllegalStateException("network outcome unknown");
      return new Receipt("TID-0001", "0000000000000001", "transport_confirmed");
    }
  }
}
