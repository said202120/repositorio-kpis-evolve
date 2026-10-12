const { getPool } = require('./_db');
const { getSession } = require('./_auth');
const { ensureFilesTable } = require('./_files');

// Downloads one KPI support file. Admins (gerente / director) can download
// any file; an "ejecutivo" only their own.
module.exports = async (req, res) => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const id = req.query && typeof req.query.id === 'string' ? req.query.id : '';
  if (!id) {
    res.status(400).json({ error: 'Falta el archivo' });
    return;
  }

  try {
    const db = getPool();
    await ensureFilesTable();
    const { rows } = await db.query('select exec_id, name, type, data from kpi_repo_files where id = $1', [id]);
    const file = rows[0];
    if (!file || (session.role !== 'admin' && file.exec_id !== session.execId)) {
      res.status(404).json({ error: 'Archivo no encontrado' });
      return;
    }
    const comma = file.data.indexOf(',');
    const buf = Buffer.from(comma === -1 ? file.data : file.data.slice(comma + 1), 'base64');
    const asciiName = file.name.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
    res.setHeader('Content-Type', file.type || 'application/octet-stream');
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(200).end(buf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};
