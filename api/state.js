const { Pool } = require('pg');

// Reused across warm invocations so we don't open a new pool per request.
let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.POSTGRES_URL,
      ssl: { rejectUnauthorized: false }
    });
  }
  return pool;
}

const ROW_ID = 'default';

module.exports = async (req, res) => {
  const db = getPool();
  try {
    if (req.method === 'GET') {
      const { rows } = await db.query(
        'select data from kpi_repo_state where id = $1',
        [ROW_ID]
      );
      res.status(200).json({ data: rows[0] ? rows[0].data : null });
      return;
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const data = body && body.data;
      if (!data || typeof data !== 'object') {
        res.status(400).json({ error: 'Missing data' });
        return;
      }
      await db.query(
        `insert into kpi_repo_state (id, data, updated_at)
         values ($1, $2, now())
         on conflict (id) do update set data = excluded.data, updated_at = now()`,
        [ROW_ID, data]
      );
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
