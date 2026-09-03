const session = require('./session');
const customers = require('./customers');
const inventory = require('./inventory');
const nedarim = require('../billing/nedarim');
const credit = require('../billing/credit');
const settings = require('../settings');
const messageNotice = require('./messageNotice');
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
  const lines = [...parts, 'כדי לשמור את המקומות שבחרת ולעבור לתשלום הקש 9'];
  return readDigits(lines, 'HOLIDAY_NUM', { max: 1 });
}

// כמו holidayMenuDirective, אבל גם מודיע על יתרת זכות אם יש - נועד
// לשימוש רק בפעם הראשונה בשיחה, כדי לא לחזור על ההודעה בכל פעם
function firstHolidayMenuDirective(sess) {
  const balance = credit.getBalance(sess.customer_id);
  const prefix = balance > 0 ? sayText(`שים לב יש לך יתרת זכות בסך ${balance} שקלים תוכל להחליט על השימוש בה בזמן התשלום`) : null;
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
  // ניסיון קודם (שינוי ניסוח בלבד) לא פתר עיוות קול שדווח - מסתמן
  // שזה קורה דווקא במשפטים קצרים ("בחירה לא תקינה" קצר גם נשמע מעוות,
  // בעוד שהשורות הארוכות יותר לכל מקום נשמעות תקין). הפתרון הנוכחי:
  // להאריך את המשפטים הקצרים במקום רק לשנות ניסוח.
  const parts = locations.map((l, i) => `במקום ${l.location_name} יש ${l.available_beds} מיטות פנויות, לבחירה הקש ${i + 1}`);
  const lines = [`ברוך השם יש כרגע במערכת סך הכל ${total} מיטות פנויות לבחירה בין כל המקומות`, ...parts];
  return { directive: readDigits(lines, 'LOC_NUM', { max: 1 }), empty: false };
}

function trimItem(r) {
  return {
    id: r.id,
    bed_count: r.bed_count,
    location_name: r.location_name,
    holiday_name: r.holiday_name,
    price_per_bed_snapshot: r.price_per_bed_snapshot,
  };
}

function sumItems(items) {
  return items.reduce((sum, r) => sum + r.bed_count * r.price_per_bed_snapshot, 0);
}

// שלב תחילת התשלום - קודם בודקים אם יש ללקוח גם חוב קודם (מהזמנות
// שלא שולמו משיחה קודמת) בנוסף למה שהזמין עכשיו, ואם כן שואלים אותו
// אם לשלם הכל או רק את מה שהזמין עכשיו. אחר כך ממשיכים לבדיקת זכות.
function beginCheckout(sess) {
  const allPending = inventory.pendingReservationsForCustomer(sess.customer_id);
  if (allPending.length === 0) {
    session.updateSession(sess.call_id, { step: 'done' });
    return combine(sayText('לא נבחרו מיטות תודה ולהתראות'), hangupNow());
  }
  const newIds = new Set(sess.data.newReservationIds || []);
  const newItems = allPending.filter((r) => newIds.has(r.id)).map(trimItem);
  const oldItems = allPending.filter((r) => !newIds.has(r.id)).map(trimItem);

  if (oldItems.length > 0 && newItems.length > 0) {
    const newTotal = sumItems(newItems);
    const oldTotal = sumItems(oldItems);
    session.updateSession(sess.call_id, {
      step: 'choose_pay_scope',
      data: { checkoutNewItems: newItems, checkoutOldItems: oldItems },
    });
    return readDigits(
      [
        `יש לך גם הזמנות קודמות שטרם שולמו בסך ${oldTotal} שקלים, בנוסף למה שהזמנת עכשיו בסך ${newTotal} שקלים`,
        'לתשלום הכל כולל החוב הקודם הקש 1',
        'לתשלום רק מה שהזמנת עכשיו והשארת החוב הקודם לפעם הבאה הקש 2',
      ],
      'PAY_SCOPE',
      { max: 1 }
    );
  }

  return proceedToCredit(sess, [...newItems, ...oldItems]);
}

// שלב שני - אם יש ללקוח יתרת זכות, שואלים אם לקזז אותה עכשיו או
// להשאיר אותה לפעם הבאה ולחייב הכל באשראי.
function proceedToCredit(sess, chosenItems) {
  const chosenTotal = sumItems(chosenItems);
  const balance = credit.getBalance(sess.customer_id);

  if (balance > 0) {
    session.updateSession(sess.call_id, {
      step: 'choose_credit',
      data: { checkoutItems: chosenItems, checkoutTotal: chosenTotal },
    });
    return readDigits(
      [
        `יש לך יתרת זכות בסך ${balance} שקלים`,
        'לקיזוז מהסכום עכשיו הקש 1',
        `להשאיר את הזכות לפעם הבאה ולשלם ${chosenTotal} שקלים באשראי הקש 2`,
      ],
      'CREDIT_CHOICE',
      { max: 1 }
    );
  }

  return finalConfirm(sess, chosenItems, 0);
}

function finalConfirm(sess, chosenItems, creditToApply) {
  const chosenTotal = sumItems(chosenItems);
  const amountToCharge = chosenTotal - creditToApply;
  session.updateSession(sess.call_id, {
    step: 'confirm_summary',
    data: {
      checkoutIds: chosenItems.map((r) => r.id),
      totalAmount: amountToCharge,
      originalTotal: chosenTotal,
      creditToApply,
    },
  });
  // מתחילים במילה ולא בספרה - סגמן שמתחיל בספרה נשמע מעוות (מאומת בבדיקה חיה)
  const lines = chosenItems.map((r) => `במקום ${r.location_name} לחג ${r.holiday_name} הזמנת ${r.bed_count} מיטות`);
  const summaryLines = ['סיכום ההזמנה', ...lines, `סך הכל ${chosenTotal} שקלים`];
  if (creditToApply > 0) {
    summaryLines.push(`מתוך זה ${creditToApply} שקלים יקוזזו מיתרת הזכות שלך`);
    summaryLines.push(amountToCharge > 0 ? `ויחויבו ${amountToCharge} שקלים באשראי` : 'לא יידרש חיוב באשראי כלל');
  }
  summaryLines.push('לאישור הקש 1 לביטול הקש 2');

  return readDigits(summaryLines, 'CONFIRM_YN', { max: 1 });
}

async function handle(req, res) {
  const params = req.query;
  const p = (name) => last(params, name);
  const callId = params.ApiCallId;
  const phone = params.ApiPhone;
  let sess = session.getOrCreateSession(callId, 'register', phone);

  try {
    switch (sess.step) {
      case 'start': {
        // הודעת פתיחה שניתנת לעריכה מפאנל הניהול - נשמעת פעם אחת
        // ממש בתחילת השיחה, לא כשחוזרים לבחור עוד מקום/חג באותה שיחה
        const welcomeText = settings.get('register_welcome_message', '');
        const welcome = welcomeText ? sayText(welcomeText) : null;
        const notice = messageNotice.pendingNotice(phone);

        const customer = customers.findByPhone(phone);
        if (customer && customer.blocked) {
          session.updateSession(callId, { step: 'done', customerId: customer.id });
          return res.send(combine(notice, welcome, sayText('לא ניתן לבצע הרשמה בשלב זה, אנא פנה למזכירות'), hangupNow()));
        }
        if (customer) {
          const data = startHolidayQueue(customer.id);
          if (data.holidayQueue.length === 0) {
            session.updateSession(callId, { step: 'done', customerId: customer.id });
            return res.send(combine(notice, welcome, sayText('אין כרגע הרשמה פתוחה לאף חג תודה'), hangupNow()));
          }
          session.updateSession(callId, { step: 'holiday_menu', customerId: customer.id, data });
          return res.send(combine(notice, welcome, firstHolidayMenuDirective(session.getSession(callId))));
        }
        session.updateSession(callId, { step: 'record_name' });
        return res.send(
          combine(
            notice,
            welcome,
            recordMessage(
              ['לא זיהינו את מספרך', 'אנא הקלט את שמך המלא ולאחריו הקש סולמית'],
              'NAME_REC'
            )
          )
        );
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
          return res.send(beginCheckout(sess));
        }
        const idx = parseInt(p('HOLIDAY_NUM'), 10) - 1;
        const seasonId = sess.data.holidayQueue[idx];
        if (!seasonId) {
          return res.send(combine(sayText('המספר שהקשת אינו תואם אף אחת מהאפשרויות'), holidayMenuDirective(sess)));
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
        // אבחון זמני - חקירת דיווח על אי-התאמה בין יתרת המקומות שהוקראה
        // לבין הכמות שאושרה לבחירה בפועל (קאראוואן חיצוני, יום כיפור)
        console.log(
          'DIAG choose_location',
          JSON.stringify({ seasonId, LOC_NUM: p('LOC_NUM'), idx, currentLocations: sess.data.currentLocations, locationId, capacity, allForSeason: inventory.locationsForSeason(seasonId) })
        );
        if (!capacity || capacity.available_beds <= 0) {
          const { directive, empty } = locationListDirective(seasonId, sess);
          if (empty) return res.send(combine(sayText('אין כרגע מקומות פנויים לחג זה'), holidayMenuDirective(sess)));
          return res.send(combine(sayText('המספר שהקשת אינו תואם אף אחד מהמקומות ברשימה'), directive));
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
        console.log(
          'DIAG ask_bed_count',
          JSON.stringify({ seasonId, locationId, BED_COUNT: p('BED_COUNT'), bedCount, capacity })
        );
        if (!bedCount || bedCount <= 0 || bedCount > capacity.available_beds) {
          return res.send(combine(sayText('הכמות שהקשת אינה במסגרת התקינה'), askBedCountDirective(capacity.available_beds)));
        }
        session.updateSession(callId, { step: 'confirm_count', data: { pendingBedCount: bedCount } });
        return res.send(readDigits(`בחרת ${bedCount} מיטות לאישור הקש 1 לתיקון הקש 2`, 'CONFIRM_COUNT', { max: 1 }));
      }

      case 'confirm_count': {
        const seasonId = sess.data.currentSeasonId;
        const locationId = sess.data.currentLocationId;
        const capacity = inventory.getCapacity(seasonId, locationId);
        if (p('CONFIRM_COUNT') === '1') {
          console.log(
            'DIAG confirm_count upsert',
            JSON.stringify({ customerId: sess.customer_id, seasonId, locationId, bedCount: sess.data.pendingBedCount })
          );
          const reservation = inventory.upsertReservation({
            customerId: sess.customer_id,
            holidaySeasonId: seasonId,
            locationId,
            bedCount: sess.data.pendingBedCount,
            pricePerBed: capacity.price_per_bed,
          });
          console.log('DIAG confirm_count result', JSON.stringify(reservation));
          const newIds = new Set(sess.data.newReservationIds || []);
          if (reservation) newIds.add(reservation.id);
          session.updateSession(callId, { step: 'after_location', data: { newReservationIds: [...newIds] } });
          // ניסוח שונה בכוונה (לא רק תיקון) - חשד להקלטת TTS שנתקעה
          // פגומה על הניסוח הקודם, מדווח כאותה תקלת עיוות קול שכבר
          // תוקנה במקומות אחרים בעזרת שינוי טקסט
          return res.send(
            readDigits(
              [
                'להוספת מקום נוסף באותו חג הקש 1',
                'למעבר לחג אחר או לסיום ההזמנה הקש 2',
              ],
              'AFTER_LOC',
              { max: 1 }
            )
          );
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

      case 'choose_pay_scope': {
        const { checkoutNewItems, checkoutOldItems } = sess.data;
        const chosenItems = p('PAY_SCOPE') === '2' ? checkoutNewItems : [...checkoutNewItems, ...checkoutOldItems];
        return res.send(proceedToCredit(sess, chosenItems));
      }

      case 'choose_credit': {
        const { checkoutItems, checkoutTotal } = sess.data;
        const balance = credit.getBalance(sess.customer_id);
        const creditToApply = p('CREDIT_CHOICE') === '1' ? Math.min(balance, checkoutTotal) : 0;
        return res.send(finalConfirm(sess, checkoutItems, creditToApply));
      }

      case 'confirm_summary': {
        if (p('CONFIRM_YN') === '1') {
          const { totalAmount, creditToApply, checkoutIds } = sess.data;
          if (totalAmount <= 0) {
            finalizeReservationCharge({
              customerId: sess.customer_id,
              callId,
              amountCharged: 0,
              creditApplied: creditToApply,
              success: true,
              method: 'credit_only',
              reservationIds: checkoutIds,
            });
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
        const { totalAmount, creditToApply, checkoutIds } = sess.data;
        finalizeReservationCharge({
          customerId: sess.customer_id,
          callId,
          amountCharged: totalAmount,
          creditApplied: creditToApply,
          success,
          confirmation: p('CreditCard_CODE'),
          method: 'phone',
          rawParams: params,
          reservationIds: checkoutIds,
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
        return res.send(combine(sayText('תודה רבה לך, להתראות'), hangupNow()));
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
