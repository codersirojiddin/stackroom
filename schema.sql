-- Stackroom v3 — PostgreSQL / Neon
-- Safe to run on an existing v1 database.

create extension if not exists pgcrypto;

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  owner_id text,
  name text not null,
  slug text,
  description text,
  status text not null default 'active' check (status in ('idea', 'active', 'shipped', 'archived')),
  category text,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  stack text,
  domain text,
  deployed_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table projects add column if not exists owner_id text;
alter table projects add column if not exists slug text;
alter table projects add column if not exists description text;
alter table projects add column if not exists category text;
alter table projects add column if not exists priority text default 'normal';
alter table projects add column if not exists updated_at timestamptz not null default now();
alter table projects add column if not exists stack text;
alter table projects add column if not exists domain text;
alter table projects add column if not exists deployed_url text;
alter table projects add column if not exists notes text;

update projects set priority = 'normal' where priority is null;
update projects set updated_at = coalesce(updated_at, created_at, now()) where updated_at is null;

alter table projects drop constraint if exists projects_status_check;
alter table projects add constraint projects_status_check check (status in ('idea', 'active', 'shipped', 'archived'));
alter table projects drop constraint if exists projects_priority_check;
alter table projects add constraint projects_priority_check check (priority in ('low', 'normal', 'high'));

create table if not exists project_domains (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  hostname text not null,
  registrar text,
  dns_provider text,
  expires_at date,
  auto_renew boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists project_deployments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null default 'Production',
  provider text,
  environment text not null default 'production',
  url text,
  repository text,
  branch text,
  status text not null default 'active' check (status in ('active', 'paused', 'unknown')),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists project_databases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null default 'Primary database',
  provider text,
  database_type text,
  environment text not null default 'production',
  url text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists project_technologies (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  kind text not null default 'other',
  created_at timestamptz not null default now()
);

create table if not exists project_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  label text not null,
  url text not null,
  kind text not null default 'other',
  created_at timestamptz not null default now()
);

create index if not exists projects_owner_id_idx on projects(owner_id);
create index if not exists projects_status_idx on projects(status);
create index if not exists projects_updated_at_idx on projects(updated_at desc);
create index if not exists project_domains_project_id_idx on project_domains(project_id);
create index if not exists project_deployments_project_id_idx on project_deployments(project_id);
create index if not exists project_databases_project_id_idx on project_databases(project_id);
create index if not exists project_technologies_project_id_idx on project_technologies(project_id);
create index if not exists project_links_project_id_idx on project_links(project_id);

-- Backfill v1 fields into the richer model only when the new model is empty.
insert into project_domains (project_id, hostname)
select p.id, trim(p.domain)
from projects p
where nullif(trim(coalesce(p.domain, '')), '') is not null
  and not exists (
    select 1 from project_domains d where d.project_id = p.id
  );

insert into project_deployments (project_id, name, provider, environment, url)
select p.id, 'Production', null, 'production', trim(p.deployed_url)
from projects p
where nullif(trim(coalesce(p.deployed_url, '')), '') is not null
  and not exists (
    select 1 from project_deployments d where d.project_id = p.id
  );

insert into project_technologies (project_id, name, kind)
select p.id, trim(part), 'stack'
from projects p
cross join lateral regexp_split_to_table(coalesce(p.stack, ''), '\s*[,+]\s*') as part
where nullif(trim(part), '') is not null
  and not exists (
    select 1 from project_technologies t where t.project_id = p.id
  );

-- Give old rows a usable slug.
update projects
set slug = lower(regexp_replace(regexp_replace(trim(name), '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g'))
where nullif(trim(coalesce(slug, '')), '') is null;


-- V3 activity timeline
create table if not exists project_activity (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  action text not null,
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists project_activity_project_id_idx on project_activity(project_id, created_at desc);


-- V4 GitHub integration
create table if not exists github_connections (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique,
  github_user_id bigint not null,
  login text not null,
  avatar_url text,
  access_token_enc text not null,
  refresh_token_enc text,
  token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists github_repositories (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references github_connections(id) on delete cascade,
  github_repo_id bigint not null,
  owner text not null,
  name text not null,
  full_name text not null,
  html_url text not null,
  default_branch text,
  private boolean not null default false,
  description text,
  updated_at timestamptz not null,
  unique(connection_id, github_repo_id)
);

create table if not exists github_oauth_states (
  state_hash text primary key,
  user_id text not null,
  expires_at timestamptz not null
);

alter table projects add column if not exists github_repository_id uuid references github_repositories(id) on delete set null;

create index if not exists github_connections_user_id_idx on github_connections(user_id);
create index if not exists github_repositories_connection_id_idx on github_repositories(connection_id);
create index if not exists github_repositories_full_name_idx on github_repositories(full_name);
create index if not exists github_oauth_states_expires_at_idx on github_oauth_states(expires_at);
create index if not exists projects_github_repository_id_idx on projects(github_repository_id);
