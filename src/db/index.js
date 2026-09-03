const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'app.sqlite');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON;');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// מיגרציות קלות עבור בסיסי נתונים שכבר נוצרו לפני הוספת עמודות חדשות
function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

if (!columnExists('customers', 'code')) {
  db.exec('ALTER TABLE customers ADD COLUMN code TEXT');
  db.exec("UPDATE customers SET code = CAST(id AS TEXT) WHERE code IS NULL");
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_code ON customers(code)');
}

if (!columnExists('locations', 'sort_order')) {
  db.exec('ALTER TABLE locations ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
  db.exec('UPDATE locations SET sort_order = id WHERE sort_order = 0');
}

if (!columnExists('admin_users', 'role')) {
  db.exec("ALTER TABLE admin_users ADD COLUMN role TEXT NOT NULL DEFAULT 'manager'");
}

if (!columnExists('payment_charges', 'credit_applied')) {
  db.exec('ALTER TABLE payment_charges ADD COLUMN credit_applied REAL NOT NULL DEFAULT 0');
}

if (!columnExists('payment_charges', 'raw_response')) {
  db.exec('ALTER TABLE payment_charges ADD COLUMN raw_response TEXT');
}

if (!columnExists('customers', 'card_last4')) {
  db.exec('ALTER TABLE customers ADD COLUMN card_last4 TEXT');
}

if (!columnExists('customers', 'blocked')) {
  db.exec('ALTER TABLE customers ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0');
}

if (!columnExists('messages', 'handled')) {
  db.exec('ALTER TABLE messages ADD COLUMN handled INTEGER NOT NULL DEFAULT 0');
}

if (!columnExists('messages', 'reply_text')) {
  db.exec('ALTER TABLE messages ADD COLUMN reply_text TEXT');
  db.exec('ALTER TABLE messages ADD COLUMN reply_heard INTEGER NOT NULL DEFAULT 0');
}

if (!columnExists('messages', 'thread_id')) {
  db.exec('ALTER TABLE messages ADD COLUMN thread_id INTEGER');
  db.exec('UPDATE messages SET thread_id = id WHERE thread_id IS NULL');
}

if (!columnExists('locations', 'unit_type')) {
  db.exec("ALTER TABLE locations ADD COLUMN unit_type TEXT NOT NULL DEFAULT 'bed'");
}

if (!columnExists('reservations', 'notes')) {
  db.exec('ALTER TABLE reservations ADD COLUMN notes TEXT');
}

module.exports = db;
