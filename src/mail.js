// שליחת מייל דרך SMTP (למשל Gmail עם App Password) - משמש להתראה על
// הודעה חדשה שהושארה בשלוחת "השארת הודעה". אם לא הוגדרו פרטי SMTP
// (SMTP_HOST/SMTP_USER/SMTP_PASS ב-.env) - מדלג בשקט על השליחה, כדי
// שהתכונה עצמה (הקלטה + עמוד בפאנל) תעבוד גם לפני שמגדירים מייל.
const nodemailer = require('nodemailer');
const config = require('./config');

let transporter = null;
function getTransporter() {
  if (!config.mail.host || !config.mail.user || !config.mail.pass) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.port === 465,
      auth: { user: config.mail.user, pass: config.mail.pass },
    });
  }
  return transporter;
}

async function sendMessageNotification({ phone, adminUrl }) {
  const t = getTransporter();
  if (!t || !config.mail.messageNotifyTo) {
    console.warn('sendMessageNotification: פרטי SMTP או MESSAGE_EMAIL_TO לא מוגדרים - מדלג על שליחת מייל');
    return false;
  }
  try {
    await t.sendMail({
      from: config.mail.from,
      to: config.mail.messageNotifyTo,
      subject: `הודעה חדשה מ-${phone || 'מספר לא ידוע'}`,
      text: `התקבלה הודעה קולית חדשה ממספר ${phone || 'לא ידוע'}.\nלהאזנה: ${adminUrl}`,
    });
    return true;
  } catch (e) {
    console.error('sendMessageNotification failed', e.message);
    return false;
  }
}

module.exports = { sendMessageNotification };
