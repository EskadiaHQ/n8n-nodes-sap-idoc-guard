# Changelog

## 0.1.9 - 2026-08-23

- Add an opt-in `X-IDoc-Guard-Token` credential mode for a compatible BTP
  gateway, where XSUAA reserves the standard Authorization bearer header.
- Add a reproducible outbound-only compatibility probe for the SAP Java
  buildpack while keeping JIDocLib outside version control.
- Document the verified incompatibility between JIDocLib 3.1.4 and BTP's
  managed JCo 5 runtime; the probe is not a supported deployment. Keep direct
  IDoc transport on the private sidecar or use SAP Integration Suite.
- Reject inbound JCoServer mode in BTP, which SAP does not support.

## 0.1.8 - 2026-08-22

- Adopt the approved high-resolution Logali Guard family artwork for the IDoc node and credential.
- Show a structured document moving outbound with a single rightward send arrow.
- Preserve the validated `0.1.6`/`0.1.7` example and cache work while publishing it coherently.

## 0.1.7 - 2026-08-22

- Keep the Logali family mark and document glyph identical in light and dark mode.
- Version the icon filenames to invalidate stale n8n and browser caches.

## 0.1.6 - 2026-08-22

- Expand the executable example bank from four to ten inactive workflows.
- Add real read-only readiness and three-reference status reconciliation.
- Add a real multi-item ORDERS05 built from verified A4H/250 master data.
- Add a real two-call idempotency demonstration that creates at most one tRFC
  transport for an exact business key and payload.
- Add fixture-only governance rejection and inbound retry-decision examples.

## 0.1.5 - 2026-08-22

- Align the SAP IDoc Guard node icon with the Logali HANA Guard and SAP RFC Guard visual family.
- Replace only the family badge with a structured-document mark for IDoc.
- Keep node behavior, credentials and sidecar contracts unchanged.

## 0.1.4 - 2026-08-22

- Rotate the synthetic example idempotency key after correcting its XML root,
  allowing the upgraded example to coexist with persisted fixture state.
- Repackage and redeploy all four examples from the accepted source set.

## 0.1.3 - 2026-08-22

- Complete a real JCo/JIDocLib outbound tRFC acceptance against A4H client 250.
- Confirm SAP IDoc `198012`, TID `383E0458C4206A897921000B`, four segments,
  and an exact status-56 diagnostic caused by the intentionally absent WE20
  partner profile.
- Prove durable idempotency in the deployed n8n workflow: a same-key/same-body
  retry returns the original receipt in 2 ms and creates no second SAP IDoc.
- Align the released examples, deployment report, setup guide and target
  sidecar image at the tested `0.1.3` state.

## 0.1.2 - 2026-08-22

- Validate that the XML root element exactly matches the IDoc basic type before
  reserving an idempotency key or opening a tRFC transaction.
- Use JIDocLib-compatible roots in the contract fixture and all examples.
- Add a real A4H/250 HTTPS deployment example, guarded ORDERS05 workflow and
  root-only server provisioning script.
- Add sanitized server-side failure diagnostics while preserving the safe
  `IDOC_TRANSPORT_OUTCOME_UNKNOWN` response contract.
- Match the JIDocLib `send` signature exactly by preserving the IDoc version as
  a Java `char` instead of widening it to an incompatible integer.

## 0.1.1 - 2026-08-22

- Add the contract inbound lifecycle example covering health, payload opt-in,
  acknowledgement, and duplicate acknowledgement.
- Add reproducible self-hosted install and contract-import tooling.
- Add a hardened private Compose fixture and operated n8n/Linux readiness
  evidence.

## 0.1.0 - 2026-08-22

- Add the experimental Logali SAP IDoc Guard n8n community node.
- Add exact outbound IDoc policy, explicit write confirmation, idempotency, and
  minimized evidence-bearing responses.
- Add governed local status, inbound inbox, and acknowledgement operations.
- Add a synthetic contract sidecar and tests.
- Add the Java 21 SAP JCo/JIDocLib sidecar with TLS, persistent state, outbound
  tRFC transport, registered inbound server, and durable TID callbacks.
- Add deployment, security, SAP setup, and acceptance-gate documentation.
