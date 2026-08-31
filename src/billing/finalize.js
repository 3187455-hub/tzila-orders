// לוגיקה משותפת לסיום חיוב על הזמנת מיטות (שלוחה 1 ושלוחה 2): רישום
// החיוב, קיזוז זכות בפועל (רק בהצלחה), וסימון ההזמנות כשולמו.
const db = require('../db');
const customers = require('../ivr/customers');
const inventory = require('../ivr/inventory');
const credit = require('./credit');
const nedarim = require('./nedarim');

function finalizeReservationCharge({ customerId, callId, amountCharged, creditApplied, success, confirmation, method, rawParams }) {
  const customer = customers.getById(customerId);
  const { raw, last4 } = nedarim.extractCreditCardInfo(rawParams);
  const chargeResult = db
    .prepare(
      `INSERT INTO payment_charges (customer_id, call_id, total_amount, credit_applied, status, method, nedarim_confirmation, raw_response)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      customer.id, callId, amountCharged, success ? creditApplied : 0, success ? 'success' : 'failed', method,
      confirmation || null,
      Object.keys(raw).length ? JSON.stringify(raw) : null
    );

  if (success) {
    if (last4) db.prepare('UPDATE customers SET card_last4 = ? WHERE id = ?').run(last4, customer.id);
    if (creditApplied > 0) {
      credit.useCredit(customer.id, creditApplied, 'קיזוז בהזמנת מיטות', { paymentChargeId: chargeResult.lastInsertRowid });
    }
    const pending = inventory.pendingReservationsForCustomer(customer.id);
    inventory.markReservationsPaid(pending.map((r) => r.id), chargeResult.lastInsertRowid);
    nedarim.syncTokenAcrossPhones(customers.allPhoneNumbers(customer)).catch((e) => console.error('token sync failed', e));
  }
  return chargeResult;
}

// מקזז יתרת זכות זמינה כנגד הזמנות ממתינות לתשלום של הלקוח (בשלמות
// בלבד - הזמנה מסומנת כשולמה רק אם הזכות מכסה אותה במלואה), ומסמן
// כשולם-ע"י-קיזוז את מה שהתכסה. מיועד לשימוש מהפאנל (למשל אחרי הוספת
// הזמנה ידנית) - בשלוחות הטלפון הקיזוז מתבצע כבר בזמן אמת בתהליך התשלום.
function applyAvailableCreditToPending(customerId) {
  const balance = credit.getBalance(customerId);
  if (balance <= 0) return null;

  const pending = inventory.pendingReservationsForCustomer(customerId);
  let remaining = balance;
  const toMark = [];
  for (const r of pending) {
    const cost = r.bed_count * r.price_per_bed_snapshot;
    if (cost <= remaining) {
      toMark.push(r);
      remaining -= cost;
    }
  }
  if (toMark.length === 0) return null;

  const applied = balance - remaining;
  const chargeResult = db
    .prepare(
      `INSERT INTO payment_charges (customer_id, total_amount, credit_applied, status, method) VALUES (?, 0, ?, 'success', 'credit_only')`
    )
    .run(customerId, applied);
  credit.useCredit(customerId, applied, 'קיזוז אוטומטי מיתרת זכות', { paymentChargeId: chargeResult.lastInsertRowid });
  inventory.markReservationsPaid(toMark.map((r) => r.id), chargeResult.lastInsertRowid);
  return { applied, count: toMark.length };
}

module.exports = { finalizeReservationCharge, applyAvailableCreditToPending };
