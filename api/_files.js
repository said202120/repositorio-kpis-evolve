// KPI support files live in their own table, one row per file, instead of
// as base64 inside the shared JSON blob. With them inline, the blob grew by
// ~4MB per uploaded file, and every admin page load (GET) and every admin
// save (POST of the whole blob) carried all of them — past Vercel's ~4.5MB
// serverless body limit after just two files. The blob now keeps only the
// metadata ({id, name, type, size, uploadedAt}); /api/file serves the bytes.

const { getPool } = require('./_db');

let tableReady = null;

// Always runs on its own pooled connection (never inside a caller's
// transaction), so the DDL commits even if that transaction rolls back.
function ensureFilesTable() {
  if (!tableReady) {
    tableReady = getPool().query(
      `create table if not exists kpi_repo_files (
         id text primary key,
         exec_id text not null,
         month text not null,
         kpi_id text not null,
         name text not null,
         type text not null,
         size integer,
         data text not null,
         uploaded_at timestamptz not null default now()
       )`
    ).catch(err => { tableReady = null; throw err; });
  }
  return tableReady;
}

function newFileId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Returns false if a file with that id already exists (nothing written).
async function insertFile(db, { id, execId, month, kpiId, name, type, size, dataUrl }) {
  const r = await db.query(
    `insert into kpi_repo_files (id, exec_id, month, kpi_id, name, type, size, data)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (id) do nothing`,
    [id, execId, month, kpiId, name, type || 'application/octet-stream', typeof size === 'number' ? size : null, dataUrl]
  );
  return r.rowCount !== 0;
}

function forEachAttachmentList(data, fn) {
  Object.entries((data && data.scores) || {}).forEach(([execId, months]) => {
    Object.entries(months || {}).forEach(([month, kpis]) => {
      Object.entries(kpis || {}).forEach(([kpiId, rec]) => {
        if (!rec || typeof rec !== 'object') return;
        if (!rec.attachments && rec.attachment) rec.attachments = [rec.attachment];
        delete rec.attachment;
        if (Array.isArray(rec.attachments)) fn(rec.attachments, { execId, month, kpiId });
      });
    });
  });
}

// One-time move of files still embedded in the blob (uploaded before this
// change) into kpi_repo_files. Returns true if the blob changed.
async function extractInlineFiles(db, data) {
  const pending = [];
  forEachAttachmentList(data, (list, where) => {
    list.forEach(a => {
      if (a && typeof a.dataUrl === 'string' && a.dataUrl) pending.push({ a, where });
    });
  });
  if (!pending.length) return false;
  await ensureFilesTable();
  for (const { a, where } of pending) {
    if (!a.id) a.id = `legacy-${a.uploadedAt || Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await insertFile(db, { id: a.id, execId: where.execId, month: where.month, kpiId: where.kpiId, name: a.name || 'archivo', type: a.type, size: a.size, dataUrl: a.dataUrl });
    delete a.dataUrl;
  }
  return true;
}

module.exports = { ensureFilesTable, newFileId, insertFile, extractInlineFiles };
