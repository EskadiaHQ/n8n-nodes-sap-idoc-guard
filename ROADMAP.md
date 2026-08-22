# Roadmap and acceptance gates

## Implemented in 0.1.x

- Governed n8n credential and node operations.
- Outbound XML contract, exact write confirmation, idempotency, evidence
  validation, response projection, and AI Tool read-only gate.
- Synthetic HTTP contract fixture.
- Java 21 JCo/JIDocLib outbound transport loaded reflectively.
- Durable submission and inbound state.
- Registered JCo IDoc server with durable tRFC TID callbacks.
- TLS/bearer API and fake-transport Java tests.
- Self-hosted installation verified on n8n 2.33.5 with ten inactive examples,
  private contract fixture and positive/negative execution evidence.
- Licensed JCo 3.1.13 and JIDocLib 3.1.4 loaded on target Linux x86-64.
- Real ORDERS05 outbound tRFC transport verified against A4H client 250, with
  SAP-side EDIDC/EDIDS evidence and a no-duplicate idempotency retry.

## Required before stable release

- Configure the dedicated WE20 partner profile/process code and move the real
  ORDERS05 test from status 56 to its approved application outcome.
- Verify direct and, if used, message-server destination modes.
- Complete one approved ORDERS05 non-production round trip.
- Interrupt transport during a controlled test and reconcile the uncertain TID.
- Complete DESADV/INVOIC inbound commit, rollback, SAP retry, and duplicate tests.
- Confirm SM59 registration and gateway ACL behavior after restart.
- Decide and implement application-level acknowledgement/status evidence.
- Perform threat-model, dependency, container, secret, and recovery reviews.
- Restore the state volume in a disaster-recovery exercise.
- Repeat the exact-version/package acceptance for every future supported n8n
  release before publishing it as compatible.

No npm or public image publication and no production write has been performed.
The development node, synthetic fixture and private real-SAP sidecar are
deployed. One approved non-production IDoc transport was created in A4H/250.
