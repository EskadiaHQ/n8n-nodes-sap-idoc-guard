package com.logali.idocguard;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.concurrent.CountDownLatch;

public final class Main {
  private Main() {}

  public static void main(String[] args) throws Exception {
    Configuration configuration = Configuration.fromEnvironment();
    ObjectMapper mapper = new ObjectMapper()
        .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
    StateStore state = new StateStore(configuration.stateDirectory(), mapper);
    IdocTransport transport = new JidocTransport(configuration);
    GuardService service = new GuardService(configuration, state, transport);
    JidocInboundReceiver inboundReceiver = new JidocInboundReceiver(configuration, state);
    HttpApi api = new HttpApi(configuration, service, transport, mapper);
    Runtime.getRuntime().addShutdownHook(new Thread(() -> {
      api.close();
      inboundReceiver.close();
      service.close();
      transport.close();
    }, "sap-idoc-guard-shutdown"));
    inboundReceiver.start();
    api.start();
    System.out.println("SAP IDoc Guard sidecar started on port " + configuration.port());
    new CountDownLatch(1).await();
  }
}
