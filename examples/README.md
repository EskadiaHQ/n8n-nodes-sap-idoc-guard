# Example workflows

- `idoc-guard-contract-roundtrip.json`: deterministic synthetic outbound/status
  regression. It requires the contract fixture, not SAP.
- `idoc-guard-contract-inbound-lifecycle.json`: fixture-only health, full inbound
  payload and acknowledgement regression. Execute twice to verify duplicate
  acknowledgement semantics.
- `idoc-guard-real-outbound-template.json`: approved ORDERS05 sample with a
  JIDocLib-compatible root, stable business key and exact confirmation. The
  repository copy remains credential-free; the operated development copy is
  attached to the private A4H/250 credential and stays inactive.
- `idoc-guard-inbound-triage.json`: read-only minimized inbound inbox.

All workflows are inactive, contain no credential IDs or internal URLs, and set
`availableInMCP` to false. Importing a workflow does not authorize its use.
