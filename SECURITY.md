# Security policy

## Supported versions

`0.1.x` is experimental and receives security fixes while the real-SAP
acceptance gates in the roadmap remain open.

## Reporting

Do not open a public issue containing credentials, IDoc payloads, partner
profiles, internal hostnames, Program IDs, certificates, TIDs, or SAP document
numbers. Report privately to `admin@logaligroup.com` with a minimized reproducer.

## Deployment requirements

- Keep the sidecar on private networks and do not publish its host port.
- Use TLS with an internal CA trusted by n8n. Insecure HTTP exists only for the
  isolated contract fixture and loopback Java tests.
- Generate a random API token of at least 32 characters and rotate it through a
  coordinated sidecar/n8n credential change.
- Mount SAP JCo/JIDocLib and their native library read-only. Verify their source,
  version, checksum, architecture, and SAP license.
- Use a least-privilege SAP Communication/System user and restrictive gateway,
  network, ALE partner, and process-code configuration.
- Encrypt, back up, and access-restrict the persistent state volume. It contains
  raw inbound XML and correctness-critical idempotency/TID state.
- Never log request bodies, raw IDocs, SAP passwords, bearer tokens, or TLS
  keystore passwords.
- Keep inbound payload retrieval disabled unless a normal workflow genuinely
  needs the XML; isolate that credential and narrow its response fields.
- Monitor disk usage, failed authentication, disallowed contracts,
  `outcome_unknown`, SM58, gateway registration, and receiver-side IDoc errors.
- Keep AI Tool writes disabled; the package enforces this in code.

## Non-goals

The node is not an arbitrary RFC client, generic IDoc browser, partner-profile
editor, SAP status-53 oracle, or substitute for SAP authorization/ALE design.
