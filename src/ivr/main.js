// שלוחת "שער כניסה" (type=api בשורש עץ השלוחות) - רצה לפני התפריט
// הראשי (M1000). תפקידה היחיד: לבדוק אם יש ללקוח הודעה שטרם שמע
// בצ'אט הפנימי, ואם כן להשמיע על כך התראה קצרה, ואז בכל מקרה להעביר
// את השיחה לתפריט הראשי המקורי שהועבר לשלוחה /menu (זהה לגמרי למה
// שהיה בשורש קודם - טעינה, לא שינוי, של 4 האפשרויות).
const messageNotice = require('./messageNotice');
const { combine, goToFolder } = require('./directives');

async function handle(req, res) {
  const phone = req.query.ApiPhone;
  const notice = messageNotice.pendingNotice(phone);
  return res.send(combine(notice, goToFolder('/menu')));
}

module.exports = { handle };
