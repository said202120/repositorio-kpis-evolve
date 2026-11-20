// One-time gradings the manager asked for from a session that cannot reach
// the page. Each entry runs once, on the first request that touches the
// state row after its deploy (row locked by the caller), and only fills a
// KPI that is still ungraded; its id goes into data.migrations so it never
// runs twice. A manager tab opened before it cannot wipe it
// (reapplyOnStaleCopy, used on admin saves); later edits by the manager stick.

const { ensureFilesTable, insertFile } = require('./_files');

const SEEDS = [
  {
    // 2026-11-20: worked out from the October billing support.
    id: 'seed-ausentismo-veronica-2026-10',
    exec: 'veronica', month: '2026-10', kpi: /ausentismo/i, kpiLabel: 'Tasa de ausentismo',
    score: 100,
    comment: 'En octubre obtuviste 95.4% de días efectivos (ausentismo de 4.6%) contra una meta de 85%, así que cumples el KPI. ' +
      'Cálculo con el soporte de facturación: 100 plazas × 31 días = 3,100 días posibles; se descontaron 46 días de incapacidad ' +
      'no cubierta (no te afectan), para un objetivo de 3,054 días. Se cubrieron 2,913 días (asistencia y descanso); en contra ' +
      'hubo 12 faltas y 129 días de vacante. Lo que más pesó fueron las vacantes (plaza 99 en CDMX vacante todo el mes, ' +
      'plaza 71 con 21 días y plaza 22 con 16): enfoquémonos en cubrirlas más rápido. Te dejo el detalle en el archivo adjunto.',
    file: () => ({ id: 'seed-ausentismo-veronica-2026-10', ...require('./_seed_ausentismo_oct2026') })
  },
  {
    // 2026-11-20: a system failure kept her October uploads from being saved;
    // the KPI is also deadline-exempt for that month (index.html).
    id: 'seed-maestro-veronica-2026-10',
    exec: 'veronica', month: '2026-10', kpi: /maestro/i, kpiLabel: 'Envío de Maestro y Plan de Trabajo',
    score: 100,
    comment: 'En octubre una falla del sistema impidió que se guardaran tus cargas del Maestro y Plan de Trabajo de las ' +
      'primeras semanas. No fue tu responsabilidad, así que este KPI no se penaliza y queda al 100% este mes. ' +
      'Gracias por mantener el envío semanal de los lunes.'
  }
];

function kpiIdOf(data, seed) {
  const exec = (data.executives || []).find(e => e && e.id === seed.exec && !e.archived);
  for (const c of (exec && exec.categories) || []) {
    const k = (c.kpis || []).find(x => x && seed.kpi.test(x.name || ''));
    if (k) return k.id;
  }
  return null;
}

const done = (data, seed) => !!(data && Array.isArray(data.migrations) && data.migrations.includes(seed.id));

function recOf(data, seed, id, create) {
  if (!data.scores) { if (!create) return null; data.scores = {}; }
  if (!data.scores[seed.exec]) { if (!create) return null; data.scores[seed.exec] = {}; }
  const months = data.scores[seed.exec];
  if (!months[seed.month]) { if (!create) return null; months[seed.month] = {}; }
  if (!months[seed.month][id]) { if (!create) return null; months[seed.month][id] = { score: null, comment: '' }; }
  return months[seed.month][id];
}

// Manager-owned fields only (score + comment).
function applyGrade(rec, seed) {
  if (rec.score === null || rec.score === undefined) rec.score = seed.score;
  if (!rec.comment) rec.comment = seed.comment;
}

async function runOne(db, data, seed) {
  if (!Array.isArray(data.migrations)) data.migrations = [];
  data.migrations.push(seed.id);
  const id = kpiIdOf(data, seed);
  if (!id) return;
  const rec = recOf(data, seed, id, true);
  const alreadyGraded = rec.score !== null && rec.score !== undefined;
  if (!alreadyGraded) applyGrade(rec, seed);
  if (!data.logs) data.logs = [];
  const now = Date.now();
  if (!alreadyGraded) data.logs.unshift({ ts: now, execId: seed.exec, month: seed.month, role: 'manager', text: `Calificó "${seed.kpiLabel}" con ${seed.score} pts` });
  if (seed.file) {
    const f = seed.file();
    if (!rec.attachments) rec.attachments = rec.attachment ? [rec.attachment] : [];
    delete rec.attachment;
    if (!rec.attachments.some(a => a && a.id === f.id)) {
      await ensureFilesTable();
      await insertFile(db, { id: f.id, execId: seed.exec, month: seed.month, kpiId: id, name: f.name, type: f.type, size: f.size,
        dataUrl: `data:${f.type};base64,${f.base64}` });
      rec.attachments.push({ id: f.id, name: f.name, type: f.type, size: f.size, uploadedAt: now, byManager: true });
      data.logs.unshift({ ts: now + 1, execId: seed.exec, month: seed.month, role: 'manager', text: `El gerente adjuntó "${f.name}"` });
    }
  }
  if (data.logs.length > 300) data.logs.length = 300;
}

// Returns true if it changed `data`.
async function runSeed(db, data) {
  if (!data) return false;
  let changed = false;
  for (const seed of SEEDS) {
    if (done(data, seed)) continue;
    await runOne(db, data, seed);
    changed = true;
  }
  return changed;
}

const allDone = data => SEEDS.every(seed => done(data, seed));

// An admin save built from a copy loaded before a seed ran would put the KPI
// back to ungraded: re-apply the grade if that copy left it empty.
function reapplyOnStaleCopy(incoming, current) {
  for (const seed of SEEDS) {
    if (!done(current, seed) || done(incoming, seed)) continue;
    const id = kpiIdOf(current, seed);
    if (id) {
      const cur = recOf(current, seed, id, false);
      if (cur && cur.score === seed.score && cur.comment === seed.comment) applyGrade(recOf(incoming, seed, id, true), seed);
    }
    if (!Array.isArray(incoming.migrations)) incoming.migrations = [];
    incoming.migrations.push(seed.id);
  }
}

module.exports = { runSeed, reapplyOnStaleCopy, allDone };
