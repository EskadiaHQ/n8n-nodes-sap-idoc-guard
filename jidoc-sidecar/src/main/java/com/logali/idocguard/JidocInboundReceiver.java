package com.logali.idocguard;

import java.io.StringWriter;
import java.lang.reflect.Proxy;
import java.time.Instant;
import java.util.Properties;
import java.util.UUID;

final class JidocInboundReceiver implements AutoCloseable {
  private final Configuration configuration;
  private final StateStore state;
  private final Object server;

  JidocInboundReceiver(Configuration configuration, StateStore state) {
    this.configuration = configuration;
    this.state = state;
    if (!configuration.inboundEnabled()) {
      server = null;
      return;
    }
    Properties properties = new Properties();
    properties.putAll(configuration.jcoServerProperties());
    JcoReflection.registerServerProvider(configuration.serverName(), properties);
    server = JcoReflection.invokeStatic(
        "com.sap.conn.idoc.jco.JCoIDoc", "getServer", configuration.serverName());
    installHandlers();
  }

  void start() {
    if (server != null) JcoReflection.invoke(server, "start");
  }

  @Override public void close() {
    if (server != null) JcoReflection.invoke(server, "stop");
  }

  private void installHandlers() {
    Class<?> handlerType = JcoReflection.type("com.sap.conn.idoc.jco.JCoIDocHandler");
    Object handler = Proxy.newProxyInstance(handlerType.getClassLoader(),
        new Class<?>[]{handlerType}, (proxy, method, args) -> {
          if (method.getName().equals("handleRequest")) {
            handle(args[0], args[1]);
            return null;
          }
          return objectMethod(proxy, method.getName(), args, "SapIdocGuardInboundHandler");
        });

    Class<?> factoryType = JcoReflection.type("com.sap.conn.idoc.jco.JCoIDocHandlerFactory");
    Object factory = Proxy.newProxyInstance(factoryType.getClassLoader(),
        new Class<?>[]{factoryType}, (proxy, method, args) -> {
          if (method.getName().equals("getIDocHandler")) return handler;
          return objectMethod(proxy, method.getName(), args, "SapIdocGuardInboundHandlerFactory");
        });
    JcoReflection.invoke(server, "setIDocHandlerFactory", factory);

    Class<?> tidType = JcoReflection.type("com.sap.conn.jco.server.JCoServerTIDHandler");
    Object tidHandler = Proxy.newProxyInstance(tidType.getClassLoader(),
        new Class<?>[]{tidType}, (proxy, method, args) -> {
          String name = method.getName();
          if (name.equals("checkTID")) return state.checkTid(String.valueOf(args[1]));
          if (name.equals("commit")) { state.commitTid(String.valueOf(args[1])); return null; }
          if (name.equals("rollback")) { state.rollbackTid(String.valueOf(args[1])); return null; }
          if (name.equals("confirmTID")) { state.confirmTid(String.valueOf(args[1])); return null; }
          return objectMethod(proxy, name, args, "SapIdocGuardTIDHandler");
        });
    JcoReflection.invoke(server, "setTIDHandler", tidHandler);
    int connections = Integer.parseInt(
        configuration.jcoServerProperties().getOrDefault("jco.server.connection_count", "2"));
    JcoReflection.invoke(server, "setConnectionCount", connections);
  }

  private void handle(Object context, Object documents) {
    String tid = String.valueOf(JcoReflection.invoke(context, "getTID"));
    String xml = render(documents);
    InboundPolicy.Validation validation = configuration.inboundPolicy().validate(xml);
    String digest = GuardService.sha256(xml);
    StateStore.Inbound staged = new StateStore.Inbound(
        UUID.randomUUID().toString(), validation.docnum(), validation.messageType(),
        validation.basicType(), validation.senderPartner(), tid, digest, "pending",
        Instant.now().toString(), xml, "", "", "");
    state.stageTid(tid, staged);
  }

  private static String render(Object documents) {
    Object factory = JcoReflection.invokeStatic(
        "com.sap.conn.idoc.jco.JCoIDoc", "getIDocFactory");
    Object processor = JcoReflection.invoke(factory, "getIDocXMLProcessor");
    int format = JcoReflection.staticInt(
        "com.sap.conn.idoc.IDocXMLProcessor", "RENDER_WITH_TABS_AND_CRLF");
    StringWriter output = new StringWriter();
    JcoReflection.invoke(processor, "render", documents, output, format);
    return output.toString();
  }

  private static Object objectMethod(
      Object proxy, String name, Object[] args, String description) {
    return switch (name) {
      case "toString" -> description;
      case "hashCode" -> System.identityHashCode(proxy);
      case "equals" -> proxy == args[0];
      default -> null;
    };
  }
}
