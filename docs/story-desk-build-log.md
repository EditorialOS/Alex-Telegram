# Alex Story Desk V.1 — build log

## Resolved preflight

- Implementation repository: `https://github.com/EditorialOS/Alex-Telegram.git`
- Base branch: `main`
- Base commit: `8248771c31c3b0af49b95bb13c43e24fce0edfaf`
- Source artifact: `minimal-os-v2.0.0 (1).zip`
- Source artifact SHA-256: `be2cbf1a468db8a4cbf5eb32dc65b56168a65d91c6daa375602ad460959301d3`
- Skill path inside artifact: `minimal-os/skills/`
- Integrity manifest inside artifact: `minimal-os/MANIFEST.json`
- Source verification: `31/31 kernel files match MANIFEST.json (os 2.0.0)`

The source artifact was unpacked outside the implementation repository. Its
embedded `.git` directory was not used as a remote. The unpacked source was
made filesystem read-only for the build and was not copied into this repository.

## Contract handling

The owner-supplied source is read-only, so the original `editorial-gate.md` and
Minimal OS manifest remain byte-identical. The new named
`story_desk_commissioning` mode is an implementation-owned supplemental skill
contract in `story-desk/contracts/`, protected by its own SHA-256 manifest. The
runtime verifies both manifests and loads the full source skills plus the
supplement; the rubric is not duplicated in application code.

## Runtime decisions

- PostgreSQL/Supabase is the system of record.
- Context API is not used as Story Desk job storage.
- Uploaded context accepts content bytes only; paths and arbitrary URLs are not
  part of the contract.
- V.1 uses uploaded context and one-hour signed inline downloads.
- Box context sync and review-copy export are deferred to V.2; the dormant
  adapter and schema groundwork remain but are not runtime requirements.
- Brief structure is checked before scoring.
- Editorial Gate runs exactly once per complete brief.
- The runtime derives disposition from the five validated 1–5 scores.
- Approval and rejection are immutable, tenant-scoped events bound to brief ID,
  version and content hash.
- The MCP endpoint is private-first and exposes only the four V.1 operations.
- ChatGPT authentication uses Supabase Auth OAuth 2.1 with issuer, JWKS,
  expiration, audience, subject and OAuth-client validation. Static API-key
  authentication is intentionally not supported.

## Deployment status

VPS deployment remains explicitly excluded. The dedicated Supabase staging
schema has been applied and the Fly staging app has been created. Private
ChatGPT OAuth setup, Fly staging verification and production promotion remain.
