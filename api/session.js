const { getSession } = require('./_auth');

module.exports = async (req, res) => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ session: null });
    return;
  }
  res.status(200).json({
    session: { username: session.username, role: session.role, execId: session.execId }
  });
};
