// مساعد إرسال البريد الإلكتروني عبر SMTP الخاص بـ Zoho Mail
const nodemailer = require('nodemailer');

let _transporter = null;
function getTransporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: process.env.ZOHO_SMTP_HOST || 'smtp.zoho.com',
      port: Number(process.env.ZOHO_SMTP_PORT) || 587,
      secure: false, // STARTTLS على المنفذ 587
      auth: {
        user: process.env.ZOHO_EMAIL,
        pass: process.env.ZOHO_APP_PASSWORD
      }
    });
  }
  return _transporter;
}

async function sendMail({ to, subject, html }) {
  if (!to) throw new Error('لا يوجد بريد إلكتروني للمستلم');
  const transporter = getTransporter();
  await transporter.sendMail({
    from: `"رادار" <${process.env.ZOHO_EMAIL}>`,
    to, subject, html
  });
}

module.exports = { sendMail };
