// One-time grading the manager asked for on 2026-11-20 (he cannot reach the
// page from the session that prepared it): Verónica's October 2026
// "Tasa de ausentismo", worked out from the billing support.
//   - score 100 (95.4% effective days vs the 85% target),
//   - feedback comment with the summary,
//   - the anonymized summary workbook attached as a manager file.
// Runs on the first request that touches the state row after this deploy
// (row locked by the caller), only if the KPI is still ungraded, and marks
// data.migrations so it never runs twice. A manager tab opened before it
// cannot wipe it (reapplyOnStaleCopy, used on admin saves).

const { ensureFilesTable, insertFile } = require('./_files');
const FILE = require('./_seed_ausentismo_oct2026');

const SEED_ID = 'seed-ausentismo-veronica-2026-10';
const EXEC = 'veronica';
const MONTH = '2026-10';
const FILE_ID = 'seed-ausentismo-veronica-2026-10';
const SCORE = 100;
const COMMENT = 'En octubre obtuviste 95.4% de días efectivos (ausentismo de 4.6%) contra una meta de 85%, así que cumples el KPI. ' +
  'Cálculo con el soporte de facturación: 100 plazas × 31 días = 3,100 días posibles; se descontaron 46 días de incapacidad ' +
  'no cubierta (no te afectan), para un objetivo de 3,054 días. Se cubrieron 2,913 días (asistencia y descanso); en contra ' +
  'hubo 12 faltas y 129 días de vacante. Lo que más pesó fueron las vacantes (plaza 99 en CDMX vacante todo el mes, ' +
  'plaza 71 con 21 días y plaza 22 con 16): enfoquémonos en cubrirlas más rápido. Te dejo el detalle en el archivo adjunto.';

function kpiId(data) {
  const exec = (data.executives || []).find(e => e && e.id === EXEC && !e.archived);
  for (const c of (exec && exec.categories) || []) {
    const k = (c.kpis || []).find(x => x && /ausentismo/i.test(x.name || ''));
    if (k) return k.id;
  }
  return null;
}

function hasRun(data) {
  return !!(data && Array.isArray(data.migrations) && data.migrations.includes(SEED_ID));
}

function recOf(data, id, create) {
  if (!data.scores) data.scores = {};
  if (!data.scores[EXEC]) data.scores[EXEC] = {};
  if (!data.scores[EXEC][MONTH]) { if (!create) return null; data.scores[EXEC][MONTH] = {}; }
  if (!data.scores[EXEC][MONTH][id]) { if (!create) return null; data.scores[EXEC][MONTH][id] = { score: null, comment: '' }; }
  return data.scores[EXEC][MONTH][id];
}

// Manager-owned fields only (score + comment); the attachment lives in the
// ejecutivo-owned list, which admin saves already take from the database.
function applyGrade(rec) {
  if (rec.score === null || rec.score === undefined) rec.score = SCORE;
  if (!rec.comment) rec.comment = COMMENT;
}

async function runSeed(db, data) {
  if (!data || hasRun(data)) return false;
  if (!Array.isArray(data.migrations)) data.migrations = [];
  data.migrations.push(SEED_ID);
  const id = kpiId(data);
  if (!id) return true;
  const rec = recOf(data, id, true);
  const alreadyGraded = rec.score !== null && rec.score !== undefined;
  if (!alreadyGraded) applyGrade(rec);
  if (!rec.attachments) rec.attachments = rec.attachment ? [rec.attachment] : [];
  delete rec.attachment;
  if (!rec.attachments.some(a => a && a.id === FILE_ID)) {
    await ensureFilesTable();
    await insertFile(db, {
      id: FILE_ID, execId: EXEC, month: MONTH, kpiId: id, name: FILE.name, type: FILE.type, size: FILE.size,
      dataUrl: `data:${FILE.type};base64,${FILE.base64}`
    });
    rec.attachments.push({ id: FILE_ID, name: FILE.name, type: FILE.type, size: FILE.size, uploadedAt: Date.now(), byManager: true });
  }
  if (!data.logs) data.logs = [];
  const now = Date.now();
  if (!alreadyGraded) data.logs.unshift({ ts: now, execId: EXEC, month: MONTH, role: 'manager', text: `Calificó "Tasa de ausentismo" con ${SCORE} pts` });
  data.logs.unshift({ ts: now + 1, execId: EXEC, month: MONTH, role: 'manager', text: `El gerente adjuntó "${FILE.name}"` });
  if (data.logs.length > 300) data.logs.length = 300;
  return true;
}

// An admin save built from a copy loaded before the seed ran would put the
// KPI back to ungraded: re-apply the grade if that copy left it empty.
function reapplyOnStaleCopy(incoming, current) {
  if (!hasRun(current) || hasRun(incoming)) return;
  const id = kpiId(current);
  if (id) {
    const cur = recOf(current, id, false);
    if (cur && cur.score === SCORE && cur.comment === COMMENT) applyGrade(recOf(incoming, id, true));
  }
  if (!Array.isArray(incoming.migrations)) incoming.migrations = [];
  incoming.migrations.push(SEED_ID);
}

module.exports = { SEED_ID, runSeed, reapplyOnStaleCopy };
