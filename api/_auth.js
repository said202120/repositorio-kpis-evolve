const jwt = require('jsonwebtoken');

const SECRET = process.env.AUTH_SECRET;
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function sign(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: MAX_AGE_SECONDS });
}

function verify(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, SECRET);
  } catch (e) {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function getSession(req) {
  const cookies = parseCookies(req);
  return verify(cookies.session);
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', [
    `session=${token}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${MAX_AGE_SECONDS}`
  ].join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
}

module.exports = { sign, verify, getSession, setSessionCookie, clearSessionCookie };
