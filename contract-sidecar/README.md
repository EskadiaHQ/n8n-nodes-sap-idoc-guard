# SAP IDoc Guard contract fixture

This isolated fixture validates the n8n node contract without loading SAP JCo,
SAP JIDocLib, opening an RFC connection, or contacting SAP. It accepts one
fictitious `ORDERS` / `ORDERS05` document, provides deterministic status
evidence, seeds two inbound receipts, and exercises acknowledgement semantics.

Every response is marked `source=contract-fixture` and `syntheticData=true`.
Never present its `DOCNUM`, TID, status, or inbound data as SAP evidence.

```bash
CONTRACT_TOKEN=IDOC_GUARD_CONTRACT_FIXTURE_TOKEN_01 PORT=8080 node server.mjs
```

Plain HTTP is intended only for an isolated local test network.

For the operated development fixture, copy `compose.server.example.yml` as
`compose.yml`, create a root-owned `.env` containing a random
`CONTRACT_TOKEN`, and keep the service on the private n8n backend network with
no published ports. The compose healthcheck authenticates without disclosing
the token in logs.
