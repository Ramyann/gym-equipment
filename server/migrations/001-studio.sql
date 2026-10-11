create table if not exists studio_users (
  id uuid primary key,
  email text unique not null,
  name text not null default '',
  password_hash text not null,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists studio_sessions (
  token_hash text primary key,
  user_id uuid not null references studio_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists studio_sessions_user on studio_sessions(user_id);
create table if not exists studio_email_tokens (
  token_hash text primary key,
  user_id uuid not null references studio_users(id) on delete cascade,
  purpose text not null check (purpose in ('verify', 'reset')),
  expires_at timestamptz not null
);
create index if not exists studio_email_tokens_user on studio_email_tokens(user_id);
create table if not exists studio_workspaces (
  user_id uuid primary key references studio_users(id) on delete cascade,
  revision bigint not null check (revision > 0),
  data jsonb not null,
  updated_at timestamptz not null default now(),
  constraint studio_workspace_shape check (jsonb_typeof(data) = 'object' and data ? 'values' and jsonb_typeof(data->'values') = 'object'),
  constraint studio_workspace_size check (octet_length(data::text) <= 10000000)
);
create table if not exists studio_rate_limits (
  key text primary key,
  count integer not null default 1,
  expires_at timestamptz not null
);
create table if not exists studio_parts_cache (
  key text primary key,
  value text not null,
  expires_at timestamptz not null
);
create table if not exists studio_ai_usage (
  key text not null,
  day date not null,
  count integer not null default 0,
  primary key (key, day)
);
