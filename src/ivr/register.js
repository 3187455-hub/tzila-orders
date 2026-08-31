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
const { last } = require('./params');

function startHolidayQueue(customerId) {
  const seasons = inventory.openHolidaySeasons();
  return { customerId, holidayQueue: seasons.map((s) => s.id), holidayIndex: 0 };
}

// תפריט חגים - ניתן לחזור אליו כמה פעמים באותה שיחה (גם אחרי שכבר
// נבחרו מיטות לחג אחד, אפשר לחזור ולבחור חג נוסף או לסיים)
function holidayMenuDirective(sess) {
  const queue = sess.data.holidayQueue;
  const seasons = inventory.openHolidaySeasons();
  const parts = queue.map((seasonId, i) => {
    const season = seasons.find((s) => s.id === seasonId);
    return `להרשמה לחג ${season ? season.holiday_name : ''} הקש ${i + 1}`;
  });
  session.updateSession(sess.call_id, { step: 'holiday_menu' });
  const msg = `${parts.join('. ')}. כדי לשמור את המקומות שבחרת ולעבור לתשלום הקש 9`;
  return readDigits(msg, 'HOLIDAY_NUM', { max: 1 });
}

// כמו holidayMenuDirective, אבל גם מודיע על יתרת זכות אם יש - נועד
// לשימוש רק בפעם הראשונה בשיחה, כדי לא לחזור על ההודעה בכל פעם
function firstHolidayMenuDirective(sess) {
  const balance = credit.getBalance(sess.customer_id);
  const prefix = balance > 0 ? sayText(`שים לב יש לך יתרת זכות בסך ${balance} שקלים שתקוזז אוטומטית בתשלום`) : null;
  return combine(prefix, holidayMenuDirective(sess));
}

function askBedCountDirective(available) {
  return readDigits(`כמה מיטות תרצה, עד ${available}. הקש את הכמות ולסיום הקש סולמית`, 'BED_COUNT', { max: 2 });
}

function locationListDirective(seasonId, sess) {
  const locations = inventory.locationsForSeason(seasonId).filter((l) => l.available_beds > 0);
  if (locations.length === 0) {
    return { directive: null, empty: true };
  }
  session.updateSession(sess.call_id, {
    step: 'choose_location',
    data: { currentLocations: locations.map((l) => l.location_id) },
  });
  const total = locations.reduce((sum, l) => sum + l.available_beds, 0);
  const parts = locations.map((l, i) => `ל${l.location_name} נשאר ${l.available_beds} לבחירה הקש ${i + 1}`);
  const msg = `נותרו במערכת ${total} מיטות. ${parts.join(' ')}`;
  return { directive: readDigits(msg, 'LOC_NUM', { max: 1 }), empty: false };
}

function startSummary(sess) {
  const customer = customers.getById(sess.customer_id);
  const pending = inventory.pendingReservationsForCustomer(customer.id);
  if (pending.length === 0) {
    session.updateSession(sess.call_id, { step: 'done' });
    return combine(sayText('לא נבחרו מיטות תודה ולהתראות'), hangupNow());
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

  let msg = `סיכום ההזמנה. ${lines.join('. ')}. סך הכל ${total} שקלים`;
  if (creditToApply > 0) {
    msg += ` מתוך זה ${creditToApply} שקלים יקוזזו מיתרת הזכות שלך`;
    msg += amountToCharge > 0 ? ` ויחויבו ${amountToCharge} שקלים באשראי` : ' ולא יידרש חיוב באשראי כלל';
  }
  msg += ' לאישור הקש 1 לביטול הקש 2';

  return combine(readDigits(msg, 'CONFIRM_YN', { max: 1 }));
}

async function handle(req, res) {
  const params = req.query;
  const p = (name) => last(params, name);
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
            return res.send(combine(sayText('אין כרגע הרשמה פתוחה לאף חג תודה'), hangupNow()));
          }
          session.updateSession(callId, { step: 'holiday_menu', customerId: customer.id, data });
          return res.send(firstHolidayMenuDirective(session.getSession(callId)));
        }
        session.updateSession(callId, { step: 'record_name' });
        return res.send(combine(recordMessage('לא זיהינו את מספרך אנא אמור עכשיו את שמך המלא', 'NAME_REC')));
      }

      case 'record_name': {
        const customer = customers.createMinimal({ phone, nameRecordingPath: p('NAME_REC') });
        const data = startHolidayQueue(customer.id);
        if (data.holidayQueue.length === 0) {
          session.updateSession(callId, { step: 'done', customerId: customer.id });
          return res.send(combine(sayText('אין כרגע הרשמה פתוחה לאף חג תודה'), hangupNow()));
        }
        session.updateSession(callId, { step: 'holiday_menu', customerId: customer.id, data });
        return res.send(holidayMenuDirective(session.getSession(callId)));
      }

      case 'holiday_menu': {
        if (p('HOLIDAY_NUM') === '9') {
          return res.send(startSummary(sess));
        }
        const idx = parseInt(p('HOLIDAY_NUM'), 10) - 1;
        const seasonId = sess.data.holidayQueue[idx];
        if (!seasonId) {
          return res.send(combine(sayText('בחירה לא תקינה'), holidayMenuDirective(sess)));
        }
        session.updateSession(callId, { data: { currentSeasonId: seasonId } });
        const { directive, empty } = locationListDirective(seasonId, session.getSession(callId));
        if (empty) {
          return res.send(combine(sayText('אין מקומות פנויים כרגע לחג זה'), holidayMenuDirective(session.getSession(callId))));
        }
        return res.send(directive);
      }

      case 'choose_location': {
        const seasonId = sess.data.currentSeasonId;
        const idx = parseInt(p('LOC_NUM'), 10) - 1;
        const locationId = (sess.data.currentLocations || [])[idx];
        const capacity = locationId ? inventory.getCapacity(seasonId, locationId) : null;
        if (!capacity || capacity.available_beds <= 0) {
          const { directive, empty } = locationListDirective(seasonId, sess);
          if (empty) return res.send(combine(sayText('אין מקומות פנויים כרגע'), holidayMenuDirective(sess)));
          return res.send(combine(sayText('בחירה לא תקינה נסה שוב'), directive));
        }
        session.updateSession(callId, {
          step: 'ask_bed_count',
          data: { currentLocationId: locationId, currentCapacityAvailable: capacity.available_beds, currentPricePerBed: capacity.price_per_bed },
        });
        return res.send(askBedCountDirective(capacity.available_beds));
      }

      case 'ask_bed_count': {
        const seasonId = sess.data.currentSeasonId;
        const locationId = sess.data.currentLocationId;
        const bedCount = parseInt(p('BED_COUNT'), 10);
        const capacity = inventory.getCapacity(seasonId, locationId);
        if (!bedCount || bedCount <= 0 || bedCount > capacity.available_beds) {
          return res.send(combine(sayText('כמות לא תקינה'), askBedCountDirective(capacity.available_beds)));
        }
        session.updateSession(callId, { step: 'confirm_count', data: { pendingBedCount: bedCount } });
        return res.send(readDigits(`בחרת ${bedCount} מיטות לאישור הקש 1 לתיקון הקש 2`, 'CONFIRM_COUNT', { max: 1 }));
      }

      case 'confirm_count': {
        const seasonId = sess.data.currentSeasonId;
        const locationId = sess.data.currentLocationId;
        const capacity = inventory.getCapacity(seasonId, locationId);
        if (p('CONFIRM_COUNT') === '1') {
          inventory.upsertReservation({
            customerId: sess.customer_id,
            holidaySeasonId: seasonId,
            locationId,
            bedCount: sess.data.pendingBedCount,
            pricePerBed: capacity.price_per_bed,
          });
          session.updateSession(callId, { step: 'after_location' });
          return res.send(readDigits('נרשם עוד מקום באותו חג הקש 1 לחג אחר או לסיום הקש 2', 'AFTER_LOC', { max: 1 }));
        }
        session.updateSession(callId, { step: 'ask_bed_count' });
        return res.send(askBedCountDirective(capacity.available_beds));
      }

      case 'after_location': {
        const seasonId = sess.data.currentSeasonId;
        if (p('AFTER_LOC') === '1') {
          const { directive, empty } = locationListDirective(seasonId, sess);
          if (empty) return res.send(combine(sayText('אין עוד מקומות פנויים בחג זה'), holidayMenuDirective(sess)));
          return res.send(directive);
        }
        return res.send(holidayMenuDirective(sess));
      }

      case 'confirm_summary': {
        if (p('CONFIRM_YN') === '1') {
          const { totalAmount, creditToApply } = sess.data;
          if (totalAmount <= 0) {
            finalizeReservationCharge({ customerId: sess.customer_id, callId, amountCharged: 0, creditApplied: creditToApply, success: true, method: 'credit_only' });
            session.updateSession(callId, { step: 'done' });
            session.endSession(callId);
            return res.send(
              combine(sayText(`כל הסכום ${creditToApply} שקלים קוזז מיתרת הזכות שלך תודה רבה וחג שמח`), hangupNow())
            );
          }
          session.updateSession(callId, { step: 'charging' });
          return res.send(nedarim.buildChargeDirective(totalAmount));
        }
        session.updateSession(callId, { step: 'done' });
        return res.send(
          combine(
            sayText('ההזמנה נשמרה אך לא שולמה ניתן להתקשר שוב ולבחור בשלוחת בירור ותשלום כדי להשלים תודה'),
            hangupNow()
          )
        );
      }

      case 'charging': {
        const success = p('CreditCard_CODE') === 'OK';
        const { totalAmount, creditToApply } = sess.data;
        finalizeReservationCharge({
          customerId: sess.customer_id,
          callId,
          amountCharged: totalAmount,
          creditApplied: creditToApply,
          success,
          confirmation: p('CreditCard_CODE'),
          method: 'phone',
          rawParams: params,
        });

        session.updateSession(callId, { step: 'done' });
        session.endSession(callId);

        let msg;
        if (success) {
          msg =
            creditToApply > 0
              ? `קוזזו ${creditToApply} שקלים מהזכות שלך ו ${totalAmount} שקלים חויבו באשראי תודה רבה וחג שמח`
              : 'התשלום התקבל בהצלחה תודה רבה וחג שמח';
        } else {
          msg = 'התשלום נכשל ניתן לנסות שוב דרך שלוחת בירור ותשלום';
        }
        return res.send(combine(sayText(msg), hangupNow()));
      }

      case 'done': {
        session.endSession(callId);
        return res.send(combine(sayText('תודה להתראות'), hangupNow()));
      }

      default: {
        session.endSession(callId);
        return res.send(combine(sayText('אירעה שגיאה נא להתקשר שוב'), hangupNow()));
      }
    }
  } catch (err) {
    console.error('IVR register error', err);
    return res.send(combine(sayText('אירעה שגיאה במערכת נא לנסות שוב מאוחר יותר'), hangupNow()));
  }
}

module.exports = { handle };
