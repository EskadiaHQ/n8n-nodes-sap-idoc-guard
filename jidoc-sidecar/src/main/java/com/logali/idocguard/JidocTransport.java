package com.logali.idocguard;

import java.util.Properties;

final class JidocTransport implements IdocTransport {
  private final Object destination;

  JidocTransport(Configuration configuration) {
    Properties properties = new Properties();
    properties.putAll(configuration.jcoProperties());
    JcoReflection.registerDestinationProvider(configuration.destinationName(), properties);
    destination = JcoReflection.invokeStatic(
        "com.sap.conn.jco.JCoDestinationManager", "getDestination", configuration.destinationName());
    // Force both proprietary runtimes to be present at startup, not on the first write.
    JcoReflection.invokeStatic("com.sap.conn.idoc.jco.JCoIDoc", "getIDocFactory");
  }

  @Override public void ping() {
    JcoReflection.invoke(destination, "ping");
    JcoReflection.invokeStatic("com.sap.conn.idoc.jco.JCoIDoc", "getIDocRepository", destination);
  }

  @Override public Backend backend() {
    Object attributes = JcoReflection.invoke(destination, "getAttributes");
    return new Backend(
        attribute(attributes, "getSystemID"),
        attribute(attributes, "getClient"),
        attribute(attributes, "getPartnerHost"),
        attribute(attributes, "getRelease"));
  }

  @Override public Receipt send(String idocXml) {
    Object repository = JcoReflection.invokeStatic(
        "com.sap.conn.idoc.jco.JCoIDoc", "getIDocRepository", destination);
    Object factory = JcoReflection.invokeStatic(
        "com.sap.conn.idoc.jco.JCoIDoc", "getIDocFactory");
    Object processor = JcoReflection.invoke(factory, "getIDocXMLProcessor");
    Object documents = JcoReflection.invoke(processor, "parse", repository, idocXml);
    String tid = String.valueOf(JcoReflection.invoke(destination, "createTID"));
    char version = JcoReflection.staticChar(
        "com.sap.conn.idoc.IDocFactory", "IDOC_VERSION_DEFAULT");
    try {
      JcoReflection.invokeStatic(
          "com.sap.conn.idoc.jco.JCoIDoc", "send", documents, version, destination, tid);
      JcoReflection.invoke(destination, "confirmTID", tid);
      return new Receipt(tid, documentNumber(documents), "transport_confirmed");
    } catch (RuntimeException error) {
      // No automatic retry is attempted: the effect may be unknown after a transport failure.
      throw new IllegalStateException("IDOC_TRANSPORT_OUTCOME_UNKNOWN", error);
    }
  }

  private static String documentNumber(Object documents) {
    try {
      Object first = JcoReflection.invoke(documents, "get", 0);
      Object value = JcoReflection.invoke(first, "getIDocNumber");
      return value == null ? "" : value.toString().trim();
    } catch (RuntimeException ignored) {
      return "";
    }
  }

  private static String attribute(Object attributes, String method) {
    Object value = JcoReflection.invoke(attributes, method);
    return value == null ? "" : value.toString().trim();
  }
}
