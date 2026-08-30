const db = require('../db');

function getBalance(customerId) {
  const row = db.prepare('SELECT COALESCE(SUM(amount), 0) AS balance FROM credit_ledger WHERE customer_id = ?').get(customerId);
  return row.balance;
}

function addCredit(customerId, amount, reason, { reservationId = null, paymentChargeId = null } = {}) {
  if (!amount || amount <= 0) return;
  db.prepare(
    'INSERT INTO credit_ledger (customer_id, amount, reason, reservation_id, payment_charge_id) VALUES (?, ?, ?, ?, ?)'
  ).run(customerId, amount, reason, reservationId, paymentChargeId);
}

function useCredit(customerId, amount, reason, { paymentChargeId = null } = {}) {
  if (!amount || amount <= 0) return;
  const balance = getBalance(customerId);
  const used = Math.min(amount, balance);
  if (used <= 0) return 0;
  db.prepare(
    'INSERT INTO credit_ledger (customer_id, amount, reason, payment_charge_id) VALUES (?, ?, ?, ?)'
  ).run(customerId, -used, reason, paymentChargeId);
  return used;
}

function history(customerId) {
  return db.prepare('SELECT * FROM credit_ledger WHERE customer_id = ? ORDER BY created_at DESC').all(customerId);
}

module.exports = { getBalance, addCredit, useCredit, history };
