-- Run once in the Supabase SQL Editor for this project.
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
  ('daniele', '$2a$10$ElEhQhapUugh79ms4K47q.9OfW5V51utOHYAbBLyILm1OUYYE00bK', 'ejecutivo', 'daniela'),
  ('edgar', '$2a$10$wRJScz3QjmarACA2Plh0O.1I4X9UC2h2Ah6QSAZhCk7zUkNgXBh/O', 'ejecutivo', 'edgar'),
  ('marifer', '$2a$10$Oj09CLeh7a1SRYF6ATCFIem0RenRH0J1ezPp9WSKQ3yYkLshLJpp6', 'ejecutivo', 'marifer')
on conflict (username) do update set password_hash = excluded.password_hash, role = excluded.role, exec_id = excluded.exec_id;
