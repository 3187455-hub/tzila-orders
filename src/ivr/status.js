const session = require('./session');
const customers = require('./customers');
const inventory = require('./inventory');
const db = require('../db');
const nedarim = require('../billing/nedarim');
const credit = require('../billing/credit');
const { finalizeReservationCharge } = require('../billing/finalize');
const { sayText, readDigits, combine, hangupNow } = require('./directives');
const { last } = require('./params');

function paymentMethodLabel(method) {
  switch (method) {
    case 'phone':
      return 'באשראי';
    case 'manual_cash':
      return 'במזומן';
    case 'manual_check':
      return "בצ'ק";
    case 'credit_only':
      return 'מיתרת זכות';
    default:
      return '';
  }
}

function buildMenuDirective(callId, customerId) {
  const all = inventory.allReservationsForCustomer(customerId);
  if (all.length === 0) {
    session.updateSession(callId, { step: 'done' });
    return combine(sayText('לא נמצאה אצלך שום הזמנה כרגע תודה'), hangupNow());
  }

  const byHoliday = [];
  for (const r of all) {
    let group = byHoliday.find((g) => g.holiday_name === r.holiday_name && g.year_label === r.year_label);
    if (!group) {
      group = { holiday_name: r.holiday_name, year_label: r.year_label, items: [] };
      byHoliday.push(group);
    }
    group.items.push(r);
  }
  const lines = [];
  for (const g of byHoliday) {
    lines.push(`לגבי החג ${g.holiday_name} יש לך את ההזמנות הבאות`);
    for (const r of g.items) {
      lines.push(
        r.status === 'paid'
          ? `${r.bed_count} מיטות במקום ${r.location_name} שולם ${paymentMethodLabel(r.payment_method)}`
          : `${r.bed_count} מיטות במקום ${r.location_name} טרם שולם`
      );
    }
  }

  const pendingTotal = all
    .filter((r) => r.status === 'pending_payment')
    .reduce((sum, r) => sum + r.bed_count * r.price_per_bed_snapshot, 0);

  const balance = credit.getBalance(customerId);

  session.updateSession(callId, { step: 'menu', data: { pendingTotal } });

  if (pendingTotal > 0) {
    lines.push(`יש לך יתרה לתשלום של ${pendingTotal} שקלים`);
    if (balance > 0) {
      lines.push(`יש לך גם יתרת זכות של ${balance} שקלים תוכל להחליט על השימוש בה בזמן התשלום`);
    }
    lines.push('לתשלום מיידי של הסכום הזה הקש 1');
    lines.push('לעריכה או מחיקה של הזמנה קיימת הקש 2');
    lines.push('לסיום השיחה הקש 9');
  } else {
    lines.push('כל ההזמנות שלך כבר שולמו במלואן');
    if (balance > 0) lines.push(`יש לך יתרת זכות של ${balance} שקלים לשימוש בהזמנה הבאה`);
    lines.push('לעריכה או מחיקה של הזמנה קיימת הקש 2');
    lines.push('לסיום השיחה הקש 9');
  }

  return combine(readDigits(lines, 'MENU_CHOICE', { max: 1 }));
}

function buildEditListDirective(callId, customerId) {
  const pending = inventory.pendingReservationsForCustomer(customerId);
  if (pending.length === 0) {
    return combine(sayText('אין הזמנות שטרם שולמו לעריכה'), buildMenuDirective(callId, customerId));
  }
  session.updateSession(callId, { step: 'choose_edit_item', data: { editList: pending.map((r) => r.id) } });
  const lines = pending.map(
    (r, i) => `הקש ${i + 1} עבור ${r.bed_count} מיטות במקום ${r.location_name} לחג ${r.holiday_name}`
  );
  lines.push('לאחר הקלדת המספר הקש סולמית לסיום');
  return combine(readDigits(lines, 'EDIT_NUM', { max: 2 }));
}

// אחרי שהלקוח בחר אם לקזז זכות או לא (או אם אין לו זכות כלל) -
// מבצע בפועל את החיוב, או מסיים ישר אם הקיזוז מכסה הכל.
function startPaymentOrCredit(callId, customerId, total, creditToApply) {
  const amountToCharge = total - creditToApply;
  if (amountToCharge <= 0) {
    finalizeReservationCharge({
      customerId,
      callId,
      amountCharged: 0,
      creditApplied: creditToApply,
      success: true,
      method: 'credit_only',
    });
    session.updateSession(callId, { step: 'done' });
    session.endSession(callId);
    return combine(sayText([`כל הסכום ${creditToApply} שקלים קוזז מיתרת הזכות שלך`, 'תודה רבה לך']), hangupNow());
  }
  session.updateSession(callId, { step: 'charging', data: { amountToCharge, creditToApply } });
  return nedarim.buildChargeDirective(amountToCharge);
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
          return res.send(combine(sayText('לא זיהינו את מספר הטלפון הזה במערכת, תודה רבה'), hangupNow()));
        }
        session.updateSession(callId, { customerId: customer.id });
        return res.send(buildMenuDirective(callId, customer.id));
      }

      case 'menu': {
        if (p('MENU_CHOICE') === '1' && sess.data.pendingTotal > 0) {
          const { pendingTotal } = sess.data;
          const balance = credit.getBalance(sess.customer_id);
          if (balance > 0) {
            session.updateSession(callId, { step: 'choose_credit', data: { checkoutTotal: pendingTotal } });
            return res.send(
              readDigits(
                [
                  `יש לך יתרת זכות בסך ${balance} שקלים`,
                  'אם ברצונך לקזז את הזכות מהסכום עכשיו הקש 1',
                  `להשאיר את הזכות לפעם הבאה ולשלם ${pendingTotal} שקלים באשראי הקש 2`,
                ],
                'CREDIT_CHOICE',
                { max: 1 }
              )
            );
          }
          return res.send(startPaymentOrCredit(callId, sess.customer_id, pendingTotal, 0));
        }
        if (p('MENU_CHOICE') === '2') {
          return res.send(buildEditListDirective(callId, sess.customer_id));
        }
        session.updateSession(callId, { step: 'done' });
        return res.send(combine(sayText('תודה רבה ולהתראות'), hangupNow()));
      }

      case 'choose_credit': {
        const { checkoutTotal } = sess.data;
        const balance = credit.getBalance(sess.customer_id);
        const creditToApply = p('CREDIT_CHOICE') === '1' ? Math.min(balance, checkoutTotal) : 0;
        return res.send(startPaymentOrCredit(callId, sess.customer_id, checkoutTotal, creditToApply));
      }

      case 'choose_edit_item': {
        const idx = parseInt(p('EDIT_NUM'), 10) - 1;
        const reservationId = (sess.data.editList || [])[idx];
        if (!reservationId) {
          return res.send(combine(sayText('המספר שהקשת אינו תואם אף אחת מהאפשרויות'), buildEditListDirective(callId, sess.customer_id)));
        }
        const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId);
        // בשלוחת בירור ותשלום מותר רק להקטין או לבטל הזמנה קיימת, לא
        // להגדיל אותה (הגדלה/הזמנה חדשה נעשית דרך שלוחת ההרשמה)
        const maxAllowed = reservation.bed_count;
        session.updateSession(callId, { step: 'apply_edit', data: { editReservationId: reservationId, maxAllowed } });
        return res.send(
          readDigits(
            [`הקלד כמות מיטות חדשה עד ${maxAllowed}, או 0 למחיקת ההזמנה`, 'ולסיום הקש סולמית'],
            'NEW_COUNT',
            { max: 2 }
          )
        );
      }

      case 'apply_edit': {
        const newCount = parseInt(p('NEW_COUNT'), 10);
        const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(sess.data.editReservationId);
        if (Number.isNaN(newCount) || newCount > sess.data.maxAllowed) {
          return res.send(
            combine(
              sayText('הכמות שהקשת אינה במסגרת התקינה'),
              readDigits(
                [`הקלד כמות מיטות עד ${sess.data.maxAllowed}, או 0 למחיקה`, 'ולסיום הקש סולמית'],
                'NEW_COUNT',
                { max: 2 }
              )
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
        return res.send(combine(sayText('ההזמנה שלך עודכנה בהצלחה'), buildMenuDirective(callId, sess.customer_id)));
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
          rawParams: params,
        });
        session.endSession(callId);
        let msg;
        if (success) {
          msg =
            creditToApply > 0
              ? `קוזזו ${creditToApply} שקלים מהזכות שלך, ו-${amountToCharge} שקלים חויבו באשראי, תודה רבה לך`
              : 'התשלום שלך התקבל בהצלחה, תודה רבה לך';
        } else {
          msg = 'התשלום נכשל, אנא נסה שוב מאוחר יותר';
        }
        return res.send(combine(sayText(msg), hangupNow()));
      }

      case 'done': {
        session.endSession(callId);
        return res.send(combine(sayText('תודה רבה לך, להתראות'), hangupNow()));
      }

      default: {
        session.endSession(callId);
        return res.send(combine(sayText('אירעה שגיאה, אנא נסה להתקשר שוב'), hangupNow()));
      }
    }
  } catch (err) {
    console.error('IVR status error', err);
    return res.send(combine(sayText('אירעה שגיאה כללית במערכת'), hangupNow()));
  }
}

module.exports = { handle };
