const { getPool } = require('./_db');

// Called once a day by the Vercel cron declared in vercel.json. It only runs a
// trivial read so the Supabase free plan never sees the project as inactive
// (it pauses projects after about a week without activity, which takes the
// whole app down until someone restores it). It returns no data.
// If CRON_SECRET is set in Vercel, Vercel sends it as a bearer token and any
// other caller is refused; without it the endpoint is still harmless.
module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }
  try {
    await getPool().query('select count(*)::int as n from kpi_repo_state');
    res.status(200).json({ ok: true, at: new Date().toISOString() });
  } catch (err) {
    console.error('keepalive failed:', err && err.message);
    res.status(500).json({ ok: false });
  }
};
