const { Pool } = require('pg');

// pg 8.13+ lets a `sslmode` query param on the connection string override an
// explicit `ssl` option, forcing full certificate verification. Supabase's
// pooler cert isn't in Node's default trust store, so that verification
// fails with "self-signed certificate in certificate chain". Strip
// `sslmode` from the URL and rely solely on the explicit `ssl` option below.
function connectionStringWithoutSslMode(raw) {
  try {
    const u = new URL(raw);
    u.searchParams.delete('sslmode');
    return u.toString();
  } catch (e) {
    return raw;
  }
}

// Reused across warm invocations so we don't open a new pool per request.
let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: connectionStringWithoutSslMode(process.env.POSTGRES_URL),
      ssl: { rejectUnauthorized: false }
    });
  }
  return pool;
}

module.exports = { getPool };
