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

## Verified A4H/250 application baseline — 2026-08-22

- Runtime: SAP JCo 3.1.13 plus SAP JIDocLib 3.1.4 on Linux x86-64.
- Message contract: `ORDERS` / `ORDERS05`, sender `LS/N8NIDOC`, receiver
  `LS/A4HCLNT250`, receiver port `SAPA4H`.
- BD54 logical system: `N8NIDOC`.
- WE20 inbound partner: type `LS`, partner `N8NIDOC`, message `ORDERS`, process
  code `ORDE`, immediate processing, post-processing user `IVANHOCK`.
- Workbench request: `A4HK900173`.
- The initial pre-WE20 transport created IDoc `198012` and demonstrated the
  expected status-56 boundary.
- The first complete post-WE20 payload created IDoc `198016`, status 53, and SD
  sales order `0000000005`.
- The enterprise acceptance created IDocs `198017–198042`: 20 status-53 results
  with sales orders and six status-51 business/configuration errors.
- Exact retries of 16 portfolio cases and five replenishment waves returned the
  original receipts with `duplicate=true`; the maximum DOCNUM did not change.

## Application-ready ORDERS05 fields

The receiver requires more than a minimal transport fixture:

- `E1EDK14/QUALF 006`: division;
- `E1EDK14/QUALF 007`: distribution channel;
- `E1EDK14/QUALF 008`: sales organization;
- `E1EDK14/QUALF 012`: sales document type;
- `E1EDK03/IDDAT 002`: requested delivery date;
- `E1EDKA1/PARVW AG`: sold-to party;
- `E1EDK02/QUALF 001`: external order reference, limited to 20 characters by
  the target `BSTNK` field;
- `E1EDP19/QUALF 002`: material number;
- `E1EDP20`: schedule quantity and date;
- `MENEE=PCE`: ISO unit. `ST` is the internal SAP unit and is rejected as an
  inbound ISO code in this system.

Do not force `CURCY` in the accepted A4H/250 examples. The inbound conversion
rejected supplied ISO currency values; allowing SAP to derive currency from the
customer and sales area produced the expected USD documents.

## Operational checks

| Check | Transaction / evidence | Expected result |
|---|---|---|
| Partner configuration | WE20 | `LS/N8NIDOC`, inbound `ORDERS`, `ORDE` |
| IDoc persistence | WE02 or WE05 | sender `N8NIDOC`, basic type `ORDERS05` |
| Application success | IDoc status records | final status 53 |
| Application error | IDoc status records | status 51 plus message variables |
| Sales document | VA03 | order, customer, reference, date and items |
| Search by reference | VA05 | customer purchase-order reference |
| Controlled reprocessing | BD87 | reprocess the existing status-51 IDoc |

Do not create a new idempotency key merely to bypass a functional error. First
reconcile the original IDoc; correct master data/customizing and use BD87 when
the existing document is the intended business message.
