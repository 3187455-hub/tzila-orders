const session = require('./session');
const customers = require('./customers');
const inventory = require('./inventory');
const nedarim = require('../billing/nedarim');
const credit = require('../billing/credit');
const { finalizeReservationCharge } = require('../billing/finalize');
const {
  sayText,
  readDigits,
  recordMessage,
  combine,
  hangupNow,
} = require('./directives');

function startHolidayQueue(customerId) {
  const seasons = inventory.openHolidaySeasons();
  return { customerId, holidayQueue: seasons.map((s) => s.id), holidayIndex: 0 };
}

function askHolidayDirective(seasonId) {
  const seasons = inventory.openHolidaySeasons();
  const season = seasons.find((s) => s.id === seasonId);
  return combine(
    readDigits(`להרשמה לחג ${season.holiday_name}, הקש 1. לדילוג, הקש 2`, 'HOL_YN', { max: 1 })
  );
}

// כמו askHolidayDirective, אבל גם מודיע על יתרת זכות אם יש - נועד לשימוש
// רק בפעם הראשונה בשיחה (לפני החג הראשון בתור), כדי לא לחזור על ההודעה
function firstHolidayDirective(customerId, seasonId) {
  const balance = credit.getBalance(customerId);
  const prefix = balance > 0 ? sayText(`שים לב, יש לך יתרת זכות בסך ${balance} שקלים שתקוזז אוטומטית בתשלום`) : null;
  return combine(prefix, askHolidayDirective(seasonId));
}

function locationListDirective(seasonId, sess) {
  const locations = inventory.locationsForSeason(seasonId).filter((l) => l.available_beds > 0);
  if (locations.length === 0) {
    return { directive: null, empty: true };
  }
  session.updateSession(sess.call_id, { data: { currentLocations: locations.map((l) => l.location_id) } });
  const parts = locations.map(
    (l, i) => `במקום ${l.location_name} נותרו ${l.available_beds} מיטות, לבחירה הקש ${i + 1}`
  );
  return { directive: combine(readDigits(parts.join('. '), 'LOC_NUM', { max: 2 })), empty: false };
}

function nextAfterHoliday(sess) {
  const nextIndex = sess.data.holidayIndex + 1;
  if (nextIndex < sess.data.holidayQueue.length) {
    session.updateSession(sess.call_id, { step: 'ask_holiday', data: { holidayIndex: nextIndex } });
    return askHolidayDirective(sess.data.holidayQueue[nextIndex]);
  }
  return startSummary(sess);
}

function startSummary(sess) {
  const customer = customers.getById(sess.customer_id);
  const pending = inventory.pendingReservationsForCustomer(customer.id);
  if (pending.length === 0) {
    session.updateSession(sess.call_id, { step: 'done' });
    return combine(sayText('לא נבחרו מיטות. תודה ולהתראות'), hangupNow());
  }
  const total = pending.reduce((sum, r) => sum + r.bed_count * r.price_per_bed_snapshot, 0);
  const lines = pending.map((r) => `${r.bed_count} מיטות במקום ${r.location_name} לחג ${r.holiday_name}`);

  const balance = credit.getBalance(customer.id);
  const creditToApply = Math.min(balance, total);
  const amountToCharge = total - creditToApply;

  session.updateSession(sess.call_id, {
    step: 'confirm_summary',
    data: { totalAmount: amountToCharge, originalTotal: total, creditToApply },
  });

  let msg = `סיכום ההזמנה: ${lines.join(', ')}. סך הכל ${total} שקלים.`;
  if (creditToApply > 0) {
    msg += ` מתוך זה, ${creditToApply} שקלים יקוזזו מיתרת הזכות שלך`;
    msg += amountToCharge > 0 ? `, ויחויבו ${amountToCharge} שקלים באשראי` : ', ולא יידרש חיוב באשראי כלל';
  }
  msg += '. לאישור הקש 1. לביטול הקש 2';

  return combine(readDigits(msg, 'CONFIRM_YN', { max: 1 }));
}


async function handle(req, res) {
  const params = req.query;
  const callId = params.ApiCallId;
  const phone = params.ApiPhone;
  let sess = session.getSession(callId) || session.createSession(callId, null, { ivrType: 'register', phone });

  try {
    switch (sess.step) {
      case 'start': {
        const customer = customers.findByPhone(phone);
        if (customer) {
          const data = startHolidayQueue(customer.id);
          if (data.holidayQueue.length === 0) {
            session.updateSession(callId, { step: 'done', customerId: customer.id });
            return res.send(combine(sayText('אין כרגע הרשמה פתוחה לאף חג. תודה'), hangupNow()));
          }
          session.updateSession(callId, { step: 'ask_holiday', customerId: customer.id, data });
          return res.send(firstHolidayDirective(customer.id, data.holidayQueue[0]));
        }
        session.updateSession(callId, { step: 'record_name' });
        return res.send(combine(recordMessage('לא זיהינו את מספרך. אנא הקלט את שמך המלא אחרי הצפצוף', 'NAME_REC')));
      }

      case 'record_name': {
        const customer = customers.createMinimal({ phone, nameRecordingPath: params.NAME_REC });
        const data = startHolidayQueue(customer.id);
        if (data.holidayQueue.length === 0) {
          session.updateSession(callId, { step: 'done', customerId: customer.id });
          return res.send(combine(sayText('אין כרגע הרשמה פתוחה לאף חג. תודה'), hangupNow()));
        }
        session.updateSession(callId, { step: 'ask_holiday', customerId: customer.id, data });
        return res.send(askHolidayDirective(data.holidayQueue[0]));
      }

      case 'ask_holiday': {
        const seasonId = sess.data.holidayQueue[sess.data.holidayIndex];
        if (params.HOL_YN === '1') {
          session.updateSession(callId, { step: 'choose_location', data: { currentSeasonId: seasonId } });
          const { directive, empty } = locationListDirective(seasonId, sess);
          if (empty) {
            return res.send((() => {
              const next = nextAfterHoliday(session.getSession(callId));
              return combine(sayText('אין מקומות פנויים כרגע לחג זה'), next);
            })());
          }
          return res.send(directive);
        }
        return res.send(nextAfterHoliday(sess));
      }

      case 'choose_location': {
        const seasonId = sess.data.currentSeasonId;
        const idx = parseInt(params.LOC_NUM, 10) - 1;
        const locationId = (sess.data.currentLocations || [])[idx];
        const capacity = locationId ? inventory.getCapacity(seasonId, locationId) : null;
        if (!capacity || capacity.available_beds <= 0) {
          const { directive, empty } = locationListDirective(seasonId, sess);
          if (empty) return res.send(combine(sayText('אין מקומות פנויים כרגע'), nextAfterHoliday(sess)));
          return res.send(combine(sayText('בחירה לא תקינה, נסה שוב'), directive));
        }
        session.updateSession(callId, {
          step: 'ask_bed_count',
          data: { currentLocationId: locationId, currentCapacityAvailable: capacity.available_beds, currentPricePerBed: capacity.price_per_bed },
        });
        return res.send(readDigits(`כמה מיטות תרצה במקום זה? (עד ${capacity.available_beds})`, 'BED_COUNT', { max: 2 }));
      }

      case 'ask_bed_count': {
        const seasonId = sess.data.currentSeasonId;
        const locationId = sess.data.currentLocationId;
        const bedCount = parseInt(params.BED_COUNT, 10);
        const capacity = inventory.getCapacity(seasonId, locationId);
        if (!bedCount || bedCount <= 0 || bedCount > capacity.available_beds) {
          return res.send(
            combine(
              sayText('כמות לא תקינה'),
              readDigits(`כמה מיטות תרצה? (עד ${capacity.available_beds})`, 'BED_COUNT', { max: 2 })
            )
          );
        }
        inventory.upsertReservation({
          customerId: sess.customer_id,
          holidaySeasonId: seasonId,
          locationId,
          bedCount,
          pricePerBed: capacity.price_per_bed,
        });
        session.updateSession(callId, { step: 'ask_more_location' });
        return res.send(readDigits('נרשם. עוד מקום לחג הזה? הקש 1 לכן, 2 לא', 'MORE_YN', { max: 1 }));
      }

      case 'ask_more_location': {
        const seasonId = sess.data.currentSeasonId;
        if (params.MORE_YN === '1') {
          session.updateSession(callId, { step: 'choose_location' });
          const { directive, empty } = locationListDirective(seasonId, session.getSession(callId));
          if (empty) return res.send(combine(sayText('אין עוד מקומות פנויים'), nextAfterHoliday(session.getSession(callId))));
          return res.send(directive);
        }
        return res.send(nextAfterHoliday(sess));
      }

      case 'confirm_summary': {
        if (params.CONFIRM_YN === '1') {
          const { totalAmount, creditToApply } = sess.data;
          if (totalAmount <= 0) {
            finalizeReservationCharge({ customerId: sess.customer_id, callId, amountCharged: 0, creditApplied: creditToApply, success: true, method: 'credit_only' });
            session.updateSession(callId, { step: 'done' });
            session.endSession(callId);
            return res.send(
              combine(sayText(`כל הסכום, ${creditToApply} שקלים, קוזז מיתרת הזכות שלך. תודה רבה וחג שמח`), hangupNow())
            );
          }
          session.updateSession(callId, { step: 'charging' });
          return res.send(nedarim.buildChargeDirective(totalAmount));
        }
        session.updateSession(callId, { step: 'done' });
        return res.send(
          combine(
            sayText('ההזמנה נשמרה אך לא שולמה. ניתן להתקשר שוב ולבחור בשלוחת בירור ותשלום כדי להשלים. תודה'),
            hangupNow()
          )
        );
      }

      case 'charging': {
        // תוצאת החיוב - שמות הפרמטרים המדויקים טרם אומתו מול חשבון אמיתי,
        // יש להתאים כאן לפי מה שיתקבל בפועל בשיחת בדיקה.
        const success = params.Status === 'OK' || params.StatusNo === '0' || params.DealSuccessfully;
        const { totalAmount, creditToApply } = sess.data;
        finalizeReservationCharge({
          customerId: sess.customer_id,
          callId,
          amountCharged: totalAmount,
          creditApplied: creditToApply,
          success,
          confirmation: params.DealSuccessfully,
          method: 'phone',
        });

        session.updateSession(callId, { step: 'done' });
        session.endSession(callId);

        let msg;
        if (success) {
          msg =
            creditToApply > 0
              ? `קוזזו ${creditToApply} שקלים מהזכות שלך, ו-${totalAmount} שקלים חויבו באשראי. תודה רבה וחג שמח`
              : 'התשלום התקבל בהצלחה. תודה רבה וחג שמח';
        } else {
          msg = 'התשלום נכשל. ניתן לנסות שוב דרך שלוחת בירור ותשלום';
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
    console.error('IVR register error', err);
    return res.send(combine(sayText('אירעה שגיאה במערכת, נא לנסות שוב מאוחר יותר'), hangupNow()));
  }
}

module.exports = { handle };
