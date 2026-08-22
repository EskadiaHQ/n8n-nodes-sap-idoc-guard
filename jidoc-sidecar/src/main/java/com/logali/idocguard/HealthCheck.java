package com.logali.idocguard;

public final class HealthCheck {
  private HealthCheck() {}

  public static void main(String[] args) throws Exception {
    String keystorePath = System.getenv().getOrDefault("IDOC_GUARD_TLS_KEYSTORE", "");
    String scheme = keystorePath.isBlank()
        ? "http" : "https";
    int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "8080"));
    String host = System.getenv().getOrDefault("IDOC_GUARD_HEALTH_HOST", "localhost");
    String token = System.getenv("IDOC_GUARD_API_TOKEN");
    if (token == null) System.exit(1);
    var request = java.net.http.HttpRequest.newBuilder(
            java.net.URI.create(scheme + "://" + host + ":" + port + "/v1/health"))
        .header("Authorization", "Bearer " + token)
        .header("X-IDoc-Guard-Mode", "governed")
        .timeout(java.time.Duration.ofSeconds(5))
        .GET().build();
    var client = java.net.http.HttpClient.newBuilder();
    if (!keystorePath.isBlank()) {
      char[] password = System.getenv().getOrDefault(
          "IDOC_GUARD_TLS_KEYSTORE_PASSWORD", "").toCharArray();
      java.security.KeyStore store = java.security.KeyStore.getInstance("PKCS12");
      try (var input = java.nio.file.Files.newInputStream(java.nio.file.Path.of(keystorePath))) {
        store.load(input, password);
      }
      var trust = javax.net.ssl.TrustManagerFactory.getInstance(
          javax.net.ssl.TrustManagerFactory.getDefaultAlgorithm());
      trust.init(store);
      var ssl = javax.net.ssl.SSLContext.getInstance("TLSv1.3");
      ssl.init(null, trust.getTrustManagers(), null);
      client.sslContext(ssl);
    }
    var response = client.build()
        .send(request, java.net.http.HttpResponse.BodyHandlers.discarding());
    System.exit(response.statusCode() == 200 ? 0 : 1);
  }
}
