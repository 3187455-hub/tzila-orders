const db = require('../db');

function start(callId, ivrType, phone) {
  const existing = db.prepare('SELECT id FROM call_logs WHERE call_id = ?').get(callId);
  if (existing) return;
  db.prepare('INSERT INTO call_logs (call_id, ivr_type, phone) VALUES (?, ?, ?)').run(callId, ivrType, phone);
}

function finish(callId, finalStep, customerId) {
  db.prepare(
    `UPDATE call_logs SET ended_at = COALESCE(ended_at, datetime('now')), final_step = ?, customer_id = COALESCE(?, customer_id) WHERE call_id = ?`
  ).run(finalStep, customerId || null, callId);
}

function historyForCustomer(customerId) {
  return db
    .prepare('SELECT * FROM call_logs WHERE customer_id = ? ORDER BY started_at DESC')
    .all(customerId);
}

module.exports = { start, finish, historyForCustomer };
