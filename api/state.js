const { getPool } = require('./_db');
const { getSession } = require('./_auth');
const { ensureFilesTable, newFileId, insertFile, extractInlineFiles } = require('./_files');
const { hasRun, runVeronicaCleanup, scrubStaleCopy } = require('./_cleanup');

const ROW_ID = 'default';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function fetchRow(db) {
  const { rows } = await db.query('select data from kpi_repo_state where id = $1', [ROW_ID]);
  return rows[0] ? rows[0].data : null;
}

async function saveRow(db, data) {
  await db.query(
    `insert into kpi_repo_state (id, data, updated_at)
     values ($1, $2, now())
     on conflict (id) do update set data = excluded.data, updated_at = now()`,
    [ROW_ID, data]
  );
}

function blobHasInlineFiles(data) {
  return JSON.stringify(data.scores || {}).includes('"dataUrl":"');
}

// One-time upkeep on the stored row (moving inline files out, the
// 2026-10-13 test-data cleanup), done under the row lock.
async function prepareRow(db) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('select data from kpi_repo_state where id = $1 for update', [ROW_ID]);
    const data = rows[0].data;
    const cleaned = await runVeronicaCleanup(client, data);
    const moved = await extractInlineFiles(client, data);
    if (cleaned || moved) await saveRow(client, data);
    await client.query('COMMIT');
    return data;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// An "ejecutivo" session must never see or receive another executive's
// data, even though everything lives in one shared JSON blob. Build a
// slice containing only their own record before it leaves the server.
function filterForExec(data, execId) {
  const exec = (data.executives || []).find(e => e.id === execId);
  return {
    executives: exec ? [exec] : [],
    scores: { [execId]: (data.scores || {})[execId] || {} },
    midReviews: { [execId]: (data.midReviews || {})[execId] || {} },
    plans: { [execId]: (data.plans || {})[execId] || {} },
    acks: { [execId]: (data.acks || {})[execId] || {} },
    variableAdjustments: { [execId]: (data.variableAdjustments || {})[execId] || {} },
    logs: (data.logs || []).filter(l => l.execId === execId)
  };
}

function pushLog(data, execId, month, role, text) {
  if (!data.logs) data.logs = [];
  data.logs.unshift({ ts: Date.now(), execId, month, role, text });
  if (data.logs.length > 300) data.logs.length = 300;
}

function ensureScoreRec(data, execId, month, kpiId) {
  if (!data.scores) data.scores = {};
  if (!data.scores[execId]) data.scores[execId] = {};
  if (!data.scores[execId][month]) data.scores[execId][month] = {};
  if (!data.scores[execId][month][kpiId]) data.scores[execId][month][kpiId] = { score: null, comment: '' };
  return data.scores[execId][month][kpiId];
}

// Normalizes a score record to the {attachments:[...]} shape, migrating
// any pre-multi-file record that still has the old singular `attachment`.
function migrateAttachments(rec) {
  if (!rec.attachments) rec.attachments = rec.attachment ? [rec.attachment] : [];
  delete rec.attachment;
  rec.attachments.forEach(a => { if (a && !a.id) a.id = `legacy-${a.uploadedAt || Date.now()}`; });
  return rec.attachments;
}

async function applyExecAction(db, data, execId, action) {
  if (action.type === 'toggleplan') {
    const item = data.plans && data.plans[execId] && data.plans[execId][action.month] &&
      data.plans[execId][action.month].find(i => i.id === action.itemId);
    if (!item) throw new HttpError(404, 'Acción no encontrada');
    item.done = !item.done;
    pushLog(data, execId, action.month, 'ejecutivo', `Marcó acción "${item.text}" como ${item.done ? 'completada' : 'pendiente'}`);
    return;
  }

  if (action.type === 'sign') {
    if (!data.acks) data.acks = {};
    if (!data.acks[execId]) data.acks[execId] = {};
    data.acks[execId][action.month] = { ackedAt: Date.now() };
    pushLog(data, execId, action.month, 'ejecutivo', 'Firmó acuse de recibido de su retroalimentación');
    return;
  }

  if (action.type === 'setExecComment') {
    const rec = ensureScoreRec(data, execId, action.month, action.kpiId);
    rec.execComment = typeof action.execComment === 'string' ? action.execComment.slice(0, 4000) : '';
    pushLog(data, execId, action.month, 'ejecutivo', 'Comentó en un KPI');
    return;
  }

  if (action.type === 'uploadFile') {
    const att = action.attachment;
    if (!att || typeof att.name !== 'string' || typeof att.dataUrl !== 'string') {
      throw new HttpError(400, 'Archivo inválido');
    }
    if (!ALLOWED_ATTACHMENT_EXT.test(att.name)) {
      throw new HttpError(400, 'Solo se permiten archivos Excel, PDF o PowerPoint');
    }
    if (att.dataUrl.length > MAX_ATTACHMENT_DATA_URL_LENGTH) {
      throw new HttpError(413, 'El archivo no debe superar 3 MB');
    }
    const rec = ensureScoreRec(data, execId, action.month, action.kpiId);
    const attachments = migrateAttachments(rec);
    if (attachments.length >= MAX_ATTACHMENTS_PER_KPI) {
      throw new HttpError(400, `Ya se alcanzó el máximo de ${MAX_ATTACHMENTS_PER_KPI} archivos para este KPI`);
    }
    // Keep the browser's id when it is well-formed and unused, so the
    // client's optimistic copy can download / remove it before a reload.
    const clientId = typeof att.id === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(att.id) && !attachments.some(a => a && a.id === att.id) ? att.id : null;
    // KPIs split into several reports tag each file with the report it belongs to.
    const slot = typeof att.slot === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(att.slot) ? att.slot : null;
    if (slot && attachments.some(a => a && a.slot === slot)) {
      throw new HttpError(400, 'Este reporte ya tiene un archivo');
    }
    const meta = {
      id: clientId || newFileId(),
      name: att.name,
      type: typeof att.type === 'string' ? att.type : 'application/octet-stream',
      size: typeof att.size === 'number' ? att.size : null,
      uploadedAt: Date.now(),
      ...(slot ? { slot } : {})
    };
    await ensureFilesTable();
    if (!(await insertFile(db, { ...meta, execId, month: action.month, kpiId: action.kpiId, dataUrl: att.dataUrl }))) {
      meta.id = newFileId();
      await insertFile(db, { ...meta, execId, month: action.month, kpiId: action.kpiId, dataUrl: att.dataUrl });
    }
    attachments.push(meta);
    // A new file means the manager has something new to review.
    if (rec.review && rec.review.status) rec.review = { status: 'pendiente', at: Date.now() };
    pushLog(data, execId, action.month, 'ejecutivo', `Adjuntó archivo "${att.name}" (${attachments.length}/${MAX_ATTACHMENTS_PER_KPI})`);
    return;
  }

  if (action.type === 'removeFile') {
    const rec = data.scores && data.scores[execId] && data.scores[execId][action.month] && data.scores[execId][action.month][action.kpiId];
    if (rec) {
      const attachments = migrateAttachments(rec);
      const idx = attachments.findIndex(a => a.id === action.attachmentId);
      if (idx !== -1) {
        attachments.splice(idx, 1);
        await ensureFilesTable();
        await db.query('delete from kpi_repo_files where id = $1 and exec_id = $2', [action.attachmentId, execId]);
      }
    }
    pushLog(data, execId, action.month, 'ejecutivo', 'Eliminó archivo adjunto');
    return;
  }

  throw new HttpError(400, 'Acción no soportada');
}

// The manager's client saves the whole blob, from a copy loaded earlier.
// Everything an ejecutivo owns (support files, their KPI comments, their
// acknowledgements and their log lines) is taken from the current row
// instead, so a manager save can never undo an upload or comment that
// happened after the manager's page loaded.
function mergeExecOwned(incoming, current) {
  if (!current) return incoming;
  const inScores = incoming.scores || (incoming.scores = {});
  const curScores = current.scores || {};
  const execIds = new Set([...Object.keys(inScores), ...Object.keys(curScores)]);
  execIds.forEach(execId => {
    const inMonths = inScores[execId] || (inScores[execId] = {});
    const curMonths = curScores[execId] || {};
    new Set([...Object.keys(inMonths), ...Object.keys(curMonths)]).forEach(month => {
      const inKpis = inMonths[month] || (inMonths[month] = {});
      const curKpis = curMonths[month] || {};
      new Set([...Object.keys(inKpis), ...Object.keys(curKpis)]).forEach(kpiId => {
        const cur = curKpis[kpiId];
        const rec = inKpis[kpiId] || (inKpis[kpiId] = cur ? { ...cur } : { score: null, comment: '' });
        delete rec.attachment;
        if (cur && (cur.attachments || cur.attachment)) rec.attachments = cur.attachments || [cur.attachment];
        else delete rec.attachments;
        if (cur && cur.execComment !== undefined) rec.execComment = cur.execComment;
        else delete rec.execComment;
      });
    });
  });
  incoming.acks = current.acks || {};
  const seen = new Set();
  incoming.logs = [...(current.logs || []), ...(incoming.logs || [])]
    .filter(l => {
      const key = `${l.ts}|${l.execId}|${l.role}|${l.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 300);
  return incoming;
}

// Each upload request still carries one file as base64, so cap it well
// under Vercel's ~4.5MB serverless request body limit once base64 overhead
// (~33%) is accounted for. A 3MB raw file
// base64-encodes to exactly 4MB; 4.2MB leaves headroom for the data-URI
// prefix and JSON wrapper while staying clear of the 4.5MB hard limit.
const MAX_ATTACHMENT_DATA_URL_LENGTH = 4.2 * 1024 * 1024;
const ALLOWED_ATTACHMENT_EXT = /\.(xlsx|xls|xlsb|pdf|ppt|pptx)$/i;
const MAX_ATTACHMENTS_PER_KPI = 5;

module.exports = async (req, res) => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }

  const db = getPool();
  try {
    if (req.method === 'GET') {
      let data = await fetchRow(db);
      if (!data) {
        res.status(200).json({ data: null });
        return;
      }
      if (blobHasInlineFiles(data) || !hasRun(data)) data = await prepareRow(db);
      res.status(200).json({
        data: session.role === 'admin' ? data : filterForExec(data, session.execId)
      });
      return;
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

      if (session.role === 'admin') {
        const data = body && body.data;
        if (!data || typeof data !== 'object') {
          res.status(400).json({ error: 'Missing data' });
          return;
        }
        const client = await db.connect();
        try {
          await client.query('BEGIN');
          const { rows } = await client.query('select data from kpi_repo_state where id = $1 for update', [ROW_ID]);
          const current = rows[0] ? rows[0].data : null;
          if (current) {
            await runVeronicaCleanup(client, current);
            await extractInlineFiles(client, current);
            scrubStaleCopy(data, current);
          }
          const merged = mergeExecOwned(data, current);
          await extractInlineFiles(client, merged);
          await saveRow(client, merged);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
        res.status(200).json({ ok: true });
        return;
      }

      // "ejecutivo" sessions can never replace the whole blob — only a
      // narrow, server-validated action against their own record. The UI
      // can fire more than one save for what looks like a single change,
      // so a plain fetch-then-write here would let a later request's read
      // (of the still-stale row) clobber an earlier request's write —
      // e.g. two file uploads racing and only the last one surviving.
      // SELECT ... FOR UPDATE inside a transaction serializes that: the
      // second request blocks until the first commits, then reads the
      // already-updated row instead of the stale one.
      const action = body && body.action;
      if (!action || action.execId !== session.execId) {
        res.status(403).json({ error: 'No autorizado' });
        return;
      }

      const execId = session.execId;
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query('select data from kpi_repo_state where id = $1 for update', [ROW_ID]);
        const data = rows[0] ? rows[0].data : null;
        if (!data) {
          throw new HttpError(404, 'Sin datos');
        }

        await runVeronicaCleanup(client, data);
        await extractInlineFiles(client, data);
        await applyExecAction(client, data, execId, action);

        await client.query(
          `insert into kpi_repo_state (id, data, updated_at)
           values ($1, $2, now())
           on conflict (id) do update set data = excluded.data, updated_at = now()`,
          [ROW_ID, data]
        );
        await client.query('COMMIT');
        res.status(200).json({ ok: true });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (err instanceof HttpError) {
          res.status(err.status).json({ error: err.message });
        } else {
          throw err;
        }
      } finally {
        client.release();
      }
      return;
    }

    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};
