// בדיקה האם יש ללקוח תשובה בצ'אט הפנימי (שלוחה 0) שעדיין לא שמע -
// נועד להישמע כתזכורת קצרה בתחילת כל שלוחה אחרת (1/2/3), לפני ההודעה
// הרגילה של אותה שלוחה. לא מסמן את התשובה כ"נשמעה" - זה קורה רק
// כשהלקוח בפועל נכנס לשלוחה 0 ושומע את תוכן התשובה (src/ivr/message.js).
const db = require('../db');
const { sayText } = require('./directives');

function pendingNotice(phone) {
  if (!phone) return null;
  const row = db
    .prepare('SELECT 1 FROM messages WHERE phone = ? AND reply_text IS NOT NULL AND reply_heard = 0 LIMIT 1')
    .get(phone);
  return row ? sayText('יש לך הודעה חדשה בשלוחה 0') : null;
}

module.exports = { pendingNotice };
