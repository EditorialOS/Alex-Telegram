# Deploying Alex Core to Vercel

Vercel is the production target for Alex Core. The public surface is the
OAuth-protected Story Desk remote MCP endpoint used by a private ChatGPT
connection; Alex Core does not require a dashboard or a separate chat UI.

This implementation tranche prepares and verifies the repository only. It does
not create a Vercel project, deploy a preview or production build, migrate a
database, or move secrets. Those actions remain approval-gated.

## Target shape

```text
Private ChatGPT
  -> HTTPS remote MCP on Vercel
  -> Alex Core / Story Desk
  -> Vercel AI Gateway
  -> approved model

Alex Core / Story Desk
  <-> Supabase Auth (OAuth 2.1)
  <-> Supabase Postgres (business system of record)
```

The Alex operating instructions are normal repository files under
`sources/minimal-os/2.1.0/`. They are not a separate service. The runtime
verifies their `MANIFEST.json` before every uncached load and fails closed if a
file has drifted. `alex-source.lock.json` records the accepted source bundle and
manifest hashes.

Eve is an architecture reference for the filesystem-first shape. It is not
installed, imported, or required by this deployment.

## Required Vercel environment variables

Configure these separately for Preview and Production. Do not copy production
credentials into a preview environment.

- `DATABASE_URL` — the Supabase Postgres connection string.
- `STORY_DESK_MODEL` — an AI Gateway model ID, for example
  `anthropic/claude-opus-4.6`.
- `SUPABASE_URL` — the Supabase project URL used by the sign-in and consent
  pages.
- `SUPABASE_PUBLISHABLE_KEY` — the project's publishable/anon key.
- `SUPABASE_AUTH_ISSUER` — normally
  `https://PROJECT_REF.supabase.co/auth/v1`.
- `STORY_DESK_RESOURCE_URL` — the exact public MCP URL, for example
  `https://alex.example.com/api/mcp`. This same value must be the OAuth access
  token audience.
- `STORY_DESK_DOWNLOAD_SECRET` — at least 32 random characters, used to sign
  short-lived, tenant-bound download URLs.

Optional:

- `AI_GATEWAY_API_KEY` — local/CI authentication for AI Gateway. Vercel
  deployments use their injected short-lived `VERCEL_OIDC_TOKEN` by default,
  so no additional long-lived Gateway secret is required there.
- `AI_GATEWAY_BASE_URL` — local/test override; production uses the Vercel AI
  Gateway default.
- `STORY_DESK_OAUTH_JWKS_URL` — override only for an intentional proxy or test;
  the runtime normally derives it from `SUPABASE_AUTH_ISSUER`.
- `LOG_LEVEL` — defaults to `info`.
- `ALEX_SOURCE_ROOT` and `STORY_DESK_CONTRACT_ROOT` — local/test overrides only.
  Vercel should use the vendored repository paths.

The AI integration retains the Anthropic Messages shape while routing through
[Vercel AI Gateway](https://vercel.com/docs/ai-gateway/sdks-and-apis). This keeps
the model boundary small and observable without making the Alex source depend
on a provider SDK.

## Approval-gated rollout

1. Review the proposed file-level change set and confirm that the Vercel
   function contains only the private Story Desk surface.
2. Create or connect one Vercel project at the repository root. Do not create a
   parallel service for the Alex source files.
3. Add Preview-only environment variables and create a preview deployment.
4. Apply the Story Desk schema to an approved Supabase environment only after
   explicit approval. Supabase Postgres remains the business system of record;
   Vercel is compute, not persistence.
5. Configure the dedicated Supabase public OAuth client and enroll the intended
   `(auth_subject, oauth_client_id)` identity pair as described in
   `docs/story-desk-private-chatgpt.md`.
6. Validate the preview before promotion:
   - source and contract manifest verification;
   - OAuth protected-resource metadata;
   - all four MCP operations;
   - one-hour signed downloads;
   - stale brief hashes and invalid input;
   - expired/tampered links and cross-tenant denial;
   - persistence across a fresh function instance.
7. Present the preview evidence and the exact Production environment-variable
   list for approval.
8. Promote to Production only after approval, then add the final MCP URL to the
   private ChatGPT connection.

No schema migration, secret movement, infrastructure removal, or deployment is
implicit in these instructions.

## Local parity container

The root `Dockerfile` is an optional local/CI parity check. It bundles the API
server together with the vendored Alex source and Story Desk contracts, starts
the same narrow Story Desk surface, and is not the production hosting path.

```bash
docker build --platform=linux/amd64 -t alex-core .
docker run --rm --platform=linux/amd64 \
  --env-file .env.alex-core.local -p 8080:8080 alex-core
```

Use real secrets through your local secret manager or a private untracked env
file; do not place them in the example file or image.
