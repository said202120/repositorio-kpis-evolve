const nodemailer = require('nodemailer');

// Gmail SMTP with an app password kept in Vercel env vars:
//   MAIL_USER          the sending Gmail/Google Workspace address
//   MAIL_APP_PASSWORD  its 16-character app password
//   MAIL_FROM_NAME     (optional) display name, default "Said Zapién Jiménez"
function mailConfigured() {
  return !!(process.env.MAIL_USER && process.env.MAIL_APP_PASSWORD);
}

function managerName() {
  return process.env.MAIL_FROM_NAME || 'Said Zapién Jiménez';
}

function fromAddress() {
  return `"${managerName().replace(/"/g, '')}" <${process.env.MAIL_USER}>`;
}

async function sendMail(message) {
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
