// אחסון הגדרות טקסט כלליות שניתנות לעריכה מפאנל הניהול (למשל הודעת
// פתיחה בטלפון) - כדי שאפשר יהיה לשנות אותן בלי לגעת בקוד.
const db = require('./db');

function get(key, defaultValue = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row && row.value !== null ? row.value : defaultValue;
}

function set(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

module.exports = { get, set };
