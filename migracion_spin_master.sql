-- Cambio de equipo: Spin Master reemplaza a Bepensa; Verónica Ochoa Manzo
-- reemplaza a Daniel Mena. Correr UNA vez en el SQL Editor de Supabase.
-- Es seguro correrlo más de una vez (no toca a said, director, edgar ni marifer).
-- La contraseña temporal de 'veronica' se entrega por separado; ella la
-- cambia al entrar con "Cambiar contraseña".

begin;

-- Daniel ya no debe poder entrar.
delete from kpi_repo_users where username = 'daniele';

-- Alta de Verónica (ligada al ejecutivo 'veronica' dentro de los datos).
insert into kpi_repo_users (username, password_hash, role, exec_id) values
  ('veronica', '$2b$10$bD0kyp.1Z8QqTn2uEfms2uDNCttkOQi8F/ez1ayU7SCj4BQyIeF9i', 'ejecutivo', 'veronica')
on conflict (username) do update
  set password_hash = excluded.password_hash,
      role = excluded.role,
      exec_id = excluded.exec_id;

commit;

-- Verificación (opcional): debe listar said, director, edgar, marifer, veronica
-- y NO debe aparecer daniele.
select username, role, exec_id from kpi_repo_users order by username;
