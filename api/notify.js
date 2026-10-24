const { getPool } = require('./_db');
const { getSession } = require('./_auth');
const { mailConfigured, managerName: getManagerName, fromAddress, sendMail, monthLabel, escapeHtml } = require('./_mail');

// Alerts an ejecutivo by email that the manager left feedback for a month.
// The email carries no scores or comments, only the notice and a link.
// Sent through Gmail SMTP with an app password kept in Vercel env vars:
//   MAIL_USER          the sending Gmail/Google Workspace address
//   MAIL_APP_PASSWORD  its 16-character app password
//   MAIL_FROM_NAME     (optional) display name, default "Said Zapién Jiménez"
//   APP_URL            (optional) link used in the email
const DEFAULT_APP_URL = 'https://repositorio-kpis-evolve-8ae3545f-f4.vercel.app';

function buildMessage({ execName, month, appUrl, managerName, from, to }) {
  const first = escapeHtml(String(execName || '').split(' ')[0] || '');
  const mes = monthLabel(month);
  const manager = escapeHtml(managerName);
  const url = escapeHtml(appUrl);
  const text = `Hola ${String(execName || '').split(' ')[0]},\n\n` +
    `Tu gerente ${managerName} te dio retroalimentación sobre el mes de ${mes}.\n` +
    `Entra al repositorio de KPIs para revisarla y, si aplica, subir o corregir tus archivos:\n${appUrl}\n\n` +
    `Este es un aviso automático; el detalle está dentro del repositorio.`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1f2937;line-height:1.5">` +
    `<h2 style="margin:0 0 12px;color:#1d4ed8">Tienes retroalimentación nueva</h2>` +
    `<p>Hola ${first},</p>` +
    `<p>Tu gerente <b>${manager}</b> te dio retroalimentación sobre el mes de <b>${escapeHtml(mes)}</b>.</p>` +
    `<p>Entra al repositorio de KPIs para revisarla y, si aplica, subir o corregir tus archivos.</p>` +
    `<p style="margin:22px 0"><a href="${url}" style="background:#1d4ed8;color:#fff;text-decoration:none;font-weight:bold;padding:11px 20px;border-radius:8px;display:inline-block">Abrir el repositorio</a></p>` +
    `<p style="font-size:12px;color:#6b7280">Este es un aviso automático; el detalle está dentro del repositorio.</p></div>`;
  return { from, to, subject: `Tu gerente te dio retroalimentación de ${mes}`, text, html };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }
  if (session.role !== 'admin') {
    res.status(403).json({ error: 'No autorizado' });
    return;
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const execId = typeof body.execId === 'string' ? body.execId : '';
  const month = typeof body.month === 'string' ? body.month : '';
  if (!execId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    res.status(400).json({ error: 'bad_request' });
    return;
  }

  if (!mailConfigured()) {
    res.status(503).json({ error: 'not_configured' });
    return;
  }

  const db = getPool();
  try {
    let email = null;
    try {
      const { rows } = await db.query(
        `select email from kpi_repo_users where exec_id = $1 and role = 'ejecutivo' limit 1`, [execId]);
      email = rows[0] && rows[0].email ? String(rows[0].email).trim() : null;
    } catch (err) {
      if (err && err.code === '42703') email = null; // email column not created yet
      else throw err;
    }
    if (!email) {
      res.status(409).json({ error: 'no_email' });
      return;
    }

    const { rows: stateRows } = await db.query(`select data from kpi_repo_state where id = $1`, ['default']);
    const data = stateRows[0] ? stateRows[0].data : null;
    const exec = data && (data.executives || []).find(e => e.id === execId && !e.archived);
    if (!exec) {
      res.status(404).json({ error: 'no_exec' });
      return;
    }

    const message = buildMessage({
      execName: exec.name, month, appUrl: process.env.APP_URL || DEFAULT_APP_URL,
      managerName: getManagerName(), from: fromAddress(), to: email
    });
    await sendMail(message);
    res.status(200).json({ ok: true, sentAt: Date.now() });
  } catch (err) {
    console.error('notify failed:', err && err.message);
    res.status(502).json({ error: 'send_failed' });
  }
};
module.exports.buildMessage = buildMessage;
