const { getPool } = require('./_db');
const { getSession } = require('./_auth');

const ROW_ID = 'default';

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

// Attachments ride inside the shared JSON blob (no separate object storage
// configured), so cap them well under Vercel's ~4.5MB serverless request
// body limit once base64 overhead (~37%) is accounted for.
const MAX_ATTACHMENT_DATA_URL_LENGTH = 3.5 * 1024 * 1024;
const ALLOWED_ATTACHMENT_EXT = /\.(xlsx|xls|pdf|ppt|pptx)$/i;

module.exports = async (req, res) => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }

  const db = getPool();
  try {
    if (req.method === 'GET') {
      const data = await fetchRow(db);
      if (!data) {
        res.status(200).json({ data: null });
        return;
      }
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
        await saveRow(db, data);
        res.status(200).json({ ok: true });
        return;
      }

      // "ejecutivo" sessions can never replace the whole blob — only a
      // narrow, server-validated action against their own record.
      const action = body && body.action;
      if (!action || action.execId !== session.execId) {
        res.status(403).json({ error: 'No autorizado' });
        return;
      }

      const data = await fetchRow(db);
      if (!data) {
        res.status(404).json({ error: 'Sin datos' });
        return;
      }
      const execId = session.execId;

      if (action.type === 'toggleplan') {
        const item = data.plans && data.plans[execId] && data.plans[execId][action.month] &&
          data.plans[execId][action.month].find(i => i.id === action.itemId);
        if (!item) {
          res.status(404).json({ error: 'Acción no encontrada' });
          return;
        }
        item.done = !item.done;
        pushLog(data, execId, action.month, 'ejecutivo', `Marcó acción "${item.text}" como ${item.done ? 'completada' : 'pendiente'}`);
      } else if (action.type === 'sign') {
        if (!data.acks) data.acks = {};
        if (!data.acks[execId]) data.acks[execId] = {};
        data.acks[execId][action.month] = { ackedAt: Date.now() };
        pushLog(data, execId, action.month, 'ejecutivo', 'Firmó acuse de recibido de su retroalimentación');
      } else if (action.type === 'setExecComment') {
        const rec = ensureScoreRec(data, execId, action.month, action.kpiId);
        rec.execComment = typeof action.execComment === 'string' ? action.execComment.slice(0, 4000) : '';
        pushLog(data, execId, action.month, 'ejecutivo', 'Comentó en un KPI');
      } else if (action.type === 'uploadFile') {
        const att = action.attachment;
        if (!att || typeof att.name !== 'string' || typeof att.dataUrl !== 'string') {
          res.status(400).json({ error: 'Archivo inválido' });
          return;
        }
        if (!ALLOWED_ATTACHMENT_EXT.test(att.name)) {
          res.status(400).json({ error: 'Solo se permiten archivos Excel, PDF o PowerPoint' });
          return;
        }
        if (att.dataUrl.length > MAX_ATTACHMENT_DATA_URL_LENGTH) {
          res.status(413).json({ error: 'El archivo no debe superar 2.5 MB' });
          return;
        }
        const rec = ensureScoreRec(data, execId, action.month, action.kpiId);
        rec.attachment = {
          name: att.name,
          type: typeof att.type === 'string' ? att.type : 'application/octet-stream',
          size: typeof att.size === 'number' ? att.size : null,
          dataUrl: att.dataUrl,
          uploadedAt: Date.now()
        };
        pushLog(data, execId, action.month, 'ejecutivo', `Adjuntó archivo "${att.name}"`);
      } else if (action.type === 'removeFile') {
        const rec = data.scores && data.scores[execId] && data.scores[execId][action.month] && data.scores[execId][action.month][action.kpiId];
        if (rec) rec.attachment = null;
        pushLog(data, execId, action.month, 'ejecutivo', 'Eliminó archivo adjunto');
      } else {
        res.status(400).json({ error: 'Acción no soportada' });
        return;
      }

      await saveRow(db, data);
      res.status(200).json({ ok: true });
      return;
    }

    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};
