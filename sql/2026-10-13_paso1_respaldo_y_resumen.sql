-- PASO 1 de 2 · Respaldo + resumen (NO borra ni modifica datos en vivo)
-- Correr en el SQL Editor de Supabase. Es seguro correrlo más de una vez.
--
-- 1) Copia la fila de kpi_repo_state a kpi_repo_state_backup_20261013
--    (id, data, updated_at y backed_up_at) y los archivos de soporte de
--    Verónica a kpi_repo_files_backup_20261013.
-- 2) Muestra en una sola tabla: confirmación del respaldo, todo lo que hay
--    guardado para 'veronica', y lo que tienen 'edgar' y 'marifer' para
--    revisar si hay algo de demostración.

-- La tabla de archivos la crea la app sola; se asegura aquí por si nadie
-- ha subido archivos todavía (mismo esquema que api/_files.js).
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

create table if not exists kpi_repo_state_backup_20261013 as
  select id, data, updated_at, now() as backed_up_at from kpi_repo_state;

create table if not exists kpi_repo_files_backup_20261013 as
  select f.*, now() as backed_up_at from kpi_repo_files f where f.exec_id = 'veronica';

with s as (select data from kpi_repo_state where id = 'default'),
score_rows as (
  select e.key as exec_id, m.key as mes, k.key as kpi, k.value as rec
    from s, jsonb_each(s.data->'scores') e, jsonb_each(e.value) m, jsonb_each(m.value) k
   where e.key in ('veronica', 'edgar', 'marifer')
)
select '0 RESPALDO' as seccion, '' as ejecutivo, '' as mes,
       'kpi_repo_state_backup_20261013: ' || count(*) || ' fila(s), respaldo del ' || to_char(max(backed_up_at), 'YYYY-MM-DD HH24:MI') as detalle
  from kpi_repo_state_backup_20261013
union all
select '0 RESPALDO', 'veronica', '',
       'kpi_repo_files_backup_20261013: ' || count(*) || ' archivo(s) de Verónica'
  from kpi_repo_files_backup_20261013
union all
-- Calificaciones / comentarios / estado de revisión / adjuntos por KPI (solo registros con algo guardado)
select '1 CALIFICACIONES', exec_id, mes,
       kpi || ' · score=' || coalesce(rec->>'score', 'null')
       || case when coalesce(rec->>'comment', '') <> '' then ' · comentario gerente="' || left(rec->>'comment', 80) || '"' else '' end
       || case when coalesce(rec->>'execComment', '') <> '' then ' · comentario ejecutivo="' || left(rec->>'execComment', 80) || '"' else '' end
       || case when rec ? 'review' then ' · revisión=' || coalesce(rec#>>'{review,status}', '') else '' end
       || case when jsonb_array_length(coalesce(rec->'attachments', '[]'::jsonb)) > 0
               then ' · adjuntos=' || (select string_agg(a->>'name', ', ') from jsonb_array_elements(rec->'attachments') a) else '' end
  from score_rows
 where rec->>'score' is not null or coalesce(rec->>'comment', '') <> '' or coalesce(rec->>'execComment', '') <> ''
    or rec ? 'review' or jsonb_array_length(coalesce(rec->'attachments', '[]'::jsonb)) > 0
union all
select '2 ARCHIVOS (tabla)', f.exec_id, f.month, f.kpi_id || ' · ' || f.name || ' · ' || coalesce(f.size::text, '?') || ' bytes · ' || to_char(f.uploaded_at, 'YYYY-MM-DD HH24:MI')
  from kpi_repo_files f where f.exec_id in ('veronica', 'edgar', 'marifer')
union all
select '3 ' || sec.name, e.key, x.key, left(x.value::text, 200)
  from s,
       (values ('midReviews'), ('plans'), ('acks'), ('monthlyVariables'), ('variableAdjustments')) as sec(name),
       jsonb_each(coalesce(s.data->sec.name, '{}'::jsonb)) e,
       jsonb_each(case when jsonb_typeof(e.value) = 'object' then e.value else '{}'::jsonb end) x
 where e.key in ('veronica', 'edgar', 'marifer')
union all
select '4 LOGS', l->>'execId', coalesce(l->>'month', ''),
       to_char(to_timestamp((l->>'ts')::bigint / 1000.0), 'YYYY-MM-DD HH24:MI') || ' · ' || coalesce(l->>'role', '') || ' · ' || left(l->>'text', 120)
  from s, jsonb_array_elements(coalesce(s.data->'logs', '[]'::jsonb)) l
 where l->>'execId' in ('veronica', 'edgar', 'marifer')
order by 1, 2, 3, 4;
