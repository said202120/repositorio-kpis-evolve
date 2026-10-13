const { getPool } = require('./_db');
const { getSession } = require('./_auth');
const { CLEANUP_ID } = require('./_cleanup');

// Admin-only page with the report of the 2026-10-13 cleanup of Verónica's
// test data: the backup, what was removed and, for review only, what
// Edgar and María Fernanda have stored.
const esc = v => String(v === null || v === undefined ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function scoresTable(rows) {
  if (!rows || !rows.length) return '<p class="muted">Nada guardado.</p>';
  return '<table><tr><th>Mes</th><th>KPI</th><th>Calificación</th><th>Comentario gerente</th><th>Comentario ejecutivo</th><th>Revisión</th><th>Archivos</th></tr>' +
    rows.map(r => `<tr><td>${esc(r.month)}</td><td>${esc(r.kpi)}</td><td>${esc(r.score === null ? '—' : r.score)}</td><td>${esc(r.comment)}</td><td>${esc(r.execComment)}</td><td>${esc(r.review || '')}</td><td>${esc((r.files || []).join(', '))}</td></tr>`).join('') +
    '</table>';
}

function mapsList(maps) {
  const keys = Object.keys(maps || {});
  if (!keys.length) return '<p class="muted">Nada guardado.</p>';
  return '<ul>' + keys.map(k => `<li><b>${esc(k)}</b>: <code>${esc(JSON.stringify(maps[k]))}</code></li>`).join('') + '</ul>';
}

module.exports = async (req, res) => {
  const session = getSession(req);
  if (!session || session.role !== 'admin') {
    res.status(401).send('Inicia sesión como gerente o director para ver este reporte.');
    return;
  }
  try {
    const db = getPool();
    const reg = await db.query(`select to_regclass('public.kpi_repo_cleanup_report') as t`);
    const rows = reg.rows[0].t ? (await db.query('select report from kpi_repo_cleanup_report where id = $1', [CLEANUP_ID])).rows : [];
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (!rows.length) {
      res.status(200).send('<p style="font-family:sans-serif">La limpieza todavía no ha corrido. Abre el repositorio (página principal) y vuelve a cargar este enlace.</p>');
      return;
    }
    const r = rows[0].report;
    const rm = r.removedForVeronica;
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reporte de limpieza</title>
<style>body{font-family:Inter,Arial,sans-serif;margin:24px;color:#1d2433;max-width:1100px}h1{font-size:22px}h2{font-size:17px;margin-top:28px}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #d0d5dd;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f2f4f7}
.muted{color:#667085}code{font-size:12px;word-break:break-all}.ok{background:#ecfdf3;border:1px solid #abefc6;padding:10px 12px;border-radius:8px}</style></head><body>
<h1>Limpieza de pruebas de Verónica Ochoa Manzo</h1>
<p class="ok">Ejecutada el ${esc(new Date(r.ranAt).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }))} (hora CDMX).<br>
Respaldo: tabla <b>${esc(r.backup.table)}</b> (${esc(r.backup.rows)} fila) y <b>${esc(r.backup.filesTable)}</b> (${esc(r.backup.veronicaFiles)} archivo(s) de Verónica).</p>
<h2>1. Borrado de Verónica</h2>
<h3>Calificaciones, comentarios, revisiones y adjuntos</h3>${scoresTable(rm.scores)}
<h3>Medio mes, planes, acuses, bonos y ajustes</h3>${mapsList(rm.otherMaps)}
<h3>Bitácora (${rm.logs.length} línea(s))</h3>${rm.logs.length ? '<ul>' + rm.logs.map(l => `<li>${esc(new Date(l.ts).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }))} · ${esc(l.month)} · ${esc(l.role)} · ${esc(l.text)}</li>`).join('') + '</ul>' : '<p class="muted">Sin líneas.</p>'}
<h3>Archivos de soporte</h3>${rm.filesInTable.length ? '<ul>' + rm.filesInTable.map(f => `<li>${esc(f.month)} · ${esc(f.kpi_id)} · ${esc(f.name)}</li>`).join('') + '</ul>' : '<p class="muted">Ninguno.</p>'}
<h2>2. Solo para revisar (NO se borró nada)</h2>
<h3>Edgar Alan Obregón (edgar)</h3>${scoresTable(r.notTouched_reviewOnly.edgar.scores)}${mapsList(r.notTouched_reviewOnly.edgar.otherMaps)}
<h3>María Fernanda Quintanar (marifer)</h3>${scoresTable(r.notTouched_reviewOnly.marifer.scores)}${mapsList(r.notTouched_reviewOnly.marifer.otherMaps)}
</body></html>`;
    res.status(200).send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al leer el reporte');
  }
};
