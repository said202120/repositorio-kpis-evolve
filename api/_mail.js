const nodemailer = require('nodemailer');

// Two ways to send, picked by which env vars exist in Vercel:
//   A) Gmail SMTP:  MAIL_USER (sender address) + MAIL_APP_PASSWORD (16-char app password)
//   B) Brevo API:   MAIL_USER (sender address, verified in Brevo) + BREVO_API_KEY
//      (no DNS changes needed; the sender is verified by clicking a link Brevo emails)
// Optional in both: MAIL_FROM_NAME (display name, default "Said Zapién Jiménez").
function mailConfigured() {
  return !!(process.env.MAIL_USER && (process.env.BREVO_API_KEY || process.env.MAIL_APP_PASSWORD));
}

function managerName() {
  return process.env.MAIL_FROM_NAME || 'Said Zapién Jiménez';
}

function fromAddress() {
  return `"${managerName().replace(/"/g, '')}" <${process.env.MAIL_USER}>`;
}

async function sendViaBrevo(message) {
  const list = v => (v ? [].concat(v).map(email => ({ email })) : undefined);
  const body = {
    sender: { name: managerName(), email: process.env.MAIL_USER },
    to: list(message.to), bcc: list(message.bcc),
    subject: message.subject, htmlContent: message.html, textContent: message.text
  };
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error('Brevo ' + res.status + ' ' + detail.slice(0, 200));
  }
  return res.json().catch(() => ({}));
}

async function sendMail(message) {
  if (process.env.BREVO_API_KEY) return sendViaBrevo(message);
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_APP_PASSWORD }
  });
  return transporter.sendMail(message);
}

const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS_ES[m - 1]} de ${y}`;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { mailConfigured, managerName, fromAddress, sendMail, monthLabel, escapeHtml };
