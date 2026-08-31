const db = require('../db');

// כל מחזורי החגים הפתוחים כרגע (is_open וגם בתוך חלון הזמן אם הוגדר)
function openHolidaySeasons() {
  return db
    .prepare(
      `SELECT hs.*, h.name AS holiday_name
       FROM holiday_seasons hs
       JOIN holidays h ON h.id = hs.holiday_id
       WHERE hs.is_open = 1
         AND (hs.opens_at IS NULL OR hs.opens_at <= datetime('now'))
         AND (hs.closes_at IS NULL OR hs.closes_at >= datetime('now'))
       ORDER BY h.sort_order`
    )
    .all();
}

// מקומות רלוונטיים לחג נתון + מלאי פנוי בזמן אמת
function locationsForSeason(holidaySeasonId) {
  return db
    .prepare(
      `SELECT lc.id AS capacity_id, lc.location_id, l.name AS location_name,
              lc.total_beds, lc.price_per_bed,
              lc.total_beds - COALESCE((
                SELECT SUM(r.bed_count) FROM reservations r
                WHERE r.location_id = lc.location_id
                  AND r.holiday_season_id = lc.holiday_season_id
                  AND r.status != 'cancelled'
              ), 0) AS available_beds
       FROM location_capacities lc
       JOIN locations l ON l.id = lc.location_id
       WHERE lc.holiday_season_id = ?
       ORDER BY l.sort_order, l.name`
    )
    .all(holidaySeasonId);
}

function getCapacity(holidaySeasonId, locationId) {
  return locationsForSeason(holidaySeasonId).find((c) => c.location_id === locationId);
}

// יצירה/עדכון של שורת הזמנה עבור לקוח+חג+מקום (ה"החזקה" של המקום)
function upsertReservation({ customerId, holidaySeasonId, locationId, bedCount, pricePerBed }) {
  const existing = db
    .prepare(
      `SELECT * FROM reservations
       WHERE customer_id = ? AND holiday_season_id = ? AND location_id = ? AND status = 'pending_payment'`
    )
    .get(customerId, holidaySeasonId, locationId);

  if (existing) {
    if (bedCount <= 0) {
      db.prepare('DELETE FROM reservations WHERE id = ?').run(existing.id);
      return null;
    }
    db.prepare(
      `UPDATE reservations SET bed_count = ?, price_per_bed_snapshot = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(bedCount, pricePerBed, existing.id);
    return db.prepare('SELECT * FROM reservations WHERE id = ?').get(existing.id);
  }

  if (bedCount <= 0) return null;

  const result = db
    .prepare(
      `INSERT INTO reservations (customer_id, holiday_season_id, location_id, bed_count, price_per_bed_snapshot, status)
       VALUES (?, ?, ?, ?, ?, 'pending_payment')`
    )
    .run(customerId, holidaySeasonId, locationId, bedCount, pricePerBed);
  return db.prepare('SELECT * FROM reservations WHERE id = ?').get(result.lastInsertRowid);
}

function pendingReservationsForCustomer(customerId) {
  return db
    .prepare(
      `SELECT r.*, l.name AS location_name, h.name AS holiday_name, hs.year_label
       FROM reservations r
       JOIN locations l ON l.id = r.location_id
       JOIN holiday_seasons hs ON hs.id = r.holiday_season_id
       JOIN holidays h ON h.id = hs.holiday_id
       WHERE r.customer_id = ? AND r.status = 'pending_payment'
       ORDER BY h.sort_order`
    )
    .all(customerId);
}

function allReservationsForCustomer(customerId) {
  return db
    .prepare(
      `SELECT r.*, l.name AS location_name, h.name AS holiday_name, h.sort_order AS holiday_sort_order,
              hs.year_label, pc.method AS payment_method
       FROM reservations r
       JOIN locations l ON l.id = r.location_id
       JOIN holiday_seasons hs ON hs.id = r.holiday_season_id
       JOIN holidays h ON h.id = hs.holiday_id
       LEFT JOIN payment_charges pc ON pc.id = r.payment_charge_id
       WHERE r.customer_id = ? AND r.status != 'cancelled'
       ORDER BY h.sort_order, l.sort_order`
    )
    .all(customerId);
}

function markReservationsPaid(reservationIds, paymentChargeId) {
  const stmt = db.prepare(
    `UPDATE reservations SET status = 'paid', payment_charge_id = ?, updated_at = datetime('now') WHERE id = ?`
  );
  for (const id of reservationIds) stmt.run(paymentChargeId, id);
}

function cancelReservation(reservationId) {
  db.prepare(`UPDATE reservations SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`).run(
    reservationId
  );
}

module.exports = {
  openHolidaySeasons,
  locationsForSeason,
  getCapacity,
  upsertReservation,
  pendingReservationsForCustomer,
  allReservationsForCustomer,
  markReservationsPaid,
  cancelReservation,
};
