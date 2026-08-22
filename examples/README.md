# Example workflows

- `idoc-guard-contract-roundtrip.json`: deterministic synthetic outbound/status
  regression. It requires the contract fixture, not SAP.
- `idoc-guard-contract-inbound-lifecycle.json`: fixture-only health, full inbound
  payload and acknowledgement regression. Execute twice to verify duplicate
  acknowledgement semantics.
- `idoc-guard-contract-inbound-retry.json`: fixture-only `INVOIC02` payload,
  explicit retry outcome and duplicate retry acknowledgement.
- `idoc-guard-contract-negative-governance.json`: three fail-closed branches
  for an invalid XML root, a non-allowlisted segment and a mismatched write
  confirmation. Errors continue as workflow output and never contact SAP.
- `idoc-guard-real-outbound-template.json`: approved ORDERS05 sample with a
  JIDocLib-compatible root, sales area, order type, requested date, customer
  reference, ISO unit, stable business key and exact confirmation. The
  repository copy remains credential-free; the operated development copy is
  attached to the private A4H/250 credential and stays inactive.
- `idoc-guard-real-health.json`: read-only authenticated runtime and minimized
  A4H/250 capability check.
- `idoc-guard-real-multi-item-order.json`: real two-item `ORDERS05` generated in
  a Code node from customer `0017100001` and materials `TG11`/`TG12`. It is a
  complete application-ready order, not only a transport fixture.
- `idoc-guard-real-idempotent-retry.json`: submits the same exact business key
  and payload twice; the retry must return the original receipt without a
  second SAP IDoc.
- `idoc-guard-real-status-reconciliation.json`: resolves one stored transport
  independently by idempotency key, tRFC TID and request ID.
- `idoc-guard-inbound-triage.json`: read-only minimized inbound inbox.
- `idoc-guard-enterprise-order-portfolio.json`: sixteen complete `ORDERS05`
  messages for the Atlantic Retail scenario. Twelve exercise replenishment,
  urgency, third-party, serial, batch, expiry and receiving patterns; four
  deliberately create actionable SAP application errors.
- `idoc-guard-enterprise-stock-replenishment.json`: calculates replenishment
  from stock, demand, reorder points and target stock, groups seven products by
  handling policy and sends five idempotent order waves to SAP.
- `idoc-guard-enterprise-b2b-order-api.json`: production-shaped POST endpoint
  for a partner order. It validates business JSON, restricts the real product
  catalog, builds a complete `ORDERS05` and returns HTTP 202 with the governed
  transport receipt; invalid orders receive HTTP 422.

All workflows are inactive, contain no credential IDs or internal URLs, and set
`availableInMCP` to false. Importing a workflow does not authorize its use.

The complete operated A4H/250 walkthrough, SAP GUI checks, payload contract,
error matrix and classroom procedure are maintained in:

- `415 - Recursos/MANUAL-IDOC-GUARD-EMPRESARIAL-20260822.md`
- `415 - Recursos/PRUEBAS-IDOC-GUARD-EMPRESA-20260822.md`
- `415 - Laboratorios/415-06/415_06_05_lab-idoc-guard-atlantic-retail.md`
