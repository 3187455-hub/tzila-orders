CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  first_name TEXT,
  father_name TEXT,
  last_name TEXT,
  address TEXT,
  house_number TEXT,
  city TEXT,
  neighborhood TEXT,
  id_number TEXT,
  phone TEXT,
  husband_mobile TEXT,
  wife_mobile TEXT,
  extra_mobile TEXT,
  name_recording_path TEXT,
  card_last4 TEXT,
  needs_details INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS holidays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS holiday_seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  holiday_id INTEGER NOT NULL REFERENCES holidays(id),
  year_label TEXT NOT NULL,
  is_open INTEGER NOT NULL DEFAULT 0,
  opens_at TEXT,
  closes_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS location_capacities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  holiday_season_id INTEGER NOT NULL REFERENCES holiday_seasons(id),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  total_beds INTEGER NOT NULL DEFAULT 0,
  price_per_bed REAL NOT NULL DEFAULT 50,
  UNIQUE(holiday_season_id, location_id)
);

CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  holiday_season_id INTEGER NOT NULL REFERENCES holiday_seasons(id),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  bed_count INTEGER NOT NULL,
  price_per_bed_snapshot REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_payment', -- pending_payment | paid | cancelled
  payment_charge_id INTEGER REFERENCES payment_charges(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payment_charges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  call_id TEXT,
  total_amount REAL NOT NULL, -- הסכום שחויב בפועל באשראי (לא כולל מה שקוזז מזכות)
  credit_applied REAL NOT NULL DEFAULT 0, -- כמה מתוך הסכום הכולל כוסה מיתרת זכות
  status TEXT NOT NULL DEFAULT 'pending', -- pending | success | failed
  method TEXT NOT NULL DEFAULT 'phone', -- phone | manual_cash | manual_check | credit_only
  nedarim_confirmation TEXT,
  raw_response TEXT, -- כל הפרמטרים שחזרו מימות המשיח על תוצאת החיוב (JSON) - לצורך ביקורת/דיבוג
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  amount REAL NOT NULL, -- חיובי = הוספת זכות, שלילי = ניצול זכות
  reason TEXT,
  reservation_id INTEGER REFERENCES reservations(id),
  payment_charge_id INTEGER REFERENCES payment_charges(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS call_sessions (
  call_id TEXT PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id),
  step TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS donations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id),
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  call_id TEXT,
  nedarim_confirmation TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'manager' -- manager | user
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS call_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id TEXT NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  ivr_type TEXT NOT NULL, -- register | status | donate
  phone TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  final_step TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT,
  recording_path TEXT,
  email_sent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
