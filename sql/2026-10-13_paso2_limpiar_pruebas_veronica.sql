-- PASO 2 de 2 · Borra las pruebas de Verónica ('veronica'), en TODOS los meses.
-- Correr SOLO después del paso 1 (respaldo) y de revisar su resumen.
--
-- ANTES DE CORRERLO: cierra todas las pestañas del Repositorio de KPIs
-- abiertas como gerente o director (said / director). Una pestaña abierta
-- tiene una copia vieja de los datos y, al guardar cualquier cosa, volvería
-- a escribir las calificaciones de prueba.
--
-- Borra para 'veronica': calificaciones, comentarios (gerente y ejecutivo),
-- revisiones de evidencia, adjuntos, revisiones de medio mes, planes,
-- acuses, bonos mensuales, ajustes de variable, logs y sus archivos en
-- kpi_repo_files. Deja sus mapas vacíos ({}), como un ejecutivo nuevo.
--
-- NO toca: el ejecutivo (nombre, rol, cliente, foto, KPIs y pesos), su
-- usuario de acceso, ni nada de 'edgar', 'marifer' o 'daniela'.

begin;

-- Se detiene si no existe el respaldo del paso 1.
do $$
declare n int := 0;
begin
  if to_regclass('public.kpi_repo_state_backup_20261013') is not null then
    execute 'select count(*) from kpi_repo_state_backup_20261013 where id = ''default''' into n;
  end if;
  if n = 0 then
    raise exception 'No existe el respaldo kpi_repo_state_backup_20261013. Corre primero el paso 1.';
  end if;
end $$;

select data from kpi_repo_state where id = 'default' for update;

update kpi_repo_state
   set data = jsonb_set(
                jsonb_set(
                  jsonb_set(
                    jsonb_set(
                      jsonb_set(
                        jsonb_set(
                          data,
                          '{scores}', coalesce(data->'scores', '{}'::jsonb) || '{"veronica": {}}'::jsonb),
                        '{midReviews}', coalesce(data->'midReviews', '{}'::jsonb) || '{"veronica": {}}'::jsonb),
                      '{plans}', coalesce(data->'plans', '{}'::jsonb) || '{"veronica": {}}'::jsonb),
                    '{acks}', coalesce(data->'acks', '{}'::jsonb) || '{"veronica": {}}'::jsonb),
                  '{monthlyVariables}', coalesce(data->'monthlyVariables', '{}'::jsonb) || '{"veronica": {}}'::jsonb),
                '{variableAdjustments}', coalesce(data->'variableAdjustments', '{}'::jsonb) || '{"veronica": {}}'::jsonb)
              || jsonb_build_object('logs', coalesce(
                   (select jsonb_agg(l order by ord)
                      from jsonb_array_elements(coalesce(data->'logs', '[]'::jsonb)) with ordinality as t(l, ord)
                     where l->>'execId' is distinct from 'veronica'),
                   '[]'::jsonb)),
       updated_at = now()
 where id = 'default';

delete from kpi_repo_files where exec_id = 'veronica';

commit;

-- Verificación: Verónica en ceros; Edgar, María Fernanda y Daniele igual
-- que en el respaldo (columna "igual_que_respaldo" = true).
with now_s as (select data from kpi_repo_state where id = 'default'),
     bak as (select data from kpi_repo_state_backup_20261013 where id = 'default')
select x.exec_id,
       (select count(*) from now_s, jsonb_each(coalesce(now_s.data->'scores'->x.exec_id, '{}'::jsonb)) m, jsonb_each(m.value) k
         where k.value->>'score' is not null or coalesce(k.value->>'comment','') <> '' or coalesce(k.value->>'execComment','') <> ''
            or k.value ? 'review' or jsonb_array_length(coalesce(k.value->'attachments','[]'::jsonb)) > 0) as registros_con_datos,
       (select count(*) from now_s, jsonb_array_elements(coalesce(now_s.data->'logs','[]'::jsonb)) l where l->>'execId' = x.exec_id) as logs,
       (select count(*) from kpi_repo_files f where f.exec_id = x.exec_id) as archivos,
       (select jsonb_build_object('s', n.data->'scores'->x.exec_id, 'm', n.data->'midReviews'->x.exec_id, 'p', n.data->'plans'->x.exec_id,
                                  'a', n.data->'acks'->x.exec_id, 'v', n.data->'monthlyVariables'->x.exec_id, 'j', n.data->'variableAdjustments'->x.exec_id,
                                  'e', (select jsonb_agg(e) from jsonb_array_elements(n.data->'executives') e where e->>'id' = x.exec_id))
          = jsonb_build_object('s', b.data->'scores'->x.exec_id, 'm', b.data->'midReviews'->x.exec_id, 'p', b.data->'plans'->x.exec_id,
                               'a', b.data->'acks'->x.exec_id, 'v', b.data->'monthlyVariables'->x.exec_id, 'j', b.data->'variableAdjustments'->x.exec_id,
                               'e', (select jsonb_agg(e) from jsonb_array_elements(b.data->'executives') e where e->>'id' = x.exec_id))
          from now_s n, bak b) as igual_que_respaldo
  from (values ('veronica'), ('edgar'), ('marifer'), ('daniela')) as x(exec_id)
union all
select 'ejecutivo veronica (KPIs/foto) intacto',
       null, null, null,
       (select jsonb_agg(e) from now_s, jsonb_array_elements(now_s.data->'executives') e where e->>'id' = 'veronica')
       = (select jsonb_agg(e) from bak, jsonb_array_elements(bak.data->'executives') e where e->>'id' = 'veronica');
