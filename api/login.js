const bcrypt = require('bcryptjs');
const { getPool } = require('./_db');
const { sign, setSessionCookie } = require('./_auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const username = ((body && body.username) || '').trim().toLowerCase();
    const password = (body && body.password) || '';
    if (!username || !password) {
      res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
      return;
    }

    const db = getPool();
    const { rows } = await db.query(
      'select username, password_hash, role, exec_id from kpi_repo_users where username = $1',
      [username]
    );
    const user = rows[0];
    if (!user) {
      res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
      return;
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
      return;
    }

    const session = { username: user.username, role: user.role, execId: user.exec_id || null };
    const token = sign(session);
    setSessionCookie(res, token);
    res.status(200).json({ session });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
};
