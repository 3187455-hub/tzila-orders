const session = require('./session');
const customers = require('./customers');
const inventory = require('./inventory');
const db = require('../db');
const nedarim = require('../billing/nedarim');
const credit = require('../billing/credit');
const { finalizeReservationCharge } = require('../billing/finalize');
const { sayText, readDigits, combine, hangupNow } = require('./directives');
const { last } = require('./params');

function buildMenuDirective(callId, customerId) {
  const all = inventory.allReservationsForCustomer(customerId);
  if (all.length === 0) {
    session.updateSession(callId, { step: 'done' });
    return combine(sayText('לא נמצאה אצלך שום הזמנה כרגע. תודה'), hangupNow());
  }
  const lines = all.map(
    (r) =>
      `${r.bed_count} מיטות במקום ${r.location_name} לחג ${r.holiday_name} - ${r.status === 'paid' ? 'שולם' : 'טרם שולם'}`
  );
  const pendingTotal = all
    .filter((r) => r.status === 'pending_payment')
    .reduce((sum, r) => sum + r.bed_count * r.price_per_bed_snapshot, 0);

  const balance = credit.getBalance(customerId);
  const creditToApply = Math.min(balance, pendingTotal);
  const amountToCharge = pendingTotal - creditToApply;

  session.updateSession(callId, { step: 'menu', data: { pendingTotal, creditToApply, amountToCharge } });

  let suffix;
  if (pendingTotal > 0) {
    suffix = `יש לך יתרה לתשלום של ${pendingTotal} שקלים.`;
    if (creditToApply > 0) {
      suffix += ` יש לך גם יתרת זכות של ${balance} שקלים, ומתוכה יקוזזו ${creditToApply} שקלים.`;
      suffix += amountToCharge > 0 ? ` יישאר לחיוב באשראי ${amountToCharge} שקלים.` : ' לא יידרש חיוב באשראי כלל.';
    }
    suffix += ' לתשלום עכשיו הקש 1. לעריכה או מחיקה של הזמנה הקש 2. לסיום הקש 9';
  } else {
    suffix = 'כל ההזמנות שולמו.';
    if (balance > 0) suffix += ` יש לך יתרת זכות של ${balance} שקלים לשימוש בהזמנה הבאה.`;
    suffix += ' לעריכה או מחיקה של הזמנה הקש 2. לסיום הקש 9';
  }

  return combine(readDigits(`${lines.join(', ')}. ${suffix}`, 'MENU_CHOICE', { max: 1 }));
}

function buildEditListDirective(callId, customerId) {
  const pending = inventory.pendingReservationsForCustomer(customerId);
  if (pending.length === 0) {
    return combine(sayText('אין הזמנות שטרם שולמו לעריכה'), buildMenuDirective(callId, customerId));
  }
  session.updateSession(callId, { step: 'choose_edit_item', data: { editList: pending.map((r) => r.id) } });
  const parts = pending.map(
    (r, i) => `הקש ${i + 1} עבור ${r.bed_count} מיטות במקום ${r.location_name} לחג ${r.holiday_name}`
  );
  return combine(readDigits(parts.join(', '), 'EDIT_NUM', { max: 2 }));
}

async function handle(req, res) {
  const params = req.query;
  const p = (name) => last(params, name);
  const callId = params.ApiCallId;
  const phone = params.ApiPhone;
  let sess = session.getSession(callId) || session.createSession(callId, null, { ivrType: 'status', phone });

  try {
    switch (sess.step) {
      case 'start': {
        const customer = customers.findByPhone(phone);
        if (!customer) {
          session.updateSession(callId, { step: 'done' });
          return res.send(combine(sayText('לא זיהינו מספר זה במערכת. תודה'), hangupNow()));
        }
        session.updateSession(callId, { customerId: customer.id });
        return res.send(buildMenuDirective(callId, customer.id));
      }

      case 'menu': {
        if (p('MENU_CHOICE') === '1' && sess.data.pendingTotal > 0) {
          const { amountToCharge, creditToApply } = sess.data;
          if (amountToCharge <= 0) {
            finalizeReservationCharge({
              customerId: sess.customer_id,
              callId,
              amountCharged: 0,
              creditApplied: creditToApply,
              success: true,
              method: 'credit_only',
            });
            session.updateSession(callId, { step: 'done' });
            session.endSession(callId);
            return res.send(
              combine(sayText(`כל הסכום, ${creditToApply} שקלים, קוזז מיתרת הזכות שלך. תודה`), hangupNow())
            );
          }
          session.updateSession(callId, { step: 'charging' });
          return res.send(nedarim.buildChargeDirective(amountToCharge));
        }
        if (p('MENU_CHOICE') === '2') {
          return res.send(buildEditListDirective(callId, sess.customer_id));
        }
        session.updateSession(callId, { step: 'done' });
        return res.send(combine(sayText('תודה ולהתראות'), hangupNow()));
      }

      case 'choose_edit_item': {
        const idx = parseInt(p('EDIT_NUM'), 10) - 1;
        const reservationId = (sess.data.editList || [])[idx];
        if (!reservationId) {
          return res.send(combine(sayText('בחירה לא תקינה'), buildEditListDirective(callId, sess.customer_id)));
        }
        const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId);
        const capacity = inventory.getCapacity(reservation.holiday_season_id, reservation.location_id);
        const maxAllowed = capacity.available_beds + reservation.bed_count;
        session.updateSession(callId, { step: 'apply_edit', data: { editReservationId: reservationId, maxAllowed } });
        return res.send(
          readDigits(`הקלד כמות מיטות חדשה (עד ${maxAllowed}), או 0 למחיקת ההזמנה`, 'NEW_COUNT', { max: 2 })
        );
      }

      case 'apply_edit': {
        const newCount = parseInt(p('NEW_COUNT'), 10);
        const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(sess.data.editReservationId);
        if (Number.isNaN(newCount) || newCount > sess.data.maxAllowed) {
          return res.send(
            combine(
              sayText('כמות לא תקינה'),
              readDigits(`הקלד כמות מיטות (עד ${sess.data.maxAllowed}), או 0 למחיקה`, 'NEW_COUNT', { max: 2 })
            )
          );
        }
        if (newCount === 0) {
          inventory.cancelReservation(reservation.id);
        } else {
          inventory.upsertReservation({
            customerId: reservation.customer_id,
            holidaySeasonId: reservation.holiday_season_id,
            locationId: reservation.location_id,
            bedCount: newCount,
            pricePerBed: reservation.price_per_bed_snapshot,
          });
        }
        return res.send(combine(sayText('עודכן בהצלחה'), buildMenuDirective(callId, sess.customer_id)));
      }

      case 'charging': {
        const success = p('CreditCard_CODE') === 'OK';
        const { amountToCharge, creditToApply } = sess.data;
        finalizeReservationCharge({
          customerId: sess.customer_id,
          callId,
          amountCharged: amountToCharge,
          creditApplied: creditToApply,
          success,
          confirmation: p('CreditCard_CODE'),
          method: 'phone',
        });
        session.endSession(callId);
        let msg;
        if (success) {
          msg =
            creditToApply > 0
              ? `קוזזו ${creditToApply} שקלים מהזכות שלך, ו-${amountToCharge} שקלים חויבו באשראי. תודה`
              : 'התשלום התקבל בהצלחה. תודה';
        } else {
          msg = 'התשלום נכשל, נסה שוב מאוחר יותר';
        }
        return res.send(combine(sayText(msg), hangupNow()));
      }

      case 'done': {
        session.endSession(callId);
        return res.send(combine(sayText('תודה, להתראות'), hangupNow()));
      }

      default: {
        session.endSession(callId);
        return res.send(combine(sayText('אירעה שגיאה, נא להתקשר שוב'), hangupNow()));
      }
    }
  } catch (err) {
    console.error('IVR status error', err);
    return res.send(combine(sayText('אירעה שגיאה במערכת'), hangupNow()));
  }
}

module.exports = { handle };
