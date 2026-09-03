// שלוחת "השארת הודעה" (שלוחה 0) - הקלטה חופשית שנשמרת במערכת ונשלחת
// גם במייל (אם הוגדרו פרטי SMTP).
const session = require('./session');
const db = require('../db');
const config = require('../config');
const mail = require('../mail');
const { sayText, readDigits, recordMessage, combine, hangupNow } = require('./directives');
const { last } = require('./params');

// מבקש הקלטה חדשה - עם שם פרמטר ייחודי (חד-פעמי אמיתי, לא מונה
// שמתאפס) לכל ניסיון הקלטה. נצפה בבדיקה חיה: ימות המשיח "זוכר" תשובה
// שכבר ניתנה לשם פרמטר מסוים לאורך כל ה-ApiCallId האמיתי אצלו - גם אם
// הסשן שלנו כאן התאפס/נוצר מחדש (אושר: אותו קובץ הקלטה חזר פעמיים
// ברצף בלי שהמתקשר קיבל הזדמנות לדבר, כי שני ניסיונות ביקשו את אותו
// שם פרמטר "MESSAGE_REC"). מונה שמתאפס עם הסשן שלנו לא מספיק בטוח -
// משתמשים בחותמת זמן כדי להבטיח שם שלא נעשה בו שימוש חוזר אף פעם.
function startRecording(sess) {
  const paramName = `MESSAGE_REC_${Date.now()}`;
  session.updateSession(sess.call_id, { step: 'recording', data: { recordParam: paramName } });
  return combine(recordMessage(['אנא השאר את הודעתך אחרי הצליל', 'ולסיום ההקלטה שלך הקש סולמית'], paramName));
}

async function handle(req, res) {
  const params = req.query;
  const p = (name) => last(params, name);
  const callId = params.ApiCallId;
  const phone = params.ApiPhone;
  let sess = session.getOrCreateSession(callId, 'message', phone);

  try {
    switch (sess.step) {
      case 'start': {
        // צ'אט פנימי: אם יש היסטוריה קודמת למספר הזה (בין אם יש תשובה
        // ממתינה ובין אם לא, ובין אם התשובה כבר נשמעה בעבר) - תמיד
        // שואלים אם להמשיך את השיחה הקודמת או לפתוח שיחה חדשה שלא
        // קשורה. רק למתקשר בפעם הראשונה אי-פעם (אין שום הודעה קודמת
        // למספר שלו) אין מה להמשיך - מקליטים ישר.
        const latestForPhone = phone
          ? db.prepare('SELECT * FROM messages WHERE phone = ? ORDER BY id DESC LIMIT 1').get(phone)
          : null;

        if (!latestForPhone) {
          session.updateSession(callId, { data: { threadId: null } });
          return res.send(startRecording(session.getSession(callId)));
        }

        const hasPendingReply = !!(latestForPhone.reply_text && !latestForPhone.reply_heard);
        if (hasPendingReply) {
          db.prepare('UPDATE messages SET reply_heard = 1 WHERE id = ?').run(latestForPhone.id);
        }
        session.updateSession(callId, {
          step: 'choose_continue',
          data: { threadId: latestForPhone.thread_id || latestForPhone.id },
        });
        const lines = [];
        if (hasPendingReply) {
          lines.push('יש לך תשובה חדשה');
          lines.push(latestForPhone.reply_text);
        }
        lines.push('להמשיך את השיחה הקודמת שלך הקש 1');
        lines.push('לפתוח שיחה חדשה שלא קשורה הקש 2');
        return res.send(readDigits(lines, 'CONTINUE_CHOICE', { max: 1 }));
      }

      case 'choose_continue': {
        const continueThread = p('CONTINUE_CHOICE') !== '2';
        session.updateSession(callId, { data: { threadId: continueThread ? sess.data.threadId : null } });
        return res.send(startRecording(session.getSession(callId)));
      }

      case 'recording': {
        const recordingPath = p(sess.data.recordParam);
        const result = db
          .prepare('INSERT INTO messages (phone, recording_path) VALUES (?, ?)')
          .run(phone || null, recordingPath || null);
        const threadId = sess.data.threadId || result.lastInsertRowid;
        db.prepare('UPDATE messages SET thread_id = ? WHERE id = ?').run(threadId, result.lastInsertRowid);

        const adminUrl = `${config.appBaseUrl}/admin/messages`;
        mail
          .sendMessageNotification({ phone, adminUrl })
          .then((sent) => {
            if (sent) db.prepare('UPDATE messages SET email_sent = 1 WHERE id = ?').run(result.lastInsertRowid);
          })
          .catch((e) => console.error('sendMessageNotification failed', e));

        session.updateSession(callId, { step: 'done' });
        session.endSession(callId);
        return res.send(combine(sayText('ההודעה שלך נקלטה בהצלחה, תודה רבה לך'), hangupNow()));
      }

      default: {
        session.endSession(callId);
        return res.send(combine(sayText('אירעה שגיאה, אנא נסה שוב'), hangupNow()));
      }
    }
  } catch (err) {
    console.error('IVR message error', err);
    return res.send(combine(sayText('אירעה שגיאה כללית במערכת'), hangupNow()));
  }
}

module.exports = { handle };
