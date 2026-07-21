const bcrypt = require('bcryptjs');
const { getPool } = require('./_db');
const { getSession } = require('./_auth');

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

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const currentPassword = (body && body.currentPassword) || '';
    const newPassword = (body && body.newPassword) || '';
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Completa ambos campos' });
      return;
    }
    if (newPassword.length < 8) {
      res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
      return;
    }

    const db = getPool();
    const { rows } = await db.query(
      'select password_hash from kpi_repo_users where username = $1',
      [session.username]
    );
    const user = rows[0];
    if (!user) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    const ok = await bcrypt.compare(currentPassword, user.password_hash);
    if (!ok) {
      res.status(401).json({ error: 'La contraseña actual no es correcta' });
      return;
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await db.query(
      'update kpi_repo_users set password_hash = $1 where username = $2',
      [newHash, session.username]
    );
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al cambiar la contraseña' });
  }
};
