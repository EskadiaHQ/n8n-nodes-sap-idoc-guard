package com.logali.idocguard;

interface IdocTransport extends AutoCloseable {
  record Backend(String systemId, String client, String host, String release) {}
  record Receipt(String tid, String docnum, String status) {}

  void ping();
  Backend backend();
  Receipt send(String idocXml);
  @Override default void close() {}
}
