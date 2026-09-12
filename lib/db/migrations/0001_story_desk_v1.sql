-- Alex Story Desk V.1 — PostgreSQL/Supabase schema.
-- Apply with the Supabase SQL editor or psql before enabling the MCP route.

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
  unique (client_id, idempotency_key)
);
create index if not exists story_desk_jobs_client_state_idx on story_desk_jobs(client_id, state);

create table if not exists story_desk_context_snapshots (
  id text primary key,
  client_id text not null references story_desk_clients(id),
  job_id text not null references story_desk_jobs(id),
  content jsonb not null,
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique (client_id, job_id)
);

create table if not exists story_desk_boards (
  id text primary key,
  client_id text not null references story_desk_clients(id),
  job_id text not null references story_desk_jobs(id),
  title text not null,
  opportunities jsonb not null,
  body text not null,
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique (client_id, job_id)
);

create table if not exists story_desk_brief_versions (
  id text primary key,
  client_id text not null references story_desk_clients(id),
  job_id text not null references story_desk_jobs(id),
  board_id text not null references story_desk_boards(id),
  brief_id text not null,
  opportunity_id text not null,
  version integer not null check (version > 0),
  fields jsonb not null,
  body text not null,
  content_hash text not null,
  current boolean not null default true,
  created_at timestamptz not null default now(),
  unique (client_id, brief_id, version)
);
create index if not exists story_desk_brief_current_idx
  on story_desk_brief_versions(client_id, brief_id, current);

create table if not exists story_desk_gate_reports (
  id text primary key,
  client_id text not null references story_desk_clients(id),
  job_id text not null references story_desk_jobs(id),
  brief_version_id text not null references story_desk_brief_versions(id),
  mode text not null check (mode = 'story_desk_commissioning'),
  criteria jsonb not null,
  total integer not null check (total between 5 and 25),
  disposition text not null check (disposition in ('do_not_commission', 'commission_with_review', 'ready_to_commission')),
  notes text not null,
  created_at timestamptz not null default now(),
  unique (client_id, brief_version_id, mode)
);

create table if not exists story_desk_decisions (
  id text primary key,
  client_id text not null references story_desk_clients(id),
  job_id text not null references story_desk_jobs(id),
  brief_id text not null,
  version integer not null,
  content_hash text not null,
  decision text not null check (decision in ('approved', 'rejected')),
  actor_id text not null,
  created_at timestamptz not null default now()
);
create index if not exists story_desk_decisions_client_brief_idx
  on story_desk_decisions(client_id, brief_id);

create table if not exists story_desk_job_events (
  id bigserial primary key,
  client_id text not null references story_desk_clients(id),
  job_id text not null references story_desk_jobs(id),
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists story_desk_events_client_job_idx
  on story_desk_job_events(client_id, job_id);

create table if not exists story_desk_box_exports (
  id text primary key,
  client_id text not null references story_desk_clients(id),
  job_id text not null references story_desk_jobs(id),
  artifact_type text not null check (artifact_type in ('opportunity_board', 'brief')),
  artifact_id text not null,
  version integer not null,
  content_hash text not null,
  box_file_id text not null,
  export_hash text not null,
  created_at timestamptz not null default now(),
  unique (client_id, artifact_type, artifact_id, version, export_hash)
);
create index if not exists story_desk_box_exports_client_job_idx
  on story_desk_box_exports(client_id, job_id);

create table if not exists story_desk_idempotency (
  client_id text not null references story_desk_clients(id),
  idempotency_key text not null,
  request_hash text not null,
  job_id text not null references story_desk_jobs(id),
  created_at timestamptz not null default now(),
  primary key (client_id, idempotency_key)
);

alter table story_desk_jobs
  add constraint story_desk_jobs_context_snapshot_fk
  foreign key (context_snapshot_id) references story_desk_context_snapshots(id)
  deferrable initially deferred;
