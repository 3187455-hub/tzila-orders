const bcrypt = require('bcryptjs');
const db = require('./index');
const config = require('../config');

const defaultHolidays = [
  'ראש השנה',
  'יום כיפור',
  'שמחת תורה',
  'חנוכה',
  'שביעי של פסח',
  'שבועות',
];

function seedHolidays() {
  const insert = db.prepare('INSERT OR IGNORE INTO holidays (name, sort_order) VALUES (?, ?)');
  defaultHolidays.forEach((name, i) => insert.run(name, i));
}

function seedAdmin() {
  const existing = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(config.admin.username);
  if (existing || !config.admin.password) return;
  const hash = bcrypt.hashSync(config.admin.password, 10);
  db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run(config.admin.username, hash);
}

// מריץ אוטומטית גם בכל עליית שרת (idempotent - לא יוצר כפילויות),
// כדי שלא יהיה צורך בהרצה ידנית של seed בכל פריסה חדשה
function ensureSeeded() {
  seedHolidays();
  seedAdmin();
}

if (require.main === module) {
  ensureSeeded();
  console.log('הושלם: חגי ברירת מחדל ומשתמש ניהול (אם היה צורך).');
}

module.exports = { ensureSeeded };
