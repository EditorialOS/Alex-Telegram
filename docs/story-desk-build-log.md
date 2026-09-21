# Alex Core / Story Desk — build log

## Reconciled authority

- Implementation repository: `https://github.com/EditorialOS/Alex-Telegram.git`
- Build branch: `codex/alex-core-vercel-v1`
- Accepted base commit: `c5a6b82aa248199a2e5bb1d07eba03e16564e3ad`
- Source artifact: `minimal-os-v2.1.0.zip`
- Source artifact SHA-256:
  `e5cdf0c9abe656eaa1c059410f2a8fcb3e9d7cf064e0e13af06e19765ec84e0d`
- Vendored source root: `sources/minimal-os/2.1.0/`
- Integrity manifest: `sources/minimal-os/2.1.0/MANIFEST.json`
- Manifest SHA-256:
  `0f1247bb1fd1905ad0aaecc089a468e32310313b66683cb54e78ab2c3fecdf13`
- Source verification: `35/35 kernel files match MANIFEST.json (os 2.1.0)`

The source artifact was copied into the implementation repository as normal
filesystem content so one Vercel project can bundle it with Alex Core. The
archive's embedded version-control metadata and unrelated client material were
excluded. `alex-source.lock.json` records the accepted hashes and authority
files.

The runtime authority is:

1. `orchestrator-protocol.md` v1.0.0
2. `alex.md` v3.0.0
3. `story-commissioner.md` v1.1.0
4. `content-strategist.md` v1.1.0
5. `editorial-gate.md` v1.1.0
6. `editorial-voice.md` v1.1.0

Cowork Unified Architecture v3 remains a historical behavior reference rather
than a second runtime authority. Eve is a filesystem-first architecture guide;
it is not installed and is not a runtime dependency.

## Contract handling

The Minimal OS source files remain byte-identical to their manifest. The named
`story_desk_commissioning` mode remains an implementation-owned supplemental
contract in `story-desk/contracts/`, protected by its own SHA-256 manifest. The
contract declares Minimal OS 2.1 and Editorial Gate 1.1 compatibility.

Each uncached load verifies the complete Minimal OS manifest and the Story Desk
contract manifest before reading the orchestrator, Alex instance or specialist
skills. Verification fails closed; the rubric is not duplicated in application
code.

## Runtime decisions

- Vercel is the target application runtime.
- Vercel AI Gateway is the target model boundary.
- Supabase Postgres is the business system of record.
- Supabase Auth is the OAuth 2.1 authority for the private ChatGPT connection.
- Context API is not used as Story Desk job storage.
- Uploaded context accepts content bytes only; paths and arbitrary URLs are not
  part of the contract.
- V.1 uses uploaded context and one-hour signed inline downloads.
- Box context sync and review-copy export are deferred to V.2; dormant adapter
  and schema groundwork are not V.1 runtime requirements.
- Brief structure is checked before scoring.
- Editorial Gate runs exactly once per complete brief.
- The runtime derives disposition from the five validated 1–5 scores.
- Approval and rejection are immutable, tenant-scoped events bound to brief ID,
  version and content hash.
- The MCP endpoint is private-first and exposes only the four V.1 operations.
- ChatGPT authentication validates issuer, JWKS signature, expiration, audience,
  subject and OAuth-client identity. Static API-key authentication is not
  supported.

## Deployment status

This tranche changes repository files only. It does not create or modify a
Vercel project, deploy a preview or production build, apply a database schema,
migrate secrets, install Eve, or remove external infrastructure.

The next approval-gated milestone is a Vercel preview using non-production
configuration. Preview evidence must cover source integrity, OAuth metadata,
all four MCP operations, signed downloads, tenant isolation, restart recovery
and persistence before production promotion is proposed.
