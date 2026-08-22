# SAP setup checklist

The exact transactions and authorization objects vary by release and project;
have the SAP Basis/ALE owner approve the final design.

## Outbound from the sidecar to SAP

- Create a least-privilege Communication/System user in the target client.
- Configure the logical systems and ALE partners used in the control record.
- Permit only the required IDoc message/basic type and receiving process.
- Restrict network paths to the SAP message/application server and gateway.
- If SNC is required, set the `SAP_SNC_*` variables and mount the approved
  cryptographic library; do not downgrade to clear RFC.
- Prove the path with a non-production partner and a disposable business case.
- Configure the receiving logical-system partner in WE20 before expecting
  application processing. A successful tRFC can still create status 56
  (`EDI: Partner profile does not exist`) when this profile is absent.

## Inbound from SAP to the sidecar

- Create an SM59 TCP/IP destination with activation type **Registered Server
  Program**.
- Make Program ID, gateway host, and gateway service match `SAP_PROGRAM_ID`,
  `SAP_GWHOST`, and `SAP_GWSERV`.
- Restrict SAP gateway registration and ACLs to the sidecar identity and host.
- Configure WE20 partner profiles/process codes only for the governed inbound
  message types.
- Configure package size one: this implementation rejects multi-IDoc packages
  to retain an unambiguous receipt and acknowledgement boundary.
- Confirm SM58 retry behavior and monitor the registered program.

## Acceptance evidence

- Authenticated sidecar health reports the intended SID/client.
- An allowed outbound IDoc returns a stable request ID and TID.
- Reusing the same idempotency key and payload does not send twice.
- Changing the payload under the same key returns a conflict.
- An interrupted/uncertain send blocks a blind retry.
- A disallowed segment, partner, message type, extension, or XML entity fails.
- Inbound rollback produces no inbox item; commit produces exactly one.
- SAP-side application result is checked independently from transport success.

## Verified A4H/250 baseline — 2026-08-22

- Runtime: SAP JCo 3.1.13 plus SAP JIDocLib 3.1.4 on Linux x86-64.
- Outbound type: `ORDERS` / `ORDERS05`, sender `LS/N8NIDOC`, receiver
  `LS/A4HCLNT250`, port `SAPA4H`.
- Result: tRFC confirmed with TID `383E0458C4206A897921000B`; SAP created IDoc
  `198012` with four segments.
- SAP application state: 56, message `EDI: Partner profile does not exist`.
- Retry result: same idempotency key and payload returned the original receipt
  with `duplicate=true` in 2 ms; EDIDC still contained exactly one IDoc.

The next Basis action is to create and approve the exact inbound WE20 profile
for logical-system partner `N8NIDOC`, message `ORDERS`, and the intended process
code. Do not bypass ALE customizing with direct table writes.
