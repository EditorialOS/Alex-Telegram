-- Alex Story Desk V.1 — PostgreSQL/Supabase schema.
-- Apply with the Supabase SQL editor or psql before enabling the MCP route.

begin;
set local search_path = public, pg_catalog;

-- This intentionally empty schema supports Supabase projects configured with
-- no Data API surface. Keeping it present lets PostgREST report healthy while
-- exposing none of the Story Desk tables below.
create schema if not exists pg_pgrst_no_exposed_schemas;
revoke all privileges on schema pg_pgrst_no_exposed_schemas from public;

create table if not exists story_desk_clients (
  id text primary key,
  name text not null,
  box_folder_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists story_desk_client_identities (
  id text primary key,
  client_id text not null references story_desk_clients(id),
  auth_subject text not null,
  oauth_client_id text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (auth_subject, oauth_client_id)
);
create index if not exists story_desk_identity_client_idx
  on story_desk_client_identities(client_id);

create table if not exists story_desk_jobs (
  id text primary key,
  client_id text not null references story_desk_clients(id),
  goal text not null,
  request_hash text not null,
  idempotency_key text not null,
  context_source_type text not null check (context_source_type in ('uploaded_files', 'connected_box')),
  constraints jsonb not null default '{}'::jsonb,
  state text not null,
  context_snapshot_id text,
  error_code text,
  error_details jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (client_id, id),
  unique (client_id, idempotency_key)
);
create index if not exists story_desk_jobs_client_state_idx on story_desk_jobs(client_id, state);

create table if not exists story_desk_context_snapshots (
  id text primary key,
  client_id text not null references story_desk_clients(id),
  job_id text not null,
  content jsonb not null,
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique (client_id, id),
  unique (client_id, job_id),
  foreign key (client_id, job_id) references story_desk_jobs(client_id, id)
);

create table if not exists story_desk_boards (
  id text primary key,
  client_id text not null references story_desk_clients(id),
  job_id text not null,
  title text not null,
  opportunities jsonb not null,
  body text not null,
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique (client_id, id),
  unique (client_id, job_id),
  foreign key (client_id, job_id) references story_desk_jobs(client_id, id)
);

create table if not exists story_desk_brief_versions (
  id text primary key,
  client_id text not null references story_desk_clients(id),
  job_id text not null,
  board_id text not null,
  brief_id text not null,
  opportunity_id text not null,
  version integer not null check (version > 0),
  fields jsonb not null,
  body text not null,
  content_hash text not null,
  current boolean not null default true,
  created_at timestamptz not null default now(),
  unique (client_id, id),
  unique (client_id, brief_id, version),
  foreign key (client_id, job_id) references story_desk_jobs(client_id, id),
  foreign key (client_id, board_id) references story_desk_boards(client_id, id)
);
create index if not exists story_desk_brief_current_idx
  on story_desk_brief_versions(client_id, brief_id, current);

create table if not exists story_desk_gate_reports (
  id text primary key,
  client_id text not null references story_desk_clients(id),
  job_id text not null,
  brief_version_id text not null,
  mode text not null check (mode = 'story_desk_commissioning'),
  criteria jsonb not null,
  total integer not null check (total between 5 and 25),
  disposition text not null check (disposition in ('do_not_commission', 'commission_with_review', 'ready_to_commission')),
  notes text not null,
  created_at timestamptz not null default now(),
  unique (client_id, brief_version_id, mode),
  foreign key (client_id, job_id) references story_desk_jobs(client_id, id),
  foreign key (client_id, brief_version_id) references story_desk_brief_versions(client_id, id)
);

create table if not exists story_desk_decisions (
  id text primary key,
  client_id text not null references story_desk_clients(id),
  job_id text not null,
  brief_id text not null,
  version integer not null,
  content_hash text not null,
  decision text not null check (decision in ('approved', 'rejected')),
  actor_id text not null,
  created_at timestamptz not null default now(),
  foreign key (client_id, job_id) references story_desk_jobs(client_id, id),
  foreign key (client_id, brief_id, version)
    references story_desk_brief_versions(client_id, brief_id, version)
);
create index if not exists story_desk_decisions_client_brief_idx
  on story_desk_decisions(client_id, brief_id);

create table if not exists story_desk_job_events (
  id bigserial primary key,
  client_id text not null references story_desk_clients(id),
  job_id text not null,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (client_id, job_id) references story_desk_jobs(client_id, id)
);
create index if not exists story_desk_events_client_job_idx
  on story_desk_job_events(client_id, job_id);

create table if not exists story_desk_box_exports (
  id text primary key,
  client_id text not null references story_desk_clients(id),
  job_id text not null,
  artifact_type text not null check (artifact_type in ('opportunity_board', 'brief')),
  artifact_id text not null,
  version integer not null,
  content_hash text not null,
  box_file_id text not null,
  export_hash text not null,
  created_at timestamptz not null default now(),
  unique (client_id, artifact_type, artifact_id, version, export_hash),
  foreign key (client_id, job_id) references story_desk_jobs(client_id, id)
);
create index if not exists story_desk_box_exports_client_job_idx
  on story_desk_box_exports(client_id, job_id);

create table if not exists story_desk_idempotency (
  client_id text not null references story_desk_clients(id),
  idempotency_key text not null,
  request_hash text not null,
  job_id text not null,
  created_at timestamptz not null default now(),
  primary key (client_id, idempotency_key),
  foreign key (client_id, job_id) references story_desk_jobs(client_id, id)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'story_desk_jobs_context_snapshot_fk'
      and conrelid = 'public.story_desk_jobs'::regclass
  ) then
    alter table story_desk_jobs
      add constraint story_desk_jobs_context_snapshot_fk
      foreign key (client_id, context_snapshot_id)
      references story_desk_context_snapshots(client_id, id)
      deferrable initially deferred;
  end if;
end
$$;

-- Supabase exposes the public schema through its Data API by default. The
-- server connects directly to Postgres as the table owner, while browser/API
-- roles must never read or mutate private client context or generated work.
do $$
declare
  table_name text;
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format(
        'revoke all privileges on schema pg_pgrst_no_exposed_schemas from %I',
        role_name
      );
    end if;
  end loop;

  foreach table_name in array array[
    'story_desk_clients',
    'story_desk_client_identities',
    'story_desk_jobs',
    'story_desk_context_snapshots',
    'story_desk_boards',
    'story_desk_brief_versions',
    'story_desk_gate_reports',
    'story_desk_decisions',
    'story_desk_job_events',
    'story_desk_box_exports',
    'story_desk_idempotency'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all privileges on table public.%I from public', table_name);

    foreach role_name in array array['anon', 'authenticated', 'service_role']
    loop
      if exists (select 1 from pg_roles where rolname = role_name) then
        execute format(
          'revoke all privileges on table public.%I from %I',
          table_name,
          role_name
        );
      end if;
    end loop;
  end loop;

  if exists (
    select 1
    from pg_class
    where oid = to_regclass('public.story_desk_job_events_id_seq')
  ) then
    execute 'revoke all privileges on sequence public.story_desk_job_events_id_seq from public';
    foreach role_name in array array['anon', 'authenticated', 'service_role']
    loop
      if exists (select 1 from pg_roles where rolname = role_name) then
        execute format(
          'revoke all privileges on sequence public.story_desk_job_events_id_seq from %I',
          role_name
        );
      end if;
    end loop;
  end if;

  execute 'alter default privileges in schema public revoke all on tables from public';
  execute 'alter default privileges in schema public revoke all on sequences from public';
  foreach role_name in array array['anon', 'authenticated', 'service_role']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format(
        'alter default privileges in schema public revoke all on tables from %I',
        role_name
      );
      execute format(
        'alter default privileges in schema public revoke all on sequences from %I',
        role_name
      );
    end if;
  end loop;
end
$$;

commit;
