const db = require('../db');

function findByPhone(phone) {
  return db
    .prepare(
      `SELECT * FROM customers
       WHERE phone = ? OR husband_mobile = ? OR wife_mobile = ? OR extra_mobile = ?`
    )
    .get(phone, phone, phone, phone);
}

function createMinimal({ phone, nameRecordingPath }) {
  const result = db
    .prepare(
      `INSERT INTO customers (phone, name_recording_path, needs_details) VALUES (?, ?, 1)`
    )
    .run(phone, nameRecordingPath || null);
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(result.lastInsertRowid);
}

function getById(id) {
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
}

// כל מספרי הטלפון הידועים של הלקוח (לסנכרון טוקן האשראי ביניהם)
function allPhoneNumbers(customer) {
  return [customer.phone, customer.husband_mobile, customer.wife_mobile, customer.extra_mobile].filter(Boolean);
}

module.exports = { findByPhone, createMinimal, getById, allPhoneNumbers };
