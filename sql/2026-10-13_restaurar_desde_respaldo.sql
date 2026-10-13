-- SOLO EN CASO DE EMERGENCIA · Regresa kpi_repo_state y los archivos de
-- Verónica a como estaban al correr el paso 1 (respaldo del 2026-10-13).
-- Cierra antes todas las pestañas del repositorio abiertas como gerente o director.

begin;

update kpi_repo_state s
   set data = b.data, updated_at = now()
  from kpi_repo_state_backup_20261013 b
 where s.id = b.id;

insert into kpi_repo_files (id, exec_id, month, kpi_id, name, type, size, data, uploaded_at)
select id, exec_id, month, kpi_id, name, type, size, data, uploaded_at
  from kpi_repo_files_backup_20261013
on conflict (id) do nothing;

commit;

select 'restaurado' as estado, updated_at from kpi_repo_state where id = 'default';
