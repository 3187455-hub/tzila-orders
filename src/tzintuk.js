// שליחת "צינתוק" (שיחה יוצאת אוטומטית) ללקוח ספציפי - התראה שיש לו
// תשובה חדשה במערכת. שולח למספר ישיר (לא לרשימת תפוצה) - עולה 0.1
// יחידה למספר; מאומת ישירות מול תמיכת ימות המשיח (לא ניחוש).
const config = require('./config');

const BASE = 'https://www.call2ip.co.il/api';

async function sendTzintuk(phone) {
  if (!phone) return { ok: false, reason: 'no phone' };
  if (!config.yemot.apiToken) {
    console.warn('sendTzintuk: YEMOT_API_TOKEN לא מוגדר - מדלג');
    return { ok: false, reason: 'no token' };
  }
  try {
    const url = `${BASE}/RunTzintuk?token=${encodeURIComponent(config.yemot.apiToken)}&phones=${encodeURIComponent(phone)}`;
    const res = await fetch(url);
    const body = await res.json();
    if (body.responseStatus !== 'OK') {
      console.error('sendTzintuk failed:', JSON.stringify(body));
      return { ok: false, reason: body.responseStatus };
    }
    return { ok: true };
  } catch (e) {
    console.error('sendTzintuk error', e.message);
    return { ok: false, reason: e.message };
  }
}

module.exports = { sendTzintuk };
