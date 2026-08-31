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
// שדה 6 (typing_playback_mode - צורת השמעת ההקשה) הוגדר ל-"No" במקום
// "Digits"/"Number": מאומת מתיעוד רשמי (טבלת פרמטרים ממוספרת, לא ניחוש)
// שבמודול ה-API אין פרמטר "ask" נפרד כמו במודולים אחרים - השליטה
// בהשמעה חוזרת/אישור של ההקשה היא בדיוק דרך השדה הזה. "No" = לא
// משמיע בחזרה את מה שהוקש וממשיך מיד לשלב הבא, בלי תפריט אישור.
// האישורים שאנחנו כן רוצים (כמו אישור כמות המיטות) נשארים לגמרי
// בשליטתנו כשלב נפרד בקוד, ולא תלויים בשדה הזה.
function readDigits(promptText, paramName, { max = 2, min = 1, timeout = 15 } = {}) {
  return `read=${buildSegments(promptText)}=${paramName},no,${max},${min},${timeout},No,yes,no,,`;
}

// מבקש הקלטת קול (למשל הקלטת שם) - חוזר עם נתיב קובץ ההקלטה בפרמטר
//
// מאומת מתיעוד רשמי (טבלת פרמטרים ממוספרת): הקלטת קול במודול ה-API
// היא לא עוד "סוג" של read= (כמו שניחשנו קודם עם "Message") אלא מבנה
// שדות שונה לגמרי, עם ערך קבוע "record" בשדה 3. זה מסביר את הניתוקים
// המיידיים בלי צפצוף שנצפו קודם - "Message" כנראה לא היה ערך תקין
// בכלל. מבנה: name,reuse,record,folder_move,file_name,ok,hangup,attach,min_sec,max_sec
// - ok="no": מדלג על תפריט האישור המובנה (השמעה/אישור/הקלטה מחדש)
//   ומאשר מיד בהקשת סולמית.
// - hangup="yes": שומר את ההקלטה גם אם המתקשר סתם ניתק באמצע.
function recordMessage(promptText, paramName, { minSeconds = '', maxSeconds = '' } = {}) {
  return `read=${buildSegments(promptText)}=${paramName},yes,record,,,no,yes,yes,${minSeconds},${maxSeconds}`;
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
