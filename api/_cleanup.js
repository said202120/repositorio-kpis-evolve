// One-time cleanup of the manager's test data for Verónica ('veronica'),
// requested on 2026-10-13. Runs inside the request that first touches the
// state row after this deploy (row locked FOR UPDATE by the caller):
//   1. backs the row up to kpi_repo_state_backup_20261013 (and Verónica's
//      files to kpi_repo_files_backup_20261013) unless a backup is there;
//   2. records what it found / removed in kpi_repo_cleanup_report;
//   3. empties every map under 'veronica' (all months), drops her log lines
//      and her files. The executive record (name, role, client, photo, KPIs,
//      weights), her login, and every other executive are not touched.
// data.migrations gets CLEANUP_ID so it never runs twice, and a manager tab
// still holding the pre-cleanup copy cannot write the test data back
// (scrubStaleCopy, used on admin saves).

const { ensureFilesTable } = require('./_files');

const CLEANUP_ID = 'cleanup-veronica-tests-2026-10-13';
const EXEC = 'veronica';
const PER_EXEC_MAPS = ['scores', 'midReviews', 'plans', 'acks', 'monthlyVariables', 'variableAdjustments'];
const REVIEWED = ['edgar', 'marifer'];

function hasRun(data) {
  return !!(data && Array.isArray(data.migrations) && data.migrations.includes(CLEANUP_ID));
}

function markRun(data) {
  if (!Array.isArray(data.migrations)) data.migrations = [];
  if (!data.migrations.includes(CLEANUP_ID)) data.migrations.push(CLEANUP_ID);
}

function savedScores(data, execId) {
  const out = [];
  Object.entries(((data.scores || {})[execId]) || {}).forEach(([month, kpis]) => {
    Object.entries(kpis || {}).forEach(([kpi, rec]) => {
      if (!rec || typeof rec !== 'object') return;
      const files = (rec.attachments || (rec.attachment ? [rec.attachment] : [])).map(a => a && a.name);
      if (rec.score === null || rec.score === undefined) {
        if (!rec.comment && !rec.execComment && !rec.review && !files.length) return;
      }
      out.push({
        month, kpi,
        score: rec.score === undefined ? null : rec.score,
        comment: rec.comment || '',
        execComment: rec.execComment || '',
        review: rec.review ? rec.review.status : null,
        files
      });
    });
  });
  return out.sort((a, b) => (a.month + a.kpi).localeCompare(b.month + b.kpi));
}

function savedMaps(data, execId) {
  const out = {};
  PER_EXEC_MAPS.filter(m => m !== 'scores').forEach(m => {
    const v = (data[m] || {})[execId];
    if (v && typeof v === 'object' && Object.keys(v).length) out[m] = v;
  });
  return out;
}

function logsOf(data, execId) {
  return (data.logs || []).filter(l => l && l.execId === execId);
}

function clearExec(data) {
  PER_EXEC_MAPS.forEach(m => {
    if (!data[m] || typeof data[m] !== 'object') data[m] = {};
    data[m][EXEC] = {};
  });
  data.logs = (data.logs || []).filter(l => !l || l.execId !== EXEC);
}

async function backup(db, data) {
  await db.query(`create table if not exists kpi_repo_state_backup_20261013 (
    id text, data jsonb, updated_at timestamptz, backed_up_at timestamptz not null default now())`);
  const { rows } = await db.query(`select count(*)::int as n from kpi_repo_state_backup_20261013 where id = 'default'`);
  let created = false;
  if (!rows[0].n) {
    await db.query(`insert into kpi_repo_state_backup_20261013 (id, data, updated_at)
                    select id, data, updated_at from kpi_repo_state where id = 'default'`);
    created = true;
  }
  await db.query(`create table if not exists kpi_repo_files_backup_20261013 as
                    select f.*, now() as backed_up_at from kpi_repo_files f where false`);
  await db.query(`insert into kpi_repo_files_backup_20261013
                  select f.*, now() from kpi_repo_files f
                   where f.exec_id = $1 and not exists (select 1 from kpi_repo_files_backup_20261013 b where b.id = f.id)`, [EXEC]);
  const n = await db.query(`select count(*)::int as n from kpi_repo_state_backup_20261013 where id = 'default'`);
  const nf = await db.query(`select count(*)::int as n from kpi_repo_files_backup_20261013 where exec_id = $1`, [EXEC]);
  return { table: 'kpi_repo_state_backup_20261013', rows: n.rows[0].n, createdNow: created,
           filesTable: 'kpi_repo_files_backup_20261013', veronicaFiles: nf.rows[0].n };
}

// Mutates `data` (the locked current row). Returns true if it changed it.
async function runVeronicaCleanup(db, data) {
  if (!data || hasRun(data)) return false;
  await ensureFilesTable();
  const backupInfo = await backup(db, data);
  const files = await db.query(
    `select id, month, kpi_id, name, size, uploaded_at from kpi_repo_files where exec_id = $1 order by month, kpi_id`, [EXEC]);
  const report = {
    id: CLEANUP_ID,
    ranAt: new Date().toISOString(),
    backup: backupInfo,
    removedForVeronica: {
      scores: savedScores(data, EXEC),
      otherMaps: savedMaps(data, EXEC),
      logs: logsOf(data, EXEC),
      filesInTable: files.rows
    },
    notTouched_reviewOnly: Object.fromEntries(REVIEWED.map(id => [id, {
      scores: savedScores(data, id),
      otherMaps: savedMaps(data, id)
    }]))
  };
  clearExec(data);
  await db.query('delete from kpi_repo_files where exec_id = $1', [EXEC]);
  markRun(data);
  await db.query(`create table if not exists kpi_repo_cleanup_report (
    id text primary key, report jsonb not null, created_at timestamptz not null default now())`);
  await db.query(`insert into kpi_repo_cleanup_report (id, report) values ($1, $2) on conflict (id) do nothing`,
    [CLEANUP_ID, report]);
  console.log('[cleanup]', JSON.stringify(report));
  return true;
}

// An admin save built from a copy loaded before the cleanup still carries
// the test data in the manager-owned fields: drop it and mark the copy.
function scrubStaleCopy(incoming, current) {
  if (!hasRun(current) || hasRun(incoming)) return;
  clearExec(incoming);
  markRun(incoming);
}

module.exports = { CLEANUP_ID, hasRun, runVeronicaCleanup, scrubStaleCopy };
