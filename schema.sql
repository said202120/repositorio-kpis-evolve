-- Run once in the Supabase SQL Editor for this project.
create table if not exists kpi_repo_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
