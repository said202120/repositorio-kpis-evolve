const { getPool } = require('./_db');
const { getSession } = require('./_auth');
const { ensureFilesTable } = require('./_files');

// Admin-only page to find an ejecutivo's support files:
//   - files currently stored (kpi_repo_files), every month;
//   - files removed by the 2026-10-13 cleanup and kept in
//     kpi_repo_files_backup_20261013, with download and "restore" buttons;
//   - the log lines about uploads and removals.
// GET  /api/file-audit?exec=veronica            → the page
// GET  /api/file-audit?backup=<id>              → download a backed-up file
// POST /api/file-audit {restore: <id>}          → put a backed-up file back
//      into its KPI/month (row in kpi_repo_files + metadata in the blob).

const ROW_ID = 'default';
const BACKUP = 'kpi_repo_files_backup_20261013';
const esc = v => String(v === null || v === undefined ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const when = v => v ? new Date(v).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' }) : '';

async function backupExists(db) {
  const { rows } = await db.query(`select to_regclass('public.${BACKUP}') as t`);
  return !!rows[0].t;
}

function kpiNames(data, execId) {
  const exec = (data.executives || []).find(e => e && e.id === execId);
  const out = {};
  ((exec && exec.categories) || []).forEach(c => (c.kpis || []).forEach(k => { out[k.id] = k.name; }));
  return out;
}

function sendFile(res, file) {
  const comma = file.data.indexOf(',');
  const buf = Buffer.from(comma === -1 ? file.data : file.data.slice(comma + 1), 'base64');
  const asciiName = file.name.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
  res.setHeader('Content-Type', file.type || 'application/octet-stream');
  res.setHeader('Content-Length', buf.length);
  res.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).end(buf);
}

async function restore(db, id) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: fr } = await client.query(`select * from ${BACKUP} where id = $1 limit 1`, [id]);
    const f = fr[0];
    if (!f) throw Object.assign(new Error('No está en el respaldo'), { status: 404 });
    const { rows } = await client.query('select data from kpi_repo_state where id = $1 for update', [ROW_ID]);
    const data = rows[0].data;
    if (!data.scores) data.scores = {};
    if (!data.scores[f.exec_id]) data.scores[f.exec_id] = {};
    if (!data.scores[f.exec_id][f.month]) data.scores[f.exec_id][f.month] = {};
    const recs = data.scores[f.exec_id][f.month];
    if (!recs[f.kpi_id]) recs[f.kpi_id] = { score: null, comment: '' };
    const rec = recs[f.kpi_id];
    if (!rec.attachments) rec.attachments = rec.attachment ? [rec.attachment] : [];
    delete rec.attachment;
    let already = rec.attachments.some(a => a && a.id === f.id);
    await client.query(
      `insert into kpi_repo_files (id, exec_id, month, kpi_id, name, type, size, data, uploaded_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (id) do nothing`,
      [f.id, f.exec_id, f.month, f.kpi_id, f.name, f.type, f.size, f.data, f.uploaded_at]);
    if (!already) {
      rec.attachments.push({ id: f.id, name: f.name, type: f.type, size: f.size, uploadedAt: new Date(f.uploaded_at).getTime(), restoredAt: Date.now() });
      rec.attachments.sort((a, b) => (a.uploadedAt || 0) - (b.uploadedAt || 0));
      if (!data.logs) data.logs = [];
      data.logs.unshift({ ts: Date.now(), execId: f.exec_id, month: f.month, role: 'manager', text: `Restauró el archivo "${f.name}" desde el respaldo del 13 oct` });
      if (data.logs.length > 300) data.logs.length = 300;
      await client.query(
        `insert into kpi_repo_state (id, data, updated_at) values ($1, $2, now())
         on conflict (id) do update set data = excluded.data, updated_at = now()`, [ROW_ID, data]);
    }
    await client.query('COMMIT');
    return { name: f.name, month: f.month, kpi: f.kpi_id, already };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = async (req, res) => {
  const session = getSession(req);
  if (!session || session.role !== 'admin') {
    res.status(401).send('Inicia sesión como gerente o director para ver esta página.');
    return;
  }
  const db = getPool();
  try {
    await ensureFilesTable();
    const query = req.query || {};

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      if (!(await backupExists(db))) { res.status(404).json({ error: 'No existe el respaldo' }); return; }
      const r = await restore(db, String(body.restore || ''));
      res.status(200).json({ ok: true, ...r });
      return;
    }

    if (query.backup) {
      if (!(await backupExists(db))) { res.status(404).send('No existe el respaldo'); return; }
      const { rows } = await db.query(`select name, type, data from ${BACKUP} where id = $1 limit 1`, [String(query.backup)]);
      if (!rows[0]) { res.status(404).send('Archivo no encontrado en el respaldo'); return; }
      sendFile(res, rows[0]);
      return;
    }

    const execId = typeof query.exec === 'string' && /^[a-z0-9_-]{1,40}$/i.test(query.exec) ? query.exec : 'veronica';
    const { rows: sr } = await db.query('select data from kpi_repo_state where id = $1', [ROW_ID]);
    const data = (sr[0] && sr[0].data) || {};
    const names = kpiNames(data, execId);
    const exec = (data.executives || []).find(e => e && e.id === execId);

    const current = (await db.query(
      `select id, month, kpi_id, name, size, uploaded_at from kpi_repo_files where exec_id = $1 order by month, kpi_id, uploaded_at`, [execId])).rows;
    const inBlob = new Set();
    Object.values((data.scores || {})[execId] || {}).forEach(m => Object.values(m || {}).forEach(r => (r && r.attachments || []).forEach(a => a && inBlob.add(a.id))));
    const backup = (await backupExists(db)) ? (await db.query(
      `select id, month, kpi_id, name, size, uploaded_at from ${BACKUP} where exec_id = $1 order by month, kpi_id, uploaded_at`, [execId])).rows : null;
    const currentIds = new Set(current.map(f => f.id));
    const logs = (data.logs || []).filter(l => l && l.execId === execId && /archivo/i.test(l.text || ''));

    const row = (f, extra) => `<tr><td>${esc(f.month)}</td><td>${esc(names[f.kpi_id] || f.kpi_id)}</td><td>${esc(f.name)}</td><td>${esc(f.size ? Math.round(f.size / 1024) + ' KB' : '')}</td><td>${esc(when(f.uploaded_at))}</td><td>${extra}</td></tr>`;
    const head = '<tr><th>Mes</th><th>KPI</th><th>Archivo</th><th>Tamaño</th><th>Subido</th><th></th></tr>';
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Archivos de ${esc(exec ? exec.name : execId)}</title>
<style>body{font-family:Inter,Arial,sans-serif;margin:24px;color:#1d2433;max-width:1150px}h1{font-size:21px}h2{font-size:16px;margin-top:28px}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #d0d5dd;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f2f4f7}
.muted{color:#667085}a.btn,button{font:inherit;font-size:12px;font-weight:700;border:0;border-radius:7px;padding:5px 10px;cursor:pointer;text-decoration:none;display:inline-block;margin:2px 0}
a.btn{background:#2563eb;color:#fff}button{background:#067647;color:#fff}.tag{font-size:12px;font-weight:700;color:#067647}</style></head><body>
<h1>Archivos de soporte · ${esc(exec ? exec.name : execId)}</h1>
<p class="muted">Otros ejecutivos: <a href="?exec=veronica">veronica</a> · <a href="?exec=edgar">edgar</a> · <a href="?exec=marifer">marifer</a> · <a href="?exec=daniela">daniela</a></p>
<h2>1. Archivos guardados hoy (${current.length})</h2>
${current.length ? '<table>' + head + current.map(f => row(f, `<a class="btn" href="/api/file?id=${encodeURIComponent(f.id)}">Descargar</a>${inBlob.has(f.id) ? '' : ' <span class="muted">(no ligado a ningún KPI)</span>'}`)).join('') + '</table>' : '<p class="muted">Ninguno.</p>'}
<h2>2. Borrados en la limpieza del 13 de octubre (respaldo ${BACKUP})</h2>
${backup === null ? '<p class="muted">No existe la tabla de respaldo.</p>' : backup.length ? '<table>' + head + backup.map(f => row(f,
  `<a class="btn" href="?backup=${encodeURIComponent(f.id)}">Descargar</a> ` + (currentIds.has(f.id) ? '<span class="tag">✓ Restaurado</span>' : `<button onclick="restore('${esc(f.id)}', this)">Restaurar en su KPI</button>`))).join('') + '</table>' : '<p class="muted">El respaldo no tiene archivos de este ejecutivo.</p>'}
<h2>3. Bitácora de cargas y eliminaciones (${logs.length})</h2>
${logs.length ? '<ul>' + logs.map(l => `<li>${esc(when(l.ts))} · ${esc(l.month)} · ${esc(l.role)} · ${esc(l.text)}</li>`).join('') + '</ul>' : '<p class="muted">Sin registros.</p>'}
<p class="muted">Un archivo que el ejecutivo quitó con "Quitar" después del 13 de octubre no se respalda y no aparece aquí; en la bitácora se ve como "Eliminó archivo adjunto".</p>
<script>
async function restore(id, btn){
  btn.disabled = true; btn.textContent = 'Restaurando…';
  const r = await fetch(location.pathname, { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ restore: id }) });
  const j = await r.json().catch(() => ({}));
  if (r.ok) { btn.outerHTML = '<span class="tag">✓ Restaurado en ' + (j.month || '') + '</span>'; }
  else { btn.disabled = false; btn.textContent = 'Reintentar'; alert(j.error || 'No se pudo restaurar'); }
}
</script></body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(html);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).send(err.status ? err.message : 'Error al leer los archivos');
  }
};
