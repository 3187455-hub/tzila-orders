const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { parse: parseCsv } = require('csv-parse/sync');
const db = require('../db');
const { requireLogin, verifyLogin } = require('./auth');
const yemotFiles = require('../billing/yemotFiles');
const inventory = require('../ivr/inventory');
const callLog = require('../ivr/callLog');
const credit = require('../billing/credit');
const { applyAvailableCreditToPending } = require('../billing/finalize');

const router = express.Router();

function requireManager(req, res, next) {
  if (res.locals.currentRole !== 'manager') {
    return res.status(403).send('פעולה זו זמינה למנהלים בלבד');
  }
  next();
}

function toDatetimeLocal(v) {
  if (!v) return '';
  return v.replace(' ', 'T').slice(0, 16);
}
function fromDatetimeLocal(v) {
  if (!v) return null;
  return v.replace('T', ' ') + ':00';
}
function orNull(v) {
  return v === undefined || v === '' ? null : v;
}

router.get('/login', (req, res) => {
  res.render('login', { error: null });
});

router.post('/login', express.urlencoded({ extended: true }), (req, res) => {
  const user = verifyLogin(req.body.username, req.body.password);
  if (!user) return res.render('login', { error: 'שם משתמש או סיסמה שגויים' });
  req.session.adminId = user.id;
  res.redirect('/admin/reservations');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

router.use(requireLogin);
router.use(express.urlencoded({ extended: true }));

router.use((req, res, next) => {
  const user = db.prepare('SELECT id, username, role FROM admin_users WHERE id = ?').get(req.session.adminId);
  res.locals.currentUsername = user ? user.username : '';
  res.locals.currentAdminId = user ? user.id : null;
  res.locals.currentRole = user ? user.role : 'user';
  next();
});

router.get('/', (req, res) => res.redirect('/admin/reservations'));

// ---------- משתמשי ניהול (למנהלים בלבד) ----------
router.get('/users', requireManager, (req, res) => {
  const users = db.prepare('SELECT id, username, role FROM admin_users ORDER BY id').all();
  res.render('users', { users, flash: req.query.flash });
});

router.post('/users', requireManager, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) {
    return res.redirect('/admin/users?flash=' + encodeURIComponent('יש למלא שם משתמש וסיסמה'));
  }
  try {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO admin_users (username, password_hash, role) VALUES (?, ?, ?)').run(
      username,
      hash,
      role === 'manager' ? 'manager' : 'user'
    );
  } catch (e) {
    return res.redirect('/admin/users?flash=' + encodeURIComponent('שם משתמש זה כבר קיים'));
  }
  res.redirect('/admin/users');
});

router.post('/users/:id/role', requireManager, (req, res) => {
  const role = req.body.role === 'manager' ? 'manager' : 'user';
  if (String(req.params.id) === String(res.locals.currentAdminId) && role !== 'manager') {
    return res.redirect('/admin/users?flash=' + encodeURIComponent('לא ניתן להוריד את עצמך מהרשאת מנהל'));
  }
  db.prepare('UPDATE admin_users SET role = ? WHERE id = ?').run(role, req.params.id);
  res.redirect('/admin/users');
});

router.post('/users/:id/delete', requireManager, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS n FROM admin_users').get().n;
  if (total <= 1) {
    return res.redirect('/admin/users?flash=' + encodeURIComponent('לא ניתן למחוק את משתמש הניהול היחיד'));
  }
  if (String(req.params.id) === String(res.locals.currentAdminId)) {
    return res.redirect('/admin/users?flash=' + encodeURIComponent('לא ניתן למחוק את המשתמש שאיתו אתה מחובר כרגע'));
  }
  db.prepare('DELETE FROM admin_users WHERE id = ?').run(req.params.id);
  res.redirect('/admin/users');
});

// ---------- מקומות ----------
router.get('/locations', (req, res) => {
  const locations = db.prepare('SELECT * FROM locations ORDER BY sort_order, name').all();
  res.render('locations', { locations, flash: req.query.flash });
});

router.post('/locations', (req, res) => {
  const name = (req.body.name || '').trim();
  if (name) {
    const maxOrder = db.prepare('SELECT MAX(sort_order) AS m FROM locations').get().m || 0;
    try {
      db.prepare('INSERT INTO locations (name, sort_order) VALUES (?, ?)').run(name, maxOrder + 1);
    } catch (e) {
      return res.redirect('/admin/locations?flash=' + encodeURIComponent('שם זה כבר קיים'));
    }
  }
  res.redirect('/admin/locations');
});

router.post('/locations/:id/rename', (req, res) => {
  db.prepare('UPDATE locations SET name = ?, sort_order = ? WHERE id = ?').run(
    req.body.name,
    parseInt(req.body.sort_order, 10) || 0,
    req.params.id
  );
  res.redirect('/admin/locations');
});

router.post('/locations/:id/delete', (req, res) => {
  try {
    db.prepare('DELETE FROM locations WHERE id = ?').run(req.params.id);
  } catch (e) {
    return res.redirect('/admin/locations?flash=' + encodeURIComponent('לא ניתן למחוק מקום שיש לו הזמנות/מלאי משויך'));
  }
  res.redirect('/admin/locations');
});

// ---------- חגים ומחזורים ----------
router.get('/holidays', (req, res) => {
  const holidays = db.prepare('SELECT * FROM holidays ORDER BY sort_order').all();
  const seasonsStmt = db.prepare('SELECT * FROM holiday_seasons WHERE holiday_id = ? ORDER BY id DESC');
  holidays.forEach((h) => {
    h.seasons = seasonsStmt.all(h.id);
  });
  res.render('holidays', { holidays, flash: req.query.flash });
});

router.post('/holidays', (req, res) => {
  const name = (req.body.name || '').trim();
  if (name) {
    const maxOrder = db.prepare('SELECT MAX(sort_order) AS m FROM holidays').get().m || 0;
    try {
      db.prepare('INSERT INTO holidays (name, sort_order) VALUES (?, ?)').run(name, maxOrder + 1);
    } catch (e) {
      return res.redirect('/admin/holidays?flash=' + encodeURIComponent('חג בשם זה כבר קיים'));
    }
  }
  res.redirect('/admin/holidays');
});

router.post('/holidays/:id/delete', (req, res) => {
  try {
    db.prepare('DELETE FROM holidays WHERE id = ?').run(req.params.id);
  } catch (e) {
    return res.redirect('/admin/holidays?flash=' + encodeURIComponent('לא ניתן למחוק חג שיש לו מחזורים'));
  }
  res.redirect('/admin/holidays');
});

router.post('/holidays/:id/seasons', (req, res) => {
  db.prepare('INSERT INTO holiday_seasons (holiday_id, year_label, is_open) VALUES (?, ?, 0)').run(
    req.params.id,
    req.body.year_label
  );
  res.redirect('/admin/holidays');
});

router.post('/seasons/:id/toggle', (req, res) => {
  const season = db.prepare('SELECT * FROM holiday_seasons WHERE id = ?').get(req.params.id);
  db.prepare('UPDATE holiday_seasons SET is_open = ? WHERE id = ?').run(season.is_open ? 0 : 1, req.params.id);
  res.redirect('/admin/holidays');
});

router.post('/seasons/:id/delete', (req, res) => {
  const count = db
    .prepare(`SELECT COUNT(*) AS n FROM reservations WHERE holiday_season_id = ? AND status != 'cancelled'`)
    .get(req.params.id).n;
  if (count > 0) {
    return res.redirect(
      '/admin/holidays?flash=' + encodeURIComponent('לא ניתן למחוק מחזור שיש בו הזמנות - אפשר רק לסגור אותו')
    );
  }
  // מוחקים גם שורות הזמנה שבוטלו (אין בהן ערך היסטורי - הלקוח חזר בו),
  // כדי שלא יישארו תלויות במחזור שנמחק
  db.prepare(`DELETE FROM reservations WHERE holiday_season_id = ? AND status = 'cancelled'`).run(req.params.id);
  db.prepare('DELETE FROM location_capacities WHERE holiday_season_id = ?').run(req.params.id);
  db.prepare('DELETE FROM holiday_seasons WHERE id = ?').run(req.params.id);
  res.redirect('/admin/holidays');
});

router.get('/seasons/:id/edit', (req, res) => {
  const season = db
    .prepare(
      `SELECT hs.*, h.name AS holiday_name FROM holiday_seasons hs JOIN holidays h ON h.id = hs.holiday_id WHERE hs.id = ?`
    )
    .get(req.params.id);
  const allLocations = db.prepare('SELECT * FROM locations ORDER BY sort_order, name').all();
  const capacities = db.prepare('SELECT * FROM location_capacities WHERE holiday_season_id = ?').all(season.id);
  const capById = Object.fromEntries(capacities.map((c) => [c.location_id, c]));

  const locations = allLocations.map((loc) => {
    const cap = capById[loc.id];
    const reserved = db
      .prepare(
        `SELECT COALESCE(SUM(bed_count),0) AS n FROM reservations WHERE location_id = ? AND holiday_season_id = ? AND status != 'cancelled'`
      )
      .get(loc.id, season.id).n;
    return {
      id: loc.id,
      name: loc.name,
      active: !!cap,
      total_beds: cap ? cap.total_beds : 0,
      price_per_bed: cap ? cap.price_per_bed : 50,
      reserved_beds: reserved,
    };
  });

  res.render('season_edit', {
    season: { ...season, opens_at_local: toDatetimeLocal(season.opens_at), closes_at_local: toDatetimeLocal(season.closes_at) },
    locations,
    flash: req.query.flash,
  });
});

router.post('/seasons/:id', (req, res) => {
  const seasonId = req.params.id;
  db.prepare('UPDATE holiday_seasons SET opens_at = ?, closes_at = ? WHERE id = ?').run(
    fromDatetimeLocal(req.body.opens_at),
    fromDatetimeLocal(req.body.closes_at),
    seasonId
  );

  const allLocations = db.prepare('SELECT id FROM locations').all();
  for (const loc of allLocations) {
    const active = req.body[`loc_${loc.id}_active`] === 'on';
    const total = parseInt(req.body[`loc_${loc.id}_total`], 10) || 0;
    const price = parseFloat(req.body[`loc_${loc.id}_price`]) || 50;
    const existing = db
      .prepare('SELECT * FROM location_capacities WHERE holiday_season_id = ? AND location_id = ?')
      .get(seasonId, loc.id);

    if (active) {
      if (existing) {
        db.prepare('UPDATE location_capacities SET total_beds = ?, price_per_bed = ? WHERE id = ?').run(
          total,
          price,
          existing.id
        );
      } else {
        db.prepare(
          'INSERT INTO location_capacities (holiday_season_id, location_id, total_beds, price_per_bed) VALUES (?, ?, ?, ?)'
        ).run(seasonId, loc.id, total, price);
      }
    } else if (existing) {
      db.prepare('DELETE FROM location_capacities WHERE id = ?').run(existing.id);
    }
  }

  res.redirect(`/admin/seasons/${seasonId}/edit?flash=${encodeURIComponent('נשמר בהצלחה')}`);
});

// ---------- לקוחות ----------
router.get('/customers', (req, res) => {
  let customers;
  if (req.query.needs_details === '1') {
    customers = db.prepare('SELECT * FROM customers WHERE needs_details = 1 ORDER BY id DESC').all();
  } else if (req.query.q) {
    const q = `%${req.query.q}%`;
    customers = db
      .prepare(
        `SELECT * FROM customers WHERE
           code LIKE ? OR first_name LIKE ? OR father_name LIKE ? OR last_name LIKE ?
           OR address LIKE ? OR house_number LIKE ? OR city LIKE ? OR neighborhood LIKE ? OR id_number LIKE ?
           OR phone LIKE ? OR husband_mobile LIKE ? OR wife_mobile LIKE ? OR extra_mobile LIKE ?
         ORDER BY id DESC`
      )
      .all(q, q, q, q, q, q, q, q, q, q, q, q, q);
  } else {
    customers = db.prepare('SELECT * FROM customers ORDER BY id DESC LIMIT 200').all();
  }
  res.render('customers', { customers, q: req.query.q, flash: req.query.flash });
});

router.get('/customers/new', (req, res) => {
  res.render('customer_form', { customer: {}, flash: req.query.flash });
});

// ---------- ייבוא לקוחות מקובץ CSV/אקסל ----------
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const CUSTOMER_CSV_COLUMNS = [
  ['קוד', 'code'],
  ['שם', 'first_name'],
  ['בן', 'father_name'],
  ['משפחה', 'last_name'],
  ['כתובת', 'address'],
  ['מספר', 'house_number'],
  ['עיר', 'city'],
  ['שכונה', 'neighborhood'],
  ['מ.ז', 'id_number'],
  ['טלפון', 'phone'],
  ['פלפון בעל', 'husband_mobile'],
  ['פלפון אישה', 'wife_mobile'],
  ['פלפון נוסף', 'extra_mobile'],
];

router.get('/customers/import', (req, res) => {
  res.render('customers_import', { flash: req.query.flash, result: null });
});

router.get('/customers/import/template.csv', (req, res) => {
  const headers = CUSTOMER_CSV_COLUMNS.map(([he]) => he);
  const example = ['', 'ישראל', 'אברהם', 'כהן', 'רחוב הרב קוק', '12', 'ירושלים', 'גאולה', '123456789', '0501234567', '0521234567', '0537654321', ''];
  const escape = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = '﻿' + headers.map(escape).join(',') + '\n' + example.map(escape).join(',') + '\n';
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="customers_template.csv"');
  res.send(csv);
});

router.post('/customers/import', csvUpload.single('file'), (req, res) => {
  if (!req.file) {
    return res.render('customers_import', { flash: 'נא לבחור קובץ', result: null });
  }
  let content = req.file.buffer.toString('utf8');
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);

  let records;
  try {
    records = parseCsv(content, { columns: true, skip_empty_lines: true, trim: true });
  } catch (e) {
    return res.render('customers_import', { flash: 'שגיאה בקריאת הקובץ: ' + e.message, result: null });
  }

  const findByCode = db.prepare('SELECT * FROM customers WHERE code = ?');
  const insertStmt = db.prepare(
    `INSERT INTO customers (code, first_name, father_name, last_name, address, house_number, city, neighborhood, id_number, phone, husband_mobile, wife_mobile, extra_mobile)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let created = 0;
  let updated = 0;
  const errors = [];

  records.forEach((row, i) => {
    const data = {};
    for (const [heCol, field] of CUSTOMER_CSV_COLUMNS) {
      const v = (row[heCol] || '').trim();
      if (v) data[field] = v;
    }
    try {
      const existing = data.code ? findByCode.get(data.code) : null;
      if (existing) {
        const fields = Object.keys(data).filter((k) => k !== 'code');
        if (fields.length) {
          const sets = fields.map((f) => `${f} = ?`).join(', ');
          const values = fields.map((f) => data[f]);
          db.prepare(`UPDATE customers SET ${sets} WHERE id = ?`).run(...values, existing.id);
        }
        updated++;
      } else {
        const result = insertStmt.run(
          data.code || null, data.first_name || null, data.father_name || null, data.last_name || null,
          data.address || null, data.house_number || null, data.city || null, data.neighborhood || null,
          data.id_number || null, data.phone || null, data.husband_mobile || null, data.wife_mobile || null,
          data.extra_mobile || null
        );
        if (!data.code) {
          db.prepare('UPDATE customers SET code = ? WHERE id = ?').run(String(result.lastInsertRowid), result.lastInsertRowid);
        }
        created++;
      }
    } catch (e) {
      errors.push(`שורה ${i + 2}: ${e.message}`);
    }
  });

  res.render('customers_import', { flash: null, result: { created, updated, errors } });
});

router.post('/customers', (req, res) => {
  const b = req.body;
  try {
    const result = db
      .prepare(
        `INSERT INTO customers (code, first_name, father_name, last_name, address, house_number, city, neighborhood, id_number, phone, husband_mobile, wife_mobile, extra_mobile)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        orNull(b.code), orNull(b.first_name), orNull(b.father_name), orNull(b.last_name), orNull(b.address), orNull(b.house_number),
        orNull(b.city), orNull(b.neighborhood), orNull(b.id_number), orNull(b.phone), orNull(b.husband_mobile), orNull(b.wife_mobile), orNull(b.extra_mobile)
      );
    const id = result.lastInsertRowid;
    if (!b.code) {
      db.prepare('UPDATE customers SET code = ? WHERE id = ?').run(String(id), id);
    }
    res.redirect(`/admin/customers/${id}`);
  } catch (e) {
    const msg = /UNIQUE/i.test(e.message) ? 'קוד לקוח זה כבר קיים - יש לבחור קוד אחר' : 'שגיאה בשמירה: ' + e.message;
    console.error('customer create error', e);
    res.render('customer_form', { customer: b, flash: msg });
  }
});

router.get('/customers/:id', (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.redirect('/admin/customers');
  const balance = credit.getBalance(customer.id);
  const bookableOptions = db
    .prepare(
      `SELECT lc.id AS capacity_id, lc.price_per_bed, l.name AS location_name, h.name AS holiday_name, hs.year_label,
              lc.total_beds - COALESCE((
                SELECT SUM(r.bed_count) FROM reservations r
                WHERE r.location_id = lc.location_id AND r.holiday_season_id = lc.holiday_season_id AND r.status != 'cancelled'
              ), 0) AS available_beds
       FROM location_capacities lc
       JOIN locations l ON l.id = lc.location_id
       JOIN holiday_seasons hs ON hs.id = lc.holiday_season_id
       JOIN holidays h ON h.id = hs.holiday_id
       ORDER BY hs.id DESC, l.sort_order`
    )
    .all();
  res.render('customer_view', { customer, balance, bookableOptions, flash: req.query.flash });
});

router.get('/customers/:id/edit', (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.redirect('/admin/customers');
  res.render('customer_form', { customer, flash: null });
});

router.post('/customers/:id', (req, res) => {
  const b = req.body;
  try {
    db.prepare(
      `UPDATE customers SET code=?, first_name=?, father_name=?, last_name=?, address=?, house_number=?, city=?, neighborhood=?, id_number=?, phone=?, husband_mobile=?, wife_mobile=?, extra_mobile=?, needs_details=?
       WHERE id = ?`
    ).run(
      orNull(b.code) || String(req.params.id),
      orNull(b.first_name), orNull(b.father_name), orNull(b.last_name), orNull(b.address), orNull(b.house_number),
      orNull(b.city), orNull(b.neighborhood), orNull(b.id_number), orNull(b.phone), orNull(b.husband_mobile), orNull(b.wife_mobile), orNull(b.extra_mobile),
      b.clear_needs_details === 'on' ? 0 : (db.prepare('SELECT needs_details FROM customers WHERE id=?').get(req.params.id) || {}).needs_details || 0,
      req.params.id
    );
  } catch (e) {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    const msg = /UNIQUE/i.test(e.message) ? 'קוד לקוח זה כבר קיים אצל לקוח אחר' : 'שגיאה בשמירה: ' + e.message;
    console.error('customer update error', e);
    return res.render('customer_form', { customer: { ...customer, ...b }, flash: msg });
  }
  res.redirect(`/admin/customers/${req.params.id}`);
});

router.post('/customers/:id/delete', requireManager, (req, res) => {
  try {
    db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id);
  } catch (e) {
    return res.redirect(
      `/admin/customers/${req.params.id}?flash=` +
        encodeURIComponent('לא ניתן למחוק לקוח שיש לו היסטוריה (הזמנות/חיובים/תרומות/יתרת זכות) במערכת')
    );
  }
  res.redirect('/admin/customers');
});

router.post('/customers/:id/toggle-block', requireManager, (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (customer) {
    db.prepare('UPDATE customers SET blocked = ? WHERE id = ?').run(customer.blocked ? 0 : 1, customer.id);
  }
  res.redirect(`/admin/customers/${req.params.id}`);
});

router.get('/customers/:id/history', (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.redirect('/admin/customers');
  const reservations = db
    .prepare(
      `SELECT r.*, l.name AS location_name, h.name AS holiday_name, hs.year_label
       FROM reservations r
       JOIN locations l ON l.id = r.location_id
       JOIN holiday_seasons hs ON hs.id = r.holiday_season_id
       JOIN holidays h ON h.id = hs.holiday_id
       WHERE r.customer_id = ?
       ORDER BY r.created_at DESC`
    )
    .all(customer.id);
  const charges = db
    .prepare('SELECT * FROM payment_charges WHERE customer_id = ? ORDER BY created_at DESC')
    .all(customer.id);
  const donations = db
    .prepare('SELECT * FROM donations WHERE customer_id = ? ORDER BY created_at DESC')
    .all(customer.id);
  const calls = callLog.historyForCustomer(customer.id);
  const creditHistory = credit.history(customer.id);
  res.render('customer_history', { customer, reservations, charges, donations, calls, creditHistory });
});

router.get('/recording/:customerId', async (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.customerId);
  if (!customer || !customer.name_recording_path) return res.status(404).send('אין הקלטה');
  try {
    const buf = await yemotFiles.downloadBinaryFile(customer.name_recording_path);
    res.set('Content-Type', 'audio/wav');
    res.send(buf);
  } catch (e) {
    res.status(502).send('שגיאה בהבאת ההקלטה מימות המשיח: ' + e.message);
  }
});

// ---------- הזמנות ----------
router.get('/reservations', (req, res) => {
  const seasons = db
    .prepare(
      `SELECT hs.*, h.name AS holiday_name FROM holiday_seasons hs JOIN holidays h ON h.id = hs.holiday_id ORDER BY hs.id DESC`
    )
    .all();

  let query = `
    SELECT r.*, c.first_name, c.last_name, c.code AS customer_code, l.name AS location_name, h.name AS holiday_name, hs.year_label
    FROM reservations r
    JOIN customers c ON c.id = r.customer_id
    JOIN locations l ON l.id = r.location_id
    JOIN holiday_seasons hs ON hs.id = r.holiday_season_id
    JOIN holidays h ON h.id = hs.holiday_id
    WHERE r.status != 'cancelled'
  `;
  const args = [];
  if (req.query.season_id) {
    query += ' AND r.holiday_season_id = ?';
    args.push(req.query.season_id);
  }
  query += ' ORDER BY r.created_at DESC';
  const reservations = db.prepare(query).all(...args);

  res.render('reservations', { reservations, seasons, seasonId: req.query.season_id, flash: req.query.flash });
});

router.post('/reservations/:id/mark-paid', (req, res) => {
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
  const charge = db
    .prepare('INSERT INTO payment_charges (customer_id, total_amount, status, method) VALUES (?, ?, ?, ?)')
    .run(reservation.customer_id, reservation.bed_count * reservation.price_per_bed_snapshot, 'success', 'manual_cash');
  db.prepare(`UPDATE reservations SET status = 'paid', payment_charge_id = ? WHERE id = ?`).run(
    charge.lastInsertRowid,
    reservation.id
  );
  res.redirect(req.headers.referer || '/admin/reservations');
});

router.post('/reservations/:id/mark-unpaid', (req, res) => {
  db.prepare(`UPDATE reservations SET status = 'pending_payment', payment_charge_id = NULL WHERE id = ?`).run(
    req.params.id
  );
  res.redirect(req.headers.referer || '/admin/reservations');
});

router.post('/reservations/:id/price', (req, res) => {
  db.prepare('UPDATE reservations SET price_per_bed_snapshot = ? WHERE id = ?').run(
    parseFloat(req.body.price) || 0,
    req.params.id
  );
  res.redirect(req.headers.referer || '/admin/reservations');
});

router.post('/reservations/:id/count', (req, res) => {
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
  const capacity = inventory.getCapacity(reservation.holiday_season_id, reservation.location_id);
  const maxAllowed = (capacity ? capacity.available_beds : 0) + reservation.bed_count;
  const newCount = parseInt(req.body.count, 10);
  if (!newCount || newCount <= 0 || newCount > maxAllowed) {
    return res.redirect(
      (req.headers.referer || '/admin/reservations') + `?flash=${encodeURIComponent('כמות לא תקינה (מקסימום ' + maxAllowed + ')')}`
    );
  }
  db.prepare(`UPDATE reservations SET bed_count = ?, updated_at = datetime('now') WHERE id = ?`).run(
    newCount,
    req.params.id
  );
  res.redirect(req.headers.referer || '/admin/reservations');
});

router.post('/reservations/:id/cancel', (req, res) => {
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
  inventory.cancelReservation(req.params.id);
  if (reservation && reservation.status === 'paid') {
    const refund = reservation.bed_count * reservation.price_per_bed_snapshot;
    credit.addCredit(reservation.customer_id, refund, 'ביטול הזמנה ששולמה (במקום זיכוי כספי)', {
      reservationId: reservation.id,
    });
    applyAvailableCreditToPending(reservation.customer_id);
  }
  res.redirect(req.headers.referer || '/admin/reservations');
});

// ---------- הוספת הזמנה ידנית ללקוח ----------
router.post('/customers/:id/reservations', (req, res) => {
  const customerId = req.params.id;
  const capacityId = parseInt(req.body.capacity_id, 10);
  const bedCount = parseInt(req.body.bed_count, 10);
  const markPaid = req.body.mark_paid === 'on';

  const capacity = db.prepare('SELECT * FROM location_capacities WHERE id = ?').get(capacityId);
  if (!capacity || !bedCount || bedCount <= 0) {
    return res.redirect(`/admin/customers/${customerId}?flash=${encodeURIComponent('נא לבחור חג/מקום וכמות תקינה')}`);
  }
  const available = inventory.getCapacity(capacity.holiday_season_id, capacity.location_id);
  if (bedCount > (available ? available.available_beds : 0)) {
    return res.redirect(
      `/admin/customers/${customerId}?flash=${encodeURIComponent('אין מספיק מקום פנוי (נותרו ' + (available ? available.available_beds : 0) + ')')}`
    );
  }

  const price = parseFloat(req.body.price) || capacity.price_per_bed;
  const reservation = inventory.upsertReservation({
    customerId,
    holidaySeasonId: capacity.holiday_season_id,
    locationId: capacity.location_id,
    bedCount,
    pricePerBed: price,
  });

  if (markPaid && reservation) {
    const charge = db
      .prepare('INSERT INTO payment_charges (customer_id, total_amount, status, method) VALUES (?, ?, ?, ?)')
      .run(customerId, bedCount * price, 'success', 'manual_cash');
    db.prepare(`UPDATE reservations SET status = 'paid', payment_charge_id = ? WHERE id = ?`).run(
      charge.lastInsertRowid,
      reservation.id
    );
  } else {
    // לא סומן כשולם ידנית - ננסה לקזז אוטומטית מיתרת זכות זמינה (אם יש)
    applyAvailableCreditToPending(customerId);
  }

  res.redirect(`/admin/customers/${customerId}`);
});

// ---------- ניהול יתרת זכות (למנהלים בלבד) ----------
router.post('/customers/:id/credit', requireManager, (req, res) => {
  const amount = parseFloat(req.body.amount);
  const reason = (req.body.reason || 'זיכוי ידני').trim();
  if (!amount || amount === 0) {
    return res.redirect(`/admin/customers/${req.params.id}?flash=${encodeURIComponent('נא להזין סכום')}`);
  }
  if (amount > 0) {
    credit.addCredit(req.params.id, amount, reason);
    applyAvailableCreditToPending(req.params.id);
  } else {
    credit.useCredit(req.params.id, Math.abs(amount), reason);
  }
  res.redirect(`/admin/customers/${req.params.id}`);
});

module.exports = router;
