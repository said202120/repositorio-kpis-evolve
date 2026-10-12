-- Run once in the Supabase SQL Editor for this project.
create table if not exists kpi_repo_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- KPI support files (one row per file). /api/state creates it automatically
-- on first use; listed here for reference.
create table if not exists kpi_repo_files (
  id text primary key,
  exec_id text not null,
  month text not null,
  kpi_id text not null,
  name text not null,
  type text not null,
  size integer,
  data text not null,
  uploaded_at timestamptz not null default now()
);
