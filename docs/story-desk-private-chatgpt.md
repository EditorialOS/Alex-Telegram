# Alex Story Desk V.1 — private ChatGPT setup

Story Desk exposes one OAuth-protected Streamable HTTP MCP endpoint at
`/api/mcp` on the Alex Core Vercel project. It has no dashboard or separate web
chat.

## Included operations

- `alex.create_opportunity_board`
- `alex.get_opportunity_board`
- `alex.approve_briefs`
- `alex.get_job_status`

Every operation derives the tenant from a verified Supabase OAuth access token.
A client ID or user ID supplied in a tool request is never trusted or accepted.
V.1 accepts uploaded context contents and returns inline deliverable downloads;
the Box integration is deferred to V.2.

## 1. Apply the Supabase schema

First set **Database > API > Exposed schemas** to only
`pg_pgrst_no_exposed_schemas`, or disable the Data API. Do not expose `public`:
Story Desk holds private client context and generated editorial material.

Then run `lib/db/migrations/0001_story_desk_v1.sql` in the Supabase SQL editor
or with `psql`. The migration creates the intentionally empty exposed schema,
enables RLS, and revokes Data API roles from Story Desk tables. Existing Slack
and Telegram tables are unchanged.

Create the tenant record:

```sql
insert into story_desk_clients (id, name)
values ('client_slug', 'Client name');
```

## 2. Configure Supabase Auth as the OAuth 2.1 server

In the same Supabase project:

1. Migrate Auth JWT signing to an asymmetric RS256 or ES256 key.
2. Enable **Authentication > OAuth Server**.
3. Point its authorization path at your existing signed-in consent page. The
   page must show the requesting application and requested `email` scope, and
   call Supabase's approve or deny authorization method.
4. For a private-first install, create a dedicated **public** OAuth application
   for this ChatGPT connection (`token_endpoint_auth_method=none`). Keep dynamic
   client registration disabled unless you deliberately want other MCP clients
   to be able to register.
5. Add the exact ChatGPT callback URL shown by the MCP management screen. OAuth
   redirect URLs are exact; do not use a wildcard.

Set these server variables, using the final approved HTTPS host:

```text
SUPABASE_AUTH_ISSUER=https://YOUR_PROJECT_REF.supabase.co/auth/v1
STORY_DESK_RESOURCE_URL=https://YOUR_APPROVED_HOST/api/mcp
```

Story Desk validates every access token's JWKS signature, issuer, expiration,
audience, Supabase subject and OAuth client ID. Configure a Supabase Custom
Access Token Hook so tokens for the dedicated ChatGPT OAuth application use the
exact `STORY_DESK_RESOURCE_URL` as `aud`. If the project already has a custom
access-token hook, add this branch to it rather than replacing it:

```sql
-- Replace both placeholders before installing this as the project's
-- Custom Access Token Hook.
create or replace function public.story_desk_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb := event->'claims';
begin
  if event->>'client_id' = 'CHATGPT_OAUTH_CLIENT_ID' then
    claims := jsonb_set(
      claims,
      '{aud}',
      to_jsonb('https://YOUR_APPROVED_HOST/api/mcp'::text)
    );
  end if;
  return jsonb_build_object('claims', claims);
end;
$$;

grant execute on function public.story_desk_access_token_hook(jsonb)
  to supabase_auth_admin;
revoke execute on function public.story_desk_access_token_hook(jsonb)
  from authenticated, anon, public;
```

After Supabase has issued or refreshed a token, enroll only the intended user
and dedicated OAuth client. `auth_subject` is the user's `auth.users.id` and
`oauth_client_id` is the public OAuth application's client ID:

```sql
insert into story_desk_client_identities
  (id, client_id, auth_subject, oauth_client_id)
values
  (gen_random_uuid()::text, 'client_slug', 'SUPABASE_USER_UUID', 'CHATGPT_OAUTH_CLIENT_ID');
```

This two-part mapping prevents a valid user token obtained by a different OAuth
application from selecting a Story Desk tenant.

## 3. Verify the vendored Alex source

Minimal OS 2.1 is vendored as ordinary, read-only-at-runtime files under
`sources/minimal-os/2.1.0/`. Its authority chain is explicit:

1. `orchestrator-protocol.md` v1.0.0
2. `alex.md` v3.0.0
3. the required manifest-listed specialist skills
4. the separately versioned Story Desk commissioning contract

`alex-source.lock.json` records the accepted source bundle and manifest hashes.
Every job verifies every file in the source `MANIFEST.json` before loading the
orchestrator protocol, Alex instance, Story Commissioner, Content Strategist,
Editorial Gate and Editorial Voice. The Story Desk contract manifest is checked
against the same OS and Editorial Gate versions. A missing, misversioned or
modified file halts the job with `source_integrity_failed`.

Vercel uses the vendored paths automatically. `ALEX_SOURCE_ROOT` and
`STORY_DESK_CONTRACT_ROOT` exist only as explicit local/test overrides; do not
configure external source mounts for production.

Eve is a filesystem-first architecture reference, not a dependency. Nothing in
this setup installs or executes Eve.

## 4. Configure inline downloads

Set a deployment-only `STORY_DESK_DOWNLOAD_SECRET` containing at least 32 random
characters. Do not commit it. Story Desk signs one-hour download URLs for the
opportunity board and each brief. The MCP result includes both Markdown links
and `resource_link` content blocks so ChatGPT can show the files inline.

V.1 context must be uploaded as UTF-8 text in the tool request. The required
filenames are:

- `brand-voice.md`
- `content-pillars.md`
- `audience-personas.md`

Uploads may also contain `style-guide.md`, `competitive-landscape.md` and
`standing_orders.md`.

PostgreSQL remains the source of truth. Download URLs are tenant-bound,
tamper-resistant bearer links and expire after one hour. Asking Alex to retrieve
the board again produces fresh links. The app sends downloads as attachments
with `no-store` caching.

### Deferred to V.2: Box

Box context sync and review-copy exports are not V.1 launch requirements. The
existing Box adapter and database fields are retained as dormant V.2 groundwork,
but the V.1 runtime does not instantiate the adapter or require `BOX_*` secrets.

## 5. Connect privately in ChatGPT

After an approved Vercel deployment has a stable HTTPS URL:

1. Enable ChatGPT developer mode under **Settings > Security**.
2. Add `https://YOUR_APPROVED_HOST/api/mcp` as a Streamable HTTP MCP server.
3. Select OAuth and use the dedicated Supabase public OAuth client ID. Do not
   configure a static API key or client secret.
4. Complete Supabase sign-in and consent as the enrolled user.
5. Test initialization, all four operations, inline downloads, expired or
   tampered links, invalid inputs, stale brief hashes, and cross-tenant access
   before sharing the installation.

Before connecting ChatGPT, verify that both URLs return successful JSON and that
the authorization-server issuer exactly matches the protected-resource record:

```text
https://YOUR_APPROVED_HOST/.well-known/oauth-protected-resource
https://YOUR_PROJECT_REF.supabase.co/.well-known/oauth-authorization-server/auth/v1
```

The repository change does not deploy, migrate secrets or alter infrastructure.
Follow `DEPLOY.md` for the approval-gated Vercel preview and production sequence.
Supabase Auth remains the OAuth authority and Supabase Postgres remains the
business system of record; Vercel supplies the application and model-routing
runtime.
