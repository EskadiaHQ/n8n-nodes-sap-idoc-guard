# Logali SAP IDoc Guard

Security-first n8n community node for governed SAP IDoc exchange through an
operated SAP JCo/JIDocLib sidecar.

> **Experimental `0.1.5` node package**: the node contract, test fixture, Java sidecar,
> tRFC state machine and automated tests are implemented. Licensed SAP JCo
> 3.1.13 and JIDocLib 3.1.4 have passed a real outbound transport test against
> A4H client 250. Application processing still requires the approved WE20
> partner profile and its project-specific process configuration.

```text
n8n -> HTTPS -> SAP IDoc Guard sidecar -> JCo/JIDocLib tRFC -> SAP ALE/IDoc
```

This is deliberately separate from SAP RFC Guard. RFC/BAPI is a synchronous
function-call model. IDoc is an asynchronous ALE document model commonly
transported with transactional RFC. Reusing RFC Guard as an arbitrary technical
call surface would lose the IDoc-specific controls: partner contracts, segment
allowlists, TIDs, idempotency, and application acknowledgements.

## Capabilities

- Test the authenticated, governed sidecar and target SID/client.
- Submit one approved outbound IDoc XML document.
- Enforce exact message type, basic type, extension, control-record partners,
  receiving port, segment allowlist, size, and segment count.
- Require `SEND <business-operation> <idempotency-key>` for every outbound write.
- Persist the idempotency reservation before the SAP call.
- Return the original receipt for a same-key/same-payload retry and reject a
  same-key/different-payload retry.
- Mark uncertain transport results and refuse blind automatic retries.
- Track local transport status by request ID, idempotency key, TID, or known
  document number.
- Receive governed inbound IDocs through a registered JCo server with durable
  tRFC TID processing.
- List minimized inbound metadata without returning raw XML.
- Retrieve one stored inbound XML only through a separate credential/server
  opt-in; this operation is always blocked for AI Tools.
- Require `ACK <receipt-id> <outcome>` for accepted, rejected, or retry outcomes.
- Permit only status and inbound-list reads when used as an AI Tool; writes are
  blocked even when a normal workflow credential permits them.

## Important status boundary

`transport_confirmed` is a transport receipt, not SAP application status 53.
The receiving SAP system can accept the tRFC transaction and later reject the
business IDoc. Production rollout therefore needs an application-level evidence
design such as ALEAUD, a business response IDoc, or a governed receiver-side
status integration.

## Install for local evaluation

```bash
npm install
npm test
npm run lint
npm run build
```

The npm package installs only the n8n node. It does not redistribute SAP JCo,
JIDocLib, native libraries, SAP credentials, or the operated sidecar.

## Credential policy

Use a dedicated credential per trust boundary. Recommended allowed operations:

```text
submitPurchaseOrderIdoc, getIdocStatus, listInboundIdocs, getInboundIdoc, acknowledgeInboundIdoc
```

Import the matching JSON from
[`docs/OPERATION-POLICIES.example.json`](docs/OPERATION-POLICIES.example.json),
then remove unused operations and fields. Enable outbound submission and inbound
acknowledgement independently. HTTPS certificate verification stays enabled.

The n8n credential contains only the sidecar URL/token and governance policy.
SAP usernames and passwords stay in the sidecar secret store.

## Sidecar API

- `GET /v1/health`
- `POST /v1/outbound/{businessOperation}/submit`
- `GET /v1/status/{requestId|idempotencyKey|tid|docnum}`
- `GET /v1/inbound?limit=50&cursor=0`
- `GET /v1/inbound/{receiptId}/document` (disabled by default)
- `POST /v1/inbound/{receiptId}/ack`

Every request requires a bearer token and `X-IDoc-Guard-Mode: governed`.
Write bodies also carry an exact confirmation contract. Responses attest
direction, read/write mode, real-vs-synthetic source, correlation ID, duration,
and minimized backend identity; the node validates and projects those fields.

## Test layers

- TypeScript unit tests cover operation policies, XML/segment validation,
  request construction, response evidence, and AI Tool restrictions.
- The Node.js contract sidecar exercises the complete HTTP contract with
  deterministic synthetic IDocs.
- Java tests cover XML hardening, partner/type allowlists, durable idempotency,
  uncertain outcomes, tRFC commit/rollback/confirm, inbound minimization, and
  end-to-end HTTP routes with a fake SAP transport.
- Real JCo smoke testing is intentionally not automatic because it creates an
  external SAP effect. Follow [`docs/SAP-SETUP.md`](docs/SAP-SETUP.md) with an
  approved non-production document and partner.

The operated development acceptance on 2026-08-22 imported four inactive
examples, verified the synthetic contract end to end, loaded both proprietary
SAP libraries on target Linux, and created real SAP IDoc `198012` through tRFC.
A same-key retry returned the original receipt without creating a second IDoc.
SAP recorded status 56 because the dedicated WE20 partner profile does not yet
exist; this is an application-configuration gate, not a transport failure. See
[`jidoc-sidecar/docs/READINESS-REPORT-2026-08-22.md`](jidoc-sidecar/docs/READINESS-REPORT-2026-08-22.md).

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
[`jidoc-sidecar/README.md`](jidoc-sidecar/README.md), and
[`SECURITY.md`](SECURITY.md) before deployment. The current development-only
audit exceptions are recorded transparently in
[`docs/DEPENDENCY-AUDIT.md`](docs/DEPENDENCY-AUDIT.md).
