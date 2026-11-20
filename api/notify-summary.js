const { getPool } = require('./_db');
const { getSession } = require('./_auth');
const { mailConfigured, managerName, fromAddress, sendMail, monthLabel, escapeHtml } = require('./_mail');

// Sends the manager's boss (the email stored on the 'director' user) one
// summary of the feedback given for a month: which executives per client got
// feedback, and what that feedback was. Built from the stored data, never from
// anything the browser sends, and copied (BCC) to the sender as a record.
const CLIENT_NAMES = { 'SPIN MASTER': 'Spin Master', GIFAN: 'Gifan', BEPENSA: 'Bepensa' };
const REVIEW_TEXT = { aprobado: 'Evidencia aprobada', cambios: 'Pidió ajustes' };

function clientName(c) {
  return CLIENT_NAMES[c] || (c ? String(c).charAt(0) + String(c).slice(1).toLowerCase() : 'Sin cliente');
}

// Pure: turns the stored blob into the summary structure.
// With includeUnnotified (preview only), executives with any grading or
// comment are included even if they were not notified yet, flagged.
function buildSummary(data, month, includeUnnotified) {
  const notices = (data && data.notices) || {};
  const groups = [];
  ((data && data.executives) || []).forEach(exec => {
    if (!exec || exec.archived) return;
    const notice = notices[exec.id] && notices[exec.id][month];
    const monthScores = (data.scores && data.scores[exec.id] && data.scores[exec.id][month]) || {};
    if (!notice) {
      if (!includeUnnotified) return;
      const hasAny = Object.values(monthScores).some(r => r && (typeof r.score === 'number' || (r.comment || '').trim()));
      if (!hasAny) return;
    }
    let earned = 0, scoredWeight = 0, totalWeight = 0;
    const kpis = [];
    (exec.categories || []).forEach(cat => (cat.kpis || []).forEach(k => {
      if (k.effectiveFrom && k.effectiveFrom > month) return;
      const rec = monthScores[k.id] || {};
      totalWeight += k.weight || 0;
      const scored = typeof rec.score === 'number';
      if (scored) { earned += (k.weight || 0) * rec.score / 100; scoredWeight += k.weight || 0; }
      const review = rec.review && REVIEW_TEXT[rec.review.status] ? REVIEW_TEXT[rec.review.status] : '';
      const comment = (rec.comment || '').trim();
      if (scored || review || comment) kpis.push({ name: k.name, weight: k.weight || 0, score: scored ? rec.score : null, review, comment });
    }));
    const key = exec.client || '';
    let g = groups.find(x => x.client === key);
    if (!g) { g = { client: key, clientName: clientName(key), execs: [] }; groups.push(g); }
    g.execs.push({
      name: exec.name, roleLabel: exec.roleLabel || '', sentAt: notice ? notice.sentAt : null, notNotified: !notice,
      earned: Math.round(earned * 10) / 10, scoredWeight, totalWeight, kpis
    });
  });
  return groups;
}

function joinNames(names) {
  if (names.length <= 1) return names.join('');
  return names.slice(0, -1).join(', ') + ' y ' + names[names.length - 1];
}

function buildMessage({ groups, month, manager, from, to, bcc, preview }) {
  const mes = monthLabel(month);
  const textLines = ['Hola Carlos,', '', `${manager}, gerente de cuenta, dio retroalimentación a su equipo del mes de ${mes}.`, ''];
  const pending = [].concat(...groups.map(g => g.execs.filter(e => e.notNotified).map(e => e.name)));
  let banner = '';
  if (preview) {
    banner = `<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;padding:10px 12px;margin:0 0 14px;font-size:13px">` +
      `<b>Vista previa / prueba.</b> Así recibiría Carlos este resumen; este no se le envió.` +
      (pending.length ? ` <br>Aún no avisas por correo a: <b>${escapeHtml(joinNames(pending))}</b>. En el envío real solo van los ejecutivos ya avisados ese mes.` : '') +
      `</div>`;
    textLines.unshift('[VISTA PREVIA — no se envió a Carlos]', '');
  }
  let html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;margin:0 auto;color:#1f2937;line-height:1.5">` + banner +
    `<h2 style="margin:0 0 6px;color:#1d4ed8">Resumen de retroalimentación · ${escapeHtml(mes)}</h2>` +
    `<p>Hola Carlos,</p><p><b>${escapeHtml(manager)}</b>, gerente de cuenta, dio retroalimentación a su equipo del mes de <b>${escapeHtml(mes)}</b>.</p>`;
  groups.forEach(g => {
    const names = g.execs.map(e => e.name);
    textLines.push(`${g.clientName}: le dio retroalimentación a ${joinNames(names)}.`, '');
    html += `<h3 style="margin:22px 0 4px;border-bottom:2px solid #e5e7eb;padding-bottom:4px">${escapeHtml(g.clientName)}</h3>` +
      `<p style="margin:4px 0 10px">Le dio retroalimentación a <b>${escapeHtml(joinNames(names))}</b>.</p>`;
    g.execs.forEach(e => {
      const pts = e.scoredWeight ? `${e.earned} pts de ${e.scoredWeight} calificados (${e.totalWeight} posibles)` : 'Sin calificaciones registradas';
      textLines.push(`  ${e.name} — ${e.roleLabel}`, `  ${pts}`);
      html += `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;margin:0 0 10px">` +
        `<div style="font-weight:bold">${escapeHtml(e.name)}${e.notNotified ? ' <span style="font-weight:normal;font-size:11px;color:#b45309">(aún no avisado)</span>' : ''}</div>` +
        `<div style="font-size:12px;color:#6b7280">${escapeHtml(e.roleLabel)}</div>` +
        `<div style="font-size:13px;margin:4px 0 6px">${escapeHtml(pts)}</div>`;
      if (e.kpis.length) {
        html += `<table style="width:100%;border-collapse:collapse;font-size:12.5px">`;
        e.kpis.forEach(k => {
          const sc = k.score === null ? '—' : `${k.score}/100`;
          textLines.push(`    • ${k.name}: ${sc}${k.review ? ' · ' + k.review : ''}${k.comment ? '\n      "' + k.comment + '"' : ''}`);
          html += `<tr style="border-top:1px solid #e5e7eb"><td style="padding:5px 6px 5px 0;vertical-align:top"><b>${escapeHtml(k.name)}</b>` +
            `${k.review ? `<div style="color:#6b7280">${escapeHtml(k.review)}</div>` : ''}` +
            `${k.comment ? `<div style="color:#374151;margin-top:2px">“${escapeHtml(k.comment)}”</div>` : ''}</td>` +
            `<td style="padding:5px 0;white-space:nowrap;text-align:right;vertical-align:top">${escapeHtml(sc)}</td></tr>`;
        });
        html += `</table>`;
      } else {
        html += `<div style="font-size:12.5px;color:#6b7280">Aún sin calificaciones ni comentarios por KPI.</div>`;
      }
      html += `</div>`;
      textLines.push('');
    });
  });
  html += `<p style="font-size:12px;color:#6b7280;margin-top:18px">Resumen automático generado desde el repositorio de KPIs.</p></div>`;
  return { from, to, bcc, subject: `${preview ? '[PRUEBA] ' : ''}Resumen de retroalimentación del equipo · ${mes}`, text: textLines.join('\n'), html };
}

// GET  /api/notify-summary?month=YYYY-MM   → HTML preview of the email (nothing sent)
// POST {month}                              → sends it to Carlos (BCC the manager)
// POST {month, test:true}                   → sends the preview only to the manager
module.exports = async (req, res) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: 'No autenticado' }); return; }
  if (session.role !== 'admin') { res.status(403).json({ error: 'No autorizado' }); return; }

  const body = req.method === 'GET' ? (req.query || {}) : (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}));
  const month = typeof body.month === 'string' ? body.month : '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) { res.status(400).json({ error: 'bad_request' }); return; }

  const db = getPool();
  if (req.method === 'GET' || body.test) {
    try {
      const { rows } = await db.query(`select data from kpi_repo_state where id = $1`, ['default']);
      const groups = buildSummary(rows[0] ? rows[0].data : null, month, true);
      if (req.method === 'GET') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        if (!groups.length) { res.status(200).send(`<p style="font-family:Arial,sans-serif">Aún no hay calificaciones ni comentarios en ${escapeHtml(monthLabel(month))} para armar el resumen.</p>`); return; }
        const m = buildMessage({ groups, month, manager: managerName(), from: '', to: '', bcc: '', preview: true });
        res.status(200).send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(m.subject)}</title></head>` +
          `<body style="margin:0;padding:24px;background:#f3f4f6"><div style="background:#fff;max-width:720px;margin:0 auto;padding:22px;border-radius:12px">` +
          `<div style="font-family:Arial,sans-serif;font-size:13px;color:#6b7280;margin-bottom:12px"><b>Asunto:</b> ${escapeHtml(m.subject.replace('[PRUEBA] ', ''))}</div>${m.html}</div></body></html>`);
        return;
      }
      if (!mailConfigured()) { res.status(503).json({ error: 'not_configured' }); return; }
      if (!groups.length) { res.status(409).json({ error: 'nothing_to_preview' }); return; }
      await sendMail(buildMessage({ groups, month, manager: managerName(), from: fromAddress(), to: process.env.MAIL_USER, preview: true }));
      res.status(200).json({ ok: true, test: true, sentAt: Date.now() });
    } catch (err) {
      console.error('notify-summary preview failed:', err && err.message);
      res.status(502).json({ error: 'send_failed' });
    }
    return;
  }

  if (!mailConfigured()) { res.status(503).json({ error: 'not_configured' }); return; }
  try {
    let boss = null;
    try {
      const { rows } = await db.query(`select email from kpi_repo_users where username = 'director' limit 1`);
      boss = rows[0] && rows[0].email ? String(rows[0].email).trim() : null;
    } catch (err) {
      if (!(err && err.code === '42703')) throw err;
    }
    if (!boss) { res.status(409).json({ error: 'no_boss_email' }); return; }

    const { rows: stateRows } = await db.query(`select data from kpi_repo_state where id = $1`, ['default']);
    const data = stateRows[0] ? stateRows[0].data : null;
    const groups = buildSummary(data, month);
    if (!groups.length) { res.status(409).json({ error: 'nothing_to_report' }); return; }

    const message = buildMessage({
      groups, month, manager: managerName(), from: fromAddress(), to: boss, bcc: process.env.MAIL_USER
    });
    await sendMail(message);
    res.status(200).json({
      ok: true, sentAt: Date.now(),
      names: [].concat(...groups.map(g => g.execs.map(e => e.name)))
    });
  } catch (err) {
    console.error('notify-summary failed:', err && err.message);
    res.status(502).json({ error: 'send_failed' });
  }
};
module.exports.buildSummary = buildSummary;
module.exports.buildMessage = buildMessage;
