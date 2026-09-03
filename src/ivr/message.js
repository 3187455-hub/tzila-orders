// שלוחת "השארת הודעה" (שלוחה 0) - הקלטה חופשית שנשמרת במערכת ונשלחת
// גם במייל (אם הוגדרו פרטי SMTP).
const session = require('./session');
const db = require('../db');
const config = require('../config');
const mail = require('../mail');
const { sayText, readDigits, recordMessage, combine, hangupNow } = require('./directives');
const { last } = require('./params');

async function handle(req, res) {
  const params = req.query;
  const p = (name) => last(params, name);
  const callId = params.ApiCallId;
  const phone = params.ApiPhone;
  let sess = session.getOrCreateSession(callId, 'message', phone);

  try {
    switch (sess.step) {
      case 'start': {
        // צ'אט פנימי: אם יש תשובת מנהל שטרם נשמעה למספר הזה - משמיעים
        // אותה קודם, ואז שואלים אם להמשיך את אותה שיחה או לפתוח שיחה
        // חדשה שלא קשורה. אם אין תשובה ממתינה - פשוט מקליטים הודעה
        // חדשה (שיחה חדשה) בלי לשאול כלום.
        const pendingReply = phone
          ? db
              .prepare(
                'SELECT * FROM messages WHERE phone = ? AND reply_text IS NOT NULL AND reply_heard = 0 ORDER BY id DESC LIMIT 1'
              )
              .get(phone)
          : null;
        if (pendingReply) {
          db.prepare('UPDATE messages SET reply_heard = 1 WHERE id = ?').run(pendingReply.id);
          session.updateSession(callId, {
            step: 'choose_continue',
            data: { threadId: pendingReply.thread_id || pendingReply.id },
          });
          return res.send(
            combine(
              sayText(['יש לך תשובה חדשה', pendingReply.reply_text]),
              readDigits(
                ['להמשיך את אותה שיחה הקש 1', 'לפתוח שיחה חדשה שלא קשורה הקש 2'],
                'CONTINUE_CHOICE',
                { max: 1 }
              )
            )
          );
        }
        session.updateSession(callId, { step: 'recording', data: { threadId: null } });
        return res.send(
          combine(recordMessage(['אנא השאר את הודעתך אחרי הצליל', 'ולסיום ההקלטה שלך הקש סולמית'], 'MESSAGE_REC'))
        );
      }

      case 'choose_continue': {
        const continueThread = p('CONTINUE_CHOICE') !== '2';
        session.updateSession(callId, {
          step: 'recording',
          data: { threadId: continueThread ? sess.data.threadId : null },
        });
        return res.send(
          combine(recordMessage(['אנא השאר את הודעתך אחרי הצליל', 'ולסיום ההקלטה שלך הקש סולמית'], 'MESSAGE_REC'))
        );
      }

      case 'recording': {
        const recordingPath = p('MESSAGE_REC');
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
