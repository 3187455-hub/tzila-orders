// עטיפה ל-API הכללי של קבצים בימות המשיח (DownloadFile / UploadTextFile).
// מקור: תיעוד קהילתי בפורום freeivr.co.il - כדאי לאמת מול חשבון אמיתי.
const config = require('../config');

const BASE = 'https://www.call2all.co.il/ym/api';

// נתיבים שחוזרים מפרמטרים של ימות המשיח (כמו NAME_REC) מגיעים בלי
// "/" מוביל (למשל "90/004.wav") - בניגוד לכל הנתיבים שאנחנו בונים
// בעצמנו במקומות אחרים (כמו "/90/ext.ini"). בלי הנרמול הזה, הנתיב
// שנשלח ל-API שונה מהתבנית שכן עובדת, וה-API מחזיר HTTP 200 עם גוף
// שגיאה (JSON) במקום קובץ אמיתי - מה שגרם לנגן השמע להישאר על 0:00/0:00
// בלי שום שגיאה גלויה.
function normalizePath(filePath) {
  return filePath.startsWith('/') ? filePath : `/${filePath}`;
}

async function downloadTextFile(filePath) {
  const url = `${BASE}/DownloadFile?token=${encodeURIComponent(config.yemot.apiToken)}&path=ivr2:${normalizePath(filePath)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Yemot DownloadFile failed: ${res.status}`);
  return res.text();
}

async function downloadBinaryFile(filePath) {
  const url = `${BASE}/DownloadFile?token=${encodeURIComponent(config.yemot.apiToken)}&path=ivr2:${normalizePath(filePath)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Yemot DownloadFile failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // בדיקת שפיות: אם ימות המשיח מחזיר HTTP 200 עם גוף שגיאה (JSON) במקום
  // קובץ בינארי אמיתי - עדיף שגיאה ברורה מאשר "אודיו" שקט שלא מנגן
  if (buf.length < 1000 && buf.slice(0, 1).toString() === '{') {
    throw new Error(`Yemot DownloadFile returned an error body: ${buf.toString('utf8').slice(0, 200)}`);
  }
  return buf;
}

async function uploadTextFile(filePath, contents) {
  const url = `${BASE}/UploadTextFile?token=${encodeURIComponent(config.yemot.apiToken)}&what=ivr2:${normalizePath(filePath)}&contents=${encodeURIComponent(contents)}`;
  const res = await fetch(url);
  const body = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = { raw: body };
  }
  if (parsed.responseStatus && parsed.responseStatus !== 'OK') {
    throw new Error(`Yemot UploadTextFile failed: ${body}`);
  }
  return parsed;
}

module.exports = { downloadTextFile, downloadBinaryFile, uploadTextFile };
