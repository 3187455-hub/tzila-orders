// שלוחת "שער כניסה" (type=api בשורש עץ השלוחות) - תופסת את מקום
// התפריט הטבעי (type=menu, M1000) כדי שנוכל להריץ עליו לוגיקה
// (בדיקת הודעה ממתינה) לפני שהתפריט בכלל מושמע. ניסיון ראשון היה
// להעביר את התפריט המקורי לתיקייה חדשה "/menu" ולעשות go_to_folder
// אליה - אבל התברר (נבדק בפועל: upload החזיר "OK" אך download חזרה
// מיד עם 404) שממשק ה-API של ימות המשיח לא יכול ליצור תיקיית שלוחה
// חדשה שלא נוצרה קודם בממשק הניהול - הוא רק עורך ext.ini של שלוחות
// שכבר קיימות. לכן הפתרון: משכפלים כאן בקוד את התפריט המקורי (אותן
// 4 האפשרויות, זהות לכותרות שהיו מוגדרות בתיקיות 1/2/3/0 המקוריות)
// ומפנים ישירות לתיקיות הקיימות /90 /91 /92 /0 - בלי תיקיות ביניים
// חדשות בכלל.
const messageNotice = require('./messageNotice');
const { sayText, readDigits, goToFolder, combine } = require('./directives');
const { last } = require('./params');

const MENU_PROMPT = [
  'להרשמה למיטות חג הקש 1',
  'לבירור ותשלום מיטות הקש 2',
  'לתרומה הקש 3',
  'להשארת הודעה הקש 0',
];

const TARGETS = { '1': '/90', '2': '/91', '3': '/92', '0': '/0' };

async function handle(req, res) {
  const params = req.query;
  const p = (name) => last(params, name);
  const phone = params.ApiPhone;

  const choice = p('MAIN_MENU');
  if (choice) {
    const target = TARGETS[choice];
    if (target) return res.send(goToFolder(target));
    return res.send(combine(sayText('הבחירה שהקשת אינה תקינה'), readDigits(MENU_PROMPT, 'MAIN_MENU', { max: 1 })));
  }

  const notice = messageNotice.pendingNotice(phone);
  return res.send(combine(notice, readDigits(MENU_PROMPT, 'MAIN_MENU', { max: 1 })));
}

module.exports = { handle };
