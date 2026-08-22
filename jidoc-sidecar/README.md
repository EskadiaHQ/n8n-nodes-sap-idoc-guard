# SAP IDoc Guard JIDocLib sidecar

Operated Java 21 companion for `n8n-nodes-sap-idoc-guard`. It is the only
component that holds the SAP technical identity and loads SAP JCo/JIDocLib.

## Proprietary runtime

SAP's files cannot be redistributed. Obtain a supported SAP Java Connector 3.1
and SAP Java IDoc Library 3.1 from SAP Support and mount, read-only:

- `/opt/sap/idoc/sapjco3.jar`
- `/opt/sap/idoc/sapidoc3.jar`
- `/opt/sap/idoc/libsapjco3.so` on Linux x86-64, or the matching native library
  for the selected platform

JIDocLib 3.1.4 requires JCo 3.1.12 or later and supports Java 21. The sidecar
loads both libraries at startup and stops if either is absent.

## Guarantees

- No caller-controlled RFC or technical IDoc operation name.
- Exact outbound message type, basic type, extension, partners, port, and
  segment allowlist.
- XML DTDs and entities disabled.
- Durable idempotency reservation before tRFC send.
- An uncertain send is recorded as `outcome_unknown`; automatic retry is
  refused until an operator reconciles it.
- `confirmTID` is called only after `JCoIDoc.send` returns.
- Inbound JCo server implements durable `checkTID`, `commit`, `rollback`, and
  `confirmTID`; a document enters the n8n inbox only after tRFC commit.
- Inbound message/basic types and senders are exact allowlists, and one IDoc per
  transaction is enforced.
- Raw inbound XML is encrypted-at-rest responsibility of the operated host and
  is never returned by list or acknowledgement endpoints.
- Raw XML retrieval is disabled by default and needs
  `IDOC_GUARD_ENABLE_INBOUND_PAYLOAD_READ=true` plus a separate n8n credential
  opt-in and response-field policy. It is never available to an AI Tool.

`transport_confirmed` means that the connector's tRFC transaction was handed
off and confirmed. It is **not** SAP application status 53. Application-level
success requires an agreed acknowledgement design (for example ALEAUD or a
business response IDoc) and remains a separate acceptance gate.

## Build and test

```bash
mvn test
mvn package
docker build -t logali/sap-idoc-guard-sidecar:0.1.3 .
```

The unit/API tests use a fake transport and do not need proprietary libraries.
The production process does.

## Deployment outline

1. Copy `.env.example` outside version control and replace every placeholder.
2. Create a PKCS#12 certificate valid for the service DNS name and `localhost`
   (the latter is used only by the container health check).
3. Mount JCo/JIDocLib and the native library read-only.
4. Persist `/var/lib/sap-idoc-guard`; losing it loses idempotency and tRFC TID
   history.
5. Configure an SM59 TCP/IP destination with the same Program ID, gateway host,
   and gateway service, then validate registration.
6. Configure only the required ALE partner profiles and process codes.
7. Test against a non-production client with an approved test partner and
   document. Verify sender-side tRFC and receiver-side IDoc status separately.
8. Trust the internal CA in n8n. Never enable insecure HTTP for this sidecar.

The Compose example intentionally publishes no host port and expects existing
`n8n_private` and routed, firewall-controlled `sap_egress` networks.
