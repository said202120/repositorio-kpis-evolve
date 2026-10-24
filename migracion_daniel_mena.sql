-- Cambio de equipo: Daniel Mena regresa a Spin Master en el lugar de Alan Obregón
-- (renunció). Correr UNA vez en el SQL Editor de Supabase.
-- Es seguro correrlo más de una vez (no toca a said, director, veronica ni marifer).
-- La contraseña temporal de 'daniele' se entrega por separado; él la cambia al
-- entrar con "Cambiar contraseña".
-- NO corras auth_schema.sql completo en la base real: reinicia todas las contraseñas.

begin;

-- Alan ya no debe poder entrar (su historial se conserva en los datos, archivado).
delete from kpi_repo_users where username = 'edgar';

-- Alta de Daniel (ligado al ejecutivo 'daniel' dentro de los datos).
insert into kpi_repo_users (username, password_hash, role, exec_id) values
  ('daniele', '$2a$10$y2a3AuWR99P7OGnal597te84oO2LIpxn7v3hCCFDV51MRz6TCeHi6', 'ejecutivo', 'daniel')
on conflict (username) do update
  set password_hash = excluded.password_hash,
      role = excluded.role,
      exec_id = excluded.exec_id;

commit;

-- Verificación (opcional): debe listar said, director, marifer, veronica y daniele,
-- y NO debe aparecer edgar.
select username, role, exec_id from kpi_repo_users order by username;
