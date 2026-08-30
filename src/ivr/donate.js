const session = require('./session');
const customers = require('./customers');
const db = require('../db');
const nedarim = require('../billing/nedarim');
const { sayText, readDigits, combine, hangupNow } = require('./directives');

async function handle(req, res) {
  const params = req.query;
  const callId = params.ApiCallId;
  const phone = params.ApiPhone;
  let sess = session.getSession(callId) || session.createSession(callId, null, { ivrType: 'donate', phone });

  try {
    switch (sess.step) {
      case 'start': {
        let customer = customers.findByPhone(phone);
        if (!customer) customer = customers.createMinimal({ phone });
        session.updateSession(callId, { step: 'ask_amount', customerId: customer.id });
        return res.send(readDigits('כמה ברצונך לתרום, בשקלים?', 'AMOUNT', { max: 5 }));
      }

      case 'ask_amount': {
        const amount = parseInt(params.AMOUNT, 10);
        if (!amount || amount <= 0) {
          return res.send(combine(sayText('סכום לא תקין'), readDigits('כמה ברצונך לתרום, בשקלים?', 'AMOUNT', { max: 5 })));
        }
        const result = db
          .prepare('INSERT INTO donations (customer_id, amount, status, call_id) VALUES (?, ?, ?, ?)')
          .run(sess.customer_id, amount, 'pending', callId);
        session.updateSession(callId, { step: 'charging', data: { donationId: result.lastInsertRowid, amount } });
        return res.send(nedarim.buildChargeDirective(amount));
      }

      case 'charging': {
        const success = params.Status === 'OK' || params.StatusNo === '0' || params.DealSuccessfully;
        db.prepare('UPDATE donations SET status = ?, nedarim_confirmation = ? WHERE id = ?').run(
          success ? 'success' : 'failed',
          params.DealSuccessfully || null,
          sess.data.donationId
        );
        if (success) {
          const customer = customers.getById(sess.customer_id);
          nedarim.syncTokenAcrossPhones(customers.allPhoneNumbers(customer)).catch((e) => console.error('token sync failed', e));
        }
        session.endSession(callId);
        return res.send(
          combine(sayText(success ? 'תודה רבה על תרומתך' : 'התרומה נכשלה, אפשר לנסות שוב'), hangupNow())
        );
      }

      default: {
        session.endSession(callId);
        return res.send(combine(sayText('אירעה שגיאה'), hangupNow()));
      }
    }
  } catch (err) {
    console.error('IVR donate error', err);
    return res.send(combine(sayText('אירעה שגיאה במערכת'), hangupNow()));
  }
}

module.exports = { handle };
