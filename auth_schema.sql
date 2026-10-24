-- Initial setup only. DO NOT re-run this on a live database: the final
-- "on conflict ... do update" resets every listed user's password back to
-- the original temporary one. For account changes use a targeted script
-- (see migracion_spin_master.sql).
create table if not exists kpi_repo_users (
  id serial primary key,
  username text unique not null,
  password_hash text not null,
  role text not null check (role in ('admin','ejecutivo')),
  exec_id text,
  created_at timestamptz not null default now()
);

insert into kpi_repo_users (username, password_hash, role, exec_id) values
  ('said', '$2a$10$TZKc6K7dYU0D9YWZvwReG.9MjXkAtp0z3IGHhf4BHuZZ0xALce5Iq', 'admin', null),
  ('director', '$2a$10$KSAUxGZdThC63ffOzn/03Oil1BuvX7TsSJNfrb4Wp176qra25ofhW', 'admin', null),
  ('veronica', '$2b$10$bD0kyp.1Z8QqTn2uEfms2uDNCttkOQi8F/ez1ayU7SCj4BQyIeF9i', 'ejecutivo', 'veronica'),
  ('daniele', '$2a$10$y2a3AuWR99P7OGnal597te84oO2LIpxn7v3hCCFDV51MRz6TCeHi6', 'ejecutivo', 'daniel'),
  ('marifer', '$2a$10$Oj09CLeh7a1SRYF6ATCFIem0RenRH0J1ezPp9WSKQ3yYkLshLJpp6', 'ejecutivo', 'marifer')
on conflict (username) do update set password_hash = excluded.password_hash, role = excluded.role, exec_id = excluded.exec_id;
