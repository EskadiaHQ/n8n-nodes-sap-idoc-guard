package com.logali.idocguard;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;

/** Outbound-only Cloud Foundry/Tomcat entry point for the SAP Java buildpack. */
public final class BtpIdocGuardServlet extends HttpServlet {
  private Configuration configuration;
  private IdocTransport transport;
  private GuardService service;
  private HttpApi localApi;
  private HttpClient client;
  private URI localBase;

  @Override public void init() throws ServletException {
    try {
      configuration = Configuration.fromEnvironment();
      if (!configuration.usesManagedDestination()) {
        throw new IllegalArgumentException(
            "SAP_USE_MANAGED_DESTINATION=true is required for the BTP servlet runtime");
      }
      if (configuration.inboundEnabled()) {
        throw new IllegalArgumentException(
            "Inbound JCoServer mode is not supported by the SAP BTP JCo runtime");
      }
      ObjectMapper mapper = new ObjectMapper()
          .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
      StateStore state = new StateStore(configuration.stateDirectory(), mapper);
      transport = new JidocTransport(configuration);
      service = new GuardService(configuration, state, transport);
      Configuration loopback = new Configuration(
          0,
          configuration.apiToken(),
          configuration.destinationName(),
          configuration.stateDirectory(),
          configuration.maxBodyBytes(),
          configuration.maxSegments(),
          configuration.requestTimeoutSeconds(),
          "",
          "",
          configuration.outboundEnabled(),
          false,
          false,
          configuration.outboundOperation(),
          configuration.outboundPolicy(),
          configuration.inboundPolicy(),
          configuration.jcoProperties(),
          configuration.serverName(),
          configuration.jcoServerProperties());
      localApi = new HttpApi(loopback, service, transport, mapper);
      localApi.start();
      localBase = URI.create("http://127.0.0.1:" + localApi.port());
      client = HttpClient.newBuilder()
          .connectTimeout(Duration.ofSeconds(5))
          .build();
    } catch (RuntimeException error) {
      destroy();
      throw new ServletException("Unable to initialize the governed IDoc runtime", error);
    }
  }

  @Override public void destroy() {
    if (localApi != null) localApi.close();
    if (service != null) service.close();
    if (transport != null) transport.close();
  }

  @Override protected void service(HttpServletRequest request, HttpServletResponse response)
      throws IOException {
    if (!authorized(request)) {
      writeError(response, 401, "UNAUTHORIZED");
      return;
    }
    byte[] body = request.getInputStream().readNBytes(configuration.maxBodyBytes() + 1);
    if (body.length > configuration.maxBodyBytes()) {
      writeError(response, 413, "REQUEST_TOO_LARGE");
      return;
    }
    String target = request.getRequestURI();
    if (request.getQueryString() != null) target += "?" + request.getQueryString();
    HttpRequest.Builder upstream = HttpRequest.newBuilder(localBase.resolve(target))
        .timeout(Duration.ofSeconds(configuration.requestTimeoutSeconds() + 5L))
        .header("Authorization", "Bearer " + configuration.apiToken())
        .header("X-IDoc-Guard-Mode", "governed")
        .header("Accept", "application/json");
    String correlation = request.getHeader("X-Correlation-ID");
    if (correlation != null) upstream.header("X-Correlation-ID", correlation);
    String contentType = request.getContentType();
    if (contentType != null) upstream.header("Content-Type", contentType);
    upstream.method(request.getMethod(), body.length == 0
        ? HttpRequest.BodyPublishers.noBody()
        : HttpRequest.BodyPublishers.ofByteArray(body));
    try {
      HttpResponse<byte[]> result = client.send(
          upstream.build(), HttpResponse.BodyHandlers.ofByteArray());
      response.setStatus(result.statusCode());
      response.setContentType(result.headers().firstValue("content-type")
          .orElse("application/json; charset=utf-8"));
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.getOutputStream().write(result.body());
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      writeError(response, 503, "REQUEST_INTERRUPTED");
    } catch (RuntimeException failure) {
      writeError(response, 502, "SIDECAR_PROXY_FAILED");
    }
  }

  private boolean authorized(HttpServletRequest request) {
    String provided = request.getHeader("X-IDoc-Guard-Token");
    if (provided == null) {
      String authorization = request.getHeader("Authorization");
      if (authorization != null && authorization.startsWith("Bearer ")) {
        provided = authorization.substring("Bearer ".length());
      }
    }
    return provided != null && MessageDigest.isEqual(
        configuration.apiToken().getBytes(StandardCharsets.UTF_8),
        provided.getBytes(StandardCharsets.UTF_8));
  }

  private static void writeError(HttpServletResponse response, int status, String code)
      throws IOException {
    response.setStatus(status);
    response.setContentType("application/json");
    response.setCharacterEncoding("UTF-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.getWriter().write("{\"error\":\"" + code + "\"}");
  }
}
