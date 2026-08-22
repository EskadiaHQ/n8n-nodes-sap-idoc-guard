package com.logali.idocguard;

import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;

record Configuration(
    int port,
    String apiToken,
    String destinationName,
    Path stateDirectory,
    int maxBodyBytes,
    int maxSegments,
    int requestTimeoutSeconds,
    String tlsKeystorePath,
    String tlsKeystorePassword,
    boolean outboundEnabled,
    boolean inboundEnabled,
    boolean inboundPayloadReadEnabled,
    String outboundOperation,
    IdocPolicy outboundPolicy,
    InboundPolicy inboundPolicy,
    Map<String, String> jcoProperties,
    String serverName,
    Map<String, String> jcoServerProperties
) {
  static Configuration fromEnvironment() {
    Map<String, String> env = System.getenv();
    String token = require(env, "IDOC_GUARD_API_TOKEN");
    if (token.length() < 32) {
      throw new IllegalArgumentException("IDOC_GUARD_API_TOKEN must contain at least 32 characters");
    }
    boolean outbound = bool(env, "IDOC_GUARD_ENABLE_OUTBOUND", false);
    boolean inbound = bool(env, "IDOC_GUARD_ENABLE_INBOUND", false);
    if (!outbound && !inbound) {
      throw new IllegalArgumentException("Enable at least one governed IDoc direction");
    }

    Map<String, String> jco = new LinkedHashMap<>();
    put(jco, "jco.client.ashost", env.get("SAP_ASHOST"));
    put(jco, "jco.client.sysnr", env.get("SAP_SYSNR"));
    put(jco, "jco.client.client", env.get("SAP_CLIENT"));
    put(jco, "jco.client.user", env.get("SAP_USER"));
    put(jco, "jco.client.passwd", env.get("SAP_PASSWORD"));
    put(jco, "jco.client.lang", env.getOrDefault("SAP_LANG", "EN"));
    put(jco, "jco.client.mshost", env.get("SAP_MSHOST"));
    put(jco, "jco.client.r3name", env.get("SAP_R3NAME"));
    put(jco, "jco.client.group", env.get("SAP_GROUP"));
    put(jco, "jco.destination.pool_capacity", env.getOrDefault("SAP_POOL_CAPACITY", "3"));
    put(jco, "jco.destination.peak_limit", env.getOrDefault("SAP_PEAK_LIMIT", "10"));
    put(jco, "jco.client.snc_mode", env.get("SAP_SNC_MODE"));
    put(jco, "jco.client.snc_partnername", env.get("SAP_SNC_PARTNERNAME"));
    put(jco, "jco.client.snc_qop", env.get("SAP_SNC_QOP"));
    put(jco, "jco.client.snc_myname", env.get("SAP_SNC_MYNAME"));
    put(jco, "jco.client.snc_lib", env.get("SAP_SNC_LIB"));
    if (outbound || inbound) validateDestination(jco);

    int maxSegments = integer(env, "IDOC_GUARD_MAX_SEGMENTS", 500, 1, 10_000);
    IdocPolicy policy = new IdocPolicy(
        env.getOrDefault("IDOC_MESSAGE_TYPE", "ORDERS").trim().toUpperCase(),
        env.getOrDefault("IDOC_BASIC_TYPE", "ORDERS05").trim().toUpperCase(),
        env.getOrDefault("IDOC_EXTENSION", "").trim().toUpperCase(),
        csvSet(outbound ? require(env, "IDOC_ALLOWED_SEGMENTS") : "EDI_DC40"),
        env.getOrDefault("IDOC_SENDER_PARTNER_TYPE", "LS").trim().toUpperCase(),
        (outbound ? require(env, "IDOC_SENDER_PARTNER") : "DISABLED").trim().toUpperCase(),
        env.getOrDefault("IDOC_RECEIVER_PARTNER_TYPE", "LS").trim().toUpperCase(),
        (outbound ? require(env, "IDOC_RECEIVER_PARTNER") : "DISABLED").trim().toUpperCase(),
        (outbound ? require(env, "IDOC_RECEIVER_PORT") : "DISABLED").trim().toUpperCase(),
        maxSegments);
    policy.validateConfiguration();

    InboundPolicy inboundPolicy = new InboundPolicy(
        csvSet(env.getOrDefault("IDOC_INBOUND_MESSAGE_TYPES", "DESADV,INVOIC")),
        csvSet(env.getOrDefault("IDOC_INBOUND_BASIC_TYPES", "DELVRY07,INVOIC02")),
        csvSet(inbound ? require(env, "IDOC_INBOUND_SENDER_PARTNERS") : "DISABLED"),
        integer(env, "IDOC_INBOUND_MAX_BYTES", 1_048_576, 1_024, 5_242_880));
    inboundPolicy.validateConfiguration();

    String destinationName = env.getOrDefault("SAP_DESTINATION_NAME", "SAP_IDOC_GUARD");
    Map<String, String> server = new LinkedHashMap<>();
    if (inbound) {
      put(server, "jco.server.gwhost", require(env, "SAP_GWHOST"));
      put(server, "jco.server.gwserv", require(env, "SAP_GWSERV"));
      put(server, "jco.server.progid", require(env, "SAP_PROGRAM_ID"));
      put(server, "jco.server.repository_destination", destinationName);
      put(server, "jco.server.connection_count", env.getOrDefault("SAP_SERVER_CONNECTION_COUNT", "2"));
      put(server, "jco.server.snc_mode", env.get("SAP_SERVER_SNC_MODE"));
      put(server, "jco.server.snc_myname", env.get("SAP_SERVER_SNC_MYNAME"));
      put(server, "jco.server.snc_lib", env.get("SAP_SNC_LIB"));
    }

    return new Configuration(
        integer(env, "PORT", 8080, 1, 65_535),
        token,
        destinationName,
        Path.of(env.getOrDefault("IDOC_GUARD_STATE_DIR", "/var/lib/sap-idoc-guard")),
        integer(env, "IDOC_GUARD_MAX_BODY_BYTES", 262_144, 1_024, 5_242_880),
        maxSegments,
        integer(env, "IDOC_GUARD_REQUEST_TIMEOUT_SECONDS", 60, 1, 300),
        env.getOrDefault("IDOC_GUARD_TLS_KEYSTORE", ""),
        env.getOrDefault("IDOC_GUARD_TLS_KEYSTORE_PASSWORD", ""),
        outbound,
        inbound,
        inbound && bool(env, "IDOC_GUARD_ENABLE_INBOUND_PAYLOAD_READ", false),
        env.getOrDefault("IDOC_OUTBOUND_OPERATION", "submitPurchaseOrderIdoc").trim(),
        policy,
        inboundPolicy,
        Map.copyOf(jco),
        env.getOrDefault("SAP_SERVER_NAME", "SAP_IDOC_GUARD_SERVER"),
        Map.copyOf(server));
  }

  private static void validateDestination(Map<String, String> properties) {
    if (!properties.containsKey("jco.client.client") || !properties.containsKey("jco.client.user")
        || !properties.containsKey("jco.client.passwd")) {
      throw new IllegalArgumentException("SAP_CLIENT, SAP_USER and SAP_PASSWORD are required");
    }
    boolean direct = properties.containsKey("jco.client.ashost")
        && properties.containsKey("jco.client.sysnr");
    boolean balanced = properties.containsKey("jco.client.mshost")
        && properties.containsKey("jco.client.r3name")
        && properties.containsKey("jco.client.group");
    if (!direct && !balanced) {
      throw new IllegalArgumentException(
          "Configure SAP_ASHOST + SAP_SYSNR or SAP_MSHOST + SAP_R3NAME + SAP_GROUP");
    }
  }

  private static Set<String> csvSet(String value) {
    return Stream.of(value.split(","))
        .map(String::trim)
        .map(String::toUpperCase)
        .filter(item -> !item.isBlank())
        .collect(Collectors.toUnmodifiableSet());
  }

  private static void put(Map<String, String> target, String key, String value) {
    if (value != null && !value.isBlank()) target.put(key, value.trim());
  }

  private static boolean bool(Map<String, String> env, String key, boolean fallback) {
    String value = env.getOrDefault(key, Boolean.toString(fallback));
    if (!value.equalsIgnoreCase("true") && !value.equalsIgnoreCase("false")) {
      throw new IllegalArgumentException(key + " must be true or false");
    }
    return Boolean.parseBoolean(value);
  }

  private static String require(Map<String, String> env, String key) {
    String value = env.get(key);
    if (value == null || value.isBlank()) throw new IllegalArgumentException(key + " is required");
    return value;
  }

  private static int integer(Map<String, String> env, String key, int fallback, int min, int max) {
    int value = Integer.parseInt(env.getOrDefault(key, Integer.toString(fallback)));
    if (value < min || value > max) {
      throw new IllegalArgumentException(key + " is outside the permitted range");
    }
    return value;
  }
}
