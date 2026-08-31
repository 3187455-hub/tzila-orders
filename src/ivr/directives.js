// בונה מחרוזות תשובה לימות המשיח (מודול ה-API החיצוני).
//
// הערה חשובה: לימות המשיח אין תיעוד רשמי מלא ומדויק לכל הפרמטרים -
// התחביר כאן מבוסס על תיעוד קהילתי (פורום freeivr.co.il). יש לוודא/לכייל
// מול שיחת בדיקה אמיתית בזמן ההקמה, ולתקן כאן במקום אחד אם צריך.

// פסיק בתוך segment בודד שובר את הפרסור של ימות המשיח (מתפרש כשדה
// הקלט שאחרי ה-= ב-read=) - מוחלף ברווח. נקודה בתוך segment בודד
// שוברת אותו גם כן (ראו buildSegments למטה) - גם היא מוחלפת ברווח.
function sanitizeSegment(text) {
  return text.replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim();
}

// בתגובת ה-API של ימות המשיח, נקודה (.) היא המפריד הרשמי בין הודעות
// מחוברות בתגובה אחת - לא סימן פיסוק חופשי. כל הודעה בשרשור חייבת
// קידומת סוג משלה (למשל: "f-קובץ1.t-טקסט1.t-טקסט2"). כשבנינו הודעה
// כמו "t-משפט1. משפט2" (קידומת t- אחת בלבד עם נקודה "תמימה" בפנים),
// ימות המשיח פירש את הטקסט אחרי הנקודה כניסיון להתחיל הודעה חדשה
// בלי קידומת - וגרם לניתוק/שגיאה מיידיים (גם בהודעות קצרות וגם
// בארוכות - מאומת בבדיקה חיה). לכן: text יכול להיות מחרוזת (segment
// בודד) או מערך שורות (כמה segments שיישמעו ברצף טבעי, בלי הקשה
// נדרשת ביניהם - כל שורה מקבלת קידומת t- משלה).
function buildSegments(text) {
  const lines = Array.isArray(text) ? text : [text];
  return lines.map((line) => `t-${sanitizeSegment(line)}`).join('.');
}

function sayText(text) {
  return `id_list_message=${buildSegments(text)}`;
}

// מבקש הקשות ממספר ספרות עם שם פרמטר, ומחזיר לשלב הבא בשם הזה
//
// הערה: ניסיתי בעבר להוסיף כאן שדות נוספים (עד שדה 15) כדי לבטל את
// בקשת האישור האוטומטית של ימות המשיח - התברר שזה שבר את הדירקטיבה
// (גרם ל"שגיאה" חוזרת בשיחה אמיתית). חוזרים לפורמט המצומצם שכן עובד;
// בקשת האישור האוטומטית של ימות המשיח נשארת בינתיים כפי שהיא.
function readDigits(promptText, paramName, { max = 2, min = 1, timeout = 15 } = {}) {
  return `read=${buildSegments(promptText)}=${paramName},no,${max},${min},${timeout},Digits,yes,no,,`;
}

// מבקש הקלטת קול (למשל הקלטת שם) - חוזר עם נתיב קובץ ההקלטה בפרמטר
//
// שדה 7 הוחלף מ-"yes" ל-"no": בבדיקה חיה, אחרי הקשת סולמית לסיום
// ההקלטה, השיחה נותקה עם ההודעה הסטנדרטית של ימות המשיח "לא הוקשה
// בחירה" - סימן שימות המשיח נכנס לתפריט אישור מובנה (השמעה חוזרת/
// אישור/הקלטה מחדש) שהמתקשר לא ידע להגיב לו. "no" כאן הוא ניסיון
// לבטל את תפריט האישור המובנה הזה (לפי אנלוגיה לשדות דומים אצל
// הקשות ספרות) - טרם אומת שהוא אכן זה השדה הנכון, יש לבדוק בשיחה
// אמיתית ולתקן אם עדיין לא עובד.
function recordMessage(promptText, paramName, { maxSeconds = 15, timeout = 15 } = {}) {
  return `read=${buildSegments(promptText)}=${paramName},no,${maxSeconds},,${timeout},Message,no,no,,`;
}

function goToFolder(folderPath) {
  return `go_to_folder=${folderPath}`;
}

function hangupNow() {
  return 'hangup=yes';
}

function combine(...directives) {
  return directives.filter(Boolean).join('&');
}

// דירקטיבת חיוב אשראי דרך נדרים פלוס (מובנה בימות המשיח - אין
// צורך שהשרת שלנו יטפל בפרטי הכרטיס בעצמו).
// פורמט positional מאומת מהקהילה עבור מנועי סליקה אחרים:
// credit_card=<מנוע>,<סכום>,<מסוף>,<תשלומים>,<מטבע> - עם פרמטרים
// נוספים (ApiValid, יצירת טוקן) כ-key=value בהמשך אותה תשובה.
function chargeCreditCard({ amount, terminalNumber, apiValid, createToken = true, category }) {
  const parts = [`credit_card=nedarim_plus,${amount},${terminalNumber},1,1`, `nedarim_plus_ApiValid=${apiValid}`];
  if (createToken) parts.push('credit_card_create_token=yes');
  if (category) parts.push(`credit_card_category_nedarim_plus=${category}`);
  return parts.join('&');
}

module.exports = {
  sayText,
  readDigits,
  recordMessage,
  goToFolder,
  hangupNow,
  combine,
  chargeCreditCard,
};
