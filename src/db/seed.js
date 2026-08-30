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
  console.log('חגי ברירת מחדל נוספו (אם לא היו קיימים).');
}

function seedAdmin() {
  const existing = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(config.admin.username);
  if (existing) {
    console.log(`משתמש הניהול "${config.admin.username}" כבר קיים.`);
    return;
  }
  if (!config.admin.password) {
    console.log('שים לב: לא הוגדרה ADMIN_PASSWORD בקובץ .env - לא נוצר משתמש ניהול.');
    return;
  }
  const hash = bcrypt.hashSync(config.admin.password, 10);
  db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run(config.admin.username, hash);
  console.log(`משתמש ניהול "${config.admin.username}" נוצר בהצלחה.`);
}

seedHolidays();
seedAdmin();
