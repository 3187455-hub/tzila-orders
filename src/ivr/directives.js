// בונה מחרוזות תשובה לימות המשיח (מודול ה-API החיצוני).
//
// הערה חשובה: לימות המשיח אין תיעוד רשמי מלא ומדויק לכל הפרמטרים -
// התחביר כאן מבוסס על תיעוד קהילתי (פורום freeivr.co.il). יש לוודא/לכייל
// מול שיחת בדיקה אמיתית בזמן ההקמה, ולתקן כאן במקום אחד אם צריך.

function sayText(text) {
  return `id_list_message=t-${text}`;
}

// פסיקים ונקודות בתוך טקסט ההודעה של דירקטיבת read= מבלבלים את הפרסור
// של ימות המשיח וגורמים לניתוק מיידי של השיחה - שניהם התגלו בבדיקה חיה
// (פסיקים - מוקדם יותר; נקודות - גם כשהמשפט קצר וגם כשהיה ארוך, כולל
// מקרה מבודד שבו ההבדל היחיד בין הודעה שעבדה להודעה שלא היה נקודות
// מול רווחים). לכן שניהם מוחלפים ברווח - בלי הפסקות קלות בקריאה, אבל
// אמין.
function sanitizeForRead(text) {
  return text.replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim();
}

// מבקש הקשות ממספר ספרות עם שם פרמטר, ומחזיר לשלב הבא בשם הזה
//
// הערה: ניסיתי בעבר להוסיף כאן שדות נוספים (עד שדה 15) כדי לבטל את
// בקשת האישור האוטומטית של ימות המשיח - התברר שזה שבר את הדירקטיבה
// (גרם ל"שגיאה" חוזרת בשיחה אמיתית). חוזרים לפורמט המצומצם שכן עובד;
// בקשת האישור האוטומטית של ימות המשיח נשארת בינתיים כפי שהיא.
function readDigits(promptText, paramName, { max = 2, min = 1, timeout = 15 } = {}) {
  return `read=t-${sanitizeForRead(promptText)}=${paramName},no,${max},${min},${timeout},Digits,yes,no,,`;
}

// מבקש הקלטת קול (למשל הקלטת שם) - חוזר עם נתיב קובץ ההקלטה בפרמטר
function recordMessage(promptText, paramName, { maxSeconds = 15, timeout = 15 } = {}) {
  return `read=t-${sanitizeForRead(promptText)}=${paramName},no,${maxSeconds},,${timeout},Message,yes,no,,`;
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
