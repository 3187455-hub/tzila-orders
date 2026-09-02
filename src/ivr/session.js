const db = require('../db');
const callLog = require('./callLog');

function getSession(callId) {
  const row = db.prepare('SELECT * FROM call_sessions WHERE call_id = ?').get(callId);
  if (!row) return null;
  return { ...row, data: JSON.parse(row.data_json) };
}

function createSession(callId, customerId = null, meta = {}) {
  // שומרים את סוג השלוחה (ivrType) בתוך ה-data עצמו - נדרש כדי לזהות
  // מצב שבו ימות המשיח החזיר את אותו ApiCallId עבור שיחה לשלוחה אחרת
  // (נצפה בפועל: אחרי hangup=yes לשלוחה אחת, הבקשה הבאה לשלוחה שונה
  // הגיעה עם אותו ApiCallId, וקלטה בטעות את מצב הסשן הישן).
  const initialData = meta.ivrType ? { ivrType: meta.ivrType } : {};
  db.prepare(
    'INSERT OR REPLACE INTO call_sessions (call_id, customer_id, step, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, datetime(\'now\'), datetime(\'now\'))'
  ).run(callId, customerId, 'start', JSON.stringify(initialData));
  if (meta.ivrType) callLog.start(callId, meta.ivrType, meta.phone);
  return getSession(callId);
}

// אם יש כבר סשן לאותו ApiCallId אבל הוא שייך לסוג שלוחה אחר - זו לא
// המשך שיחה תקין אלא ApiCallId שנוצל מחדש עבור שיחה חדשה לשלוחה שונה.
// מנקים את הישן ומתחילים סשן נקי לשלוחה הנוכחית במקום להמשיך ממנו.
function getOrCreateSession(callId, ivrType, phone) {
  const existing = getSession(callId);
  if (existing && existing.data.ivrType && existing.data.ivrType !== ivrType) {
    endSession(callId);
    return createSession(callId, null, { ivrType, phone });
  }
  return existing || createSession(callId, null, { ivrType, phone });
}

function updateSession(callId, { step, data, customerId } = {}) {
  const current = getSession(callId) || createSession(callId);
  const nextStep = step !== undefined ? step : current.step;
  const nextData = data !== undefined ? { ...current.data, ...data } : current.data;
  const nextCustomerId = customerId !== undefined ? customerId : current.customer_id;
  db.prepare(
    'UPDATE call_sessions SET step = ?, data_json = ?, customer_id = ?, updated_at = datetime(\'now\') WHERE call_id = ?'
  ).run(nextStep, JSON.stringify(nextData), nextCustomerId, callId);
  return getSession(callId);
}

function endSession(callId) {
  const existing = getSession(callId);
  callLog.finish(callId, existing ? existing.step : null, existing ? existing.customer_id : null);
  db.prepare('DELETE FROM call_sessions WHERE call_id = ?').run(callId);
}

module.exports = { getSession, createSession, updateSession, endSession, getOrCreateSession };
