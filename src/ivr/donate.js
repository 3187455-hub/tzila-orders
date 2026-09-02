const session = require('./session');
const customers = require('./customers');
const db = require('../db');
const nedarim = require('../billing/nedarim');
const { sayText, readDigits, combine, hangupNow } = require('./directives');
const { last } = require('./params');

async function handle(req, res) {
  const params = req.query;
  const p = (name) => last(params, name);
  const callId = params.ApiCallId;
  const phone = params.ApiPhone;
  let sess = session.getOrCreateSession(callId, 'donate', phone);

  try {
    switch (sess.step) {
      case 'start': {
        let customer = customers.findByPhone(phone);
        if (!customer) customer = customers.createMinimal({ phone });
        session.updateSession(callId, { step: 'ask_amount', customerId: customer.id });
        return res.send(readDigits('כמה שקלים ברצונך לתרום היום', 'AMOUNT', { max: 5 }));
      }

      case 'ask_amount': {
        const amount = parseInt(p('AMOUNT'), 10);
        if (!amount || amount <= 0) {
          return res.send(combine(sayText('הסכום שהקשת אינו תקין, נסה שוב'), readDigits('כמה שקלים ברצונך לתרום היום', 'AMOUNT', { max: 5 })));
        }
        const result = db
          .prepare('INSERT INTO donations (customer_id, amount, status, call_id) VALUES (?, ?, ?, ?)')
          .run(sess.customer_id, amount, 'pending', callId);
        session.updateSession(callId, { step: 'charging', data: { donationId: result.lastInsertRowid, amount } });
        return res.send(nedarim.buildChargeDirective(amount));
      }

      case 'charging': {
        const success = p('CreditCard_CODE') === 'OK';
        db.prepare('UPDATE donations SET status = ?, nedarim_confirmation = ? WHERE id = ?').run(
          success ? 'success' : 'failed',
          p('CreditCard_CODE') || null,
          sess.data.donationId
        );
        if (success) {
          const customer = customers.getById(sess.customer_id);
          nedarim.syncTokenAcrossPhones(customers.allPhoneNumbers(customer)).catch((e) => console.error('token sync failed', e));
          nedarim
            .lookupLastNumFromHistory({ amount: sess.data.amount })
            .then((found) => {
              if (found) db.prepare('UPDATE customers SET card_last4 = ? WHERE id = ?').run(found, customer.id);
            })
            .catch((e) => console.error('lookupLastNumFromHistory failed', e));
        }
        session.endSession(callId);
        return res.send(
          combine(sayText(success ? 'תודה רבה לך על תרומתך הנדיבה' : 'התרומה נכשלה, אפשר לנסות שוב מאוחר יותר'), hangupNow())
        );
      }

      default: {
        session.endSession(callId);
        return res.send(combine(sayText('אירעה שגיאה, אנא נסה שוב'), hangupNow()));
      }
    }
  } catch (err) {
    console.error('IVR donate error', err);
    return res.send(combine(sayText('אירעה שגיאה כללית במערכת'), hangupNow()));
  }
}

module.exports = { handle };
