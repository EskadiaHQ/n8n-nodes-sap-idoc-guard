# Dependency audit snapshot

Date: 2026-08-22

- The packed community node has `bundled: []` and no runtime dependency copied
  into the tarball. It relies on n8n's `n8n-workflow` peer.
- The local development tree reports 13 transitive advisories (3 moderate,
  10 high) under the current official `@n8n/node-cli@0.44.5` / installed
  `n8n-workflow` toolchain, principally through `nanoid` and `uuid`.
- Community-node lint forbids dependency `overrides`. Forcing audit's suggested
  downgrade would replace the current CLI with an incompatible older major.
- `@n8n/node-cli@0.45.3` was evaluated but rejected: its dependency tree brings
  `isolated-vm@7`, which requires Node 24 and cannot install under this package's
  supported Node 22 development runtime.
- `release-it` was removed because publishing is not part of this local build
  and its transitive HTTP client introduced avoidable development advisories.

Do not publish `node_modules`. Run builds only on trusted source, keep the CI
runner isolated, and repeat this audit when a Node-22-compatible CLI release
updates the affected transitive packages. Do not use `npm audit fix --force`.

The Java artifact contains Jackson only; SAP JCo/JIDocLib remain externally
mounted proprietary dependencies. Their approved versions and checksums must be
recorded and scanned during the real-runtime acceptance gate.
