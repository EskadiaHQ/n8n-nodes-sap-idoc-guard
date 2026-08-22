# Architecture and trust boundaries

```text
n8n workflow
  -> HTTPS + bearer token + exact operation policy
SAP IDoc Guard sidecar
  -> SAP JCo/JIDocLib + tRFC
SAP gateway / ALE layer
  -> partner profile, process code and application processing
```

n8n owns orchestration and least-data projection. The sidecar owns transport,
SAP credentials, XML parsing, partner/segment policy, durable idempotency, and
tRFC TID state. SAP owns ALE routing and business posting.

Outbound is an asynchronous command. A successful HTTP response proves only
that the sidecar validated the exact contract and JCo confirmed its transport
TID. It cannot prove that the target application posted the document. That
requires receiver-side status evidence or an acknowledgement IDoc.

Inbound uses SAP's JCo IDoc server model. The handler stages XML under the SAP
TID. Only `commit` promotes it to the governed inbox. `rollback` discards it,
and `checkTID` prevents reprocessing of committed/confirmed transactions.

The state volume is security- and correctness-critical. Back it up, encrypt it,
restrict it to the sidecar UID, and monitor free space. Do not place it on an
ephemeral container layer.
