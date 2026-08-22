# BTP compatibility probe — not a supported deployment

This directory preserves the outbound-only Cloud Foundry probe executed on
2026-08-23. It is evidence for the runtime boundary, not a production manifest.

Observed result:

- SAP Java buildpack 2.68.0 staged the WAR and injected JCo embedding 5.0.7.
- Tomcat loaded the application.
- JIDocLib 3.1.4 failed during initialization because the managed JCo runtime
  does not expose `com.sap.conn.jco.rt.IServerManager`.
- The probe app `btp-idoc-guard-415` was stopped after the test.

Do not use this manifest as a working IDoc deployment. Use the operated private
sidecar or SAP Integration Suite's supported IDoc adapter. Never commit or
publish `sapidoc3.jar`; the Maven profile accepts it only from an operator-owned
directory for this private compatibility test.
