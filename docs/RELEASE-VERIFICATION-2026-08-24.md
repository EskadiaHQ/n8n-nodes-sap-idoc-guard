# IDoc Guard release verification — 2026-08-24

## Outcome

`n8n-nodes-sap-idoc-guard@0.1.11` is published under the npm `latest` tag and
GitHub release `v0.1.11`. Pull request #3 was merged into `main` at commit
`f5fb535`.

## Security changes

- Credential and runtime connection tests now reject degraded, missing, or
  unknown sidecar health states.
- Governed IDoc capabilities alone cannot make an unhealthy endpoint appear
  connected.
- The credential UI now documents the existing 32-byte minimum for API tokens.
- Direction and read/write attestations, response projections, idempotency,
  raw-payload isolation, AI-tool restrictions, and secret redaction remain
  intact.

## Verification evidence

- Node tests: 22 passed.
- Contract-sidecar tests: 6 passed.
- Community-node lint: passed.
- TypeScript/package build: passed.
- Package dry run: passed; 57 files, approximately 416 kB compressed.
- Production dependency audit: 0 vulnerabilities.
- Clean registry installation: version `0.1.11` resolved and the compiled node
  artifact was present.
- Pull-request CI: [run 32666299934](https://github.com/EskadiaHQ/n8n-nodes-sap-idoc-guard/actions/runs/32666299934).
- Post-merge CI: [run 32723159768](https://github.com/EskadiaHQ/n8n-nodes-sap-idoc-guard/actions/runs/32723159768).
- Trusted npm publication: [run 32723269367](https://github.com/EskadiaHQ/n8n-nodes-sap-idoc-guard/actions/runs/32723269367).
- GitHub release: [v0.1.11](https://github.com/EskadiaHQ/n8n-nodes-sap-idoc-guard/releases/tag/v0.1.11).

The CI runs include the Java 21 JIDoc sidecar test/package job. npm reports
integrity `sha512-G2ha2lEldtO1hyFjiNPGlQ++TlXToAw39RlymphqklIPl4XfaI+olssJ8HyzEiqvBIhikTqXpCelYPMZbbcI6A==`
and SHA-1 `d2b066b202420808f8f0affb2f0cf8b8430a7afd` for the published tarball.

## Portfolio review

The same review covered HANA Guard, OData Guard, RFC Guard, and IDoc Guard.
HANA Guard passed 87 tests and OData Guard passed 35 tests without an equivalent
health-validation defect, so neither received a speculative code change. Across
all four packages, 177 tests passed and every production-only dependency audit
reported zero vulnerabilities.
