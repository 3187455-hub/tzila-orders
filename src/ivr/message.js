// שלוחת "השארת הודעה" (שלוחה 0) - הקלטה חופשית שנשמרת במערכת ונשלחת
// גם במייל (אם הוגדרו פרטי SMTP).
const session = require('./session');
const db = require('../db');
const config = require('../config');
const mail = require('../mail');
const { sayText, recordMessage, combine, hangupNow } = require('./directives');
const { last } = require('./params');

async function handle(req, res) {
  const params = req.query;
  const p = (name) => last(params, name);
  const callId = params.ApiCallId;
  const phone = params.ApiPhone;
  let sess = session.getSession(callId) || session.createSession(callId, null, { ivrType: 'message', phone });

  try {
    switch (sess.step) {
      case 'start': {
        session.updateSession(callId, { step: 'recording' });
        return res.send(
          combine(
            recordMessage(['אנא השאר את הודעתך אחרי הצליל', 'ולסיום ההקלטה שלך הקש סולמית'], 'MESSAGE_REC')
          )
        );
      }

      case 'recording': {
        const recordingPath = p('MESSAGE_REC');
        const result = db
          .prepare('INSERT INTO messages (phone, recording_path) VALUES (?, ?)')
          .run(phone || null, recordingPath || null);

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
