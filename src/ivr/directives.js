// בונה מחרוזות תשובה לימות המשיח (מודול ה-API החיצוני).
//
// הערה חשובה: לימות המשיח אין תיעוד רשמי מלא ומדויק לכל הפרמטרים -
// התחביר כאן מבוסס על תיעוד קהילתי (פורום freeivr.co.il). יש לוודא/לכייל
// מול שיחת בדיקה אמיתית בזמן ההקמה, ולתקן כאן במקום אחד אם צריך.

function sayText(text) {
  return `id_list_message=t-${text}`;
}

// פסיקים/נקודות בתוך טקסט ההודעה של דירקטיבת read= מבלבלים את הפרסור של
// ימות המשיח (מתפרשים כאילו הם שדות הנתונים שאחרי ה-=) וגורמים לניתוק
// מיידי של השיחה - התגלה בבדיקה חיה. מחליפים אותם ברווח/מקף לפני שליחה.
function sanitizeForRead(text) {
  return text.replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim();
}

// מבקש הקשות ממספר ספרות עם שם פרמטר, ומחזיר לשלב הבא בשם הזה
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
function chargeCreditCard({ amount, terminalNumber, apiValid, createToken = true, category }) {
  const parts = [
    'type=credit_card',
    'credit_card_type=nedarim_plus',
    `credit_card_terminal_number=${terminalNumber}`,
    `nedarim_plus_ApiValid=${apiValid}`,
    `billing_sum=${amount}`,
  ];
  if (createToken) parts.push('credit_card_create_token=yes');
  if (category) parts.push(`credit_card_category_nedarim_plus=${encodeURIComponent(category)}`);
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
