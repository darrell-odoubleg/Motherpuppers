const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { seed } = require('./seed');

const db = new Database(path.join(__dirname, '..', 'db', 'cleaning.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#3b82f6',
    is_admin INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS areas (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0
  );
  -- period: daily | weekly | monthly | info.  season: NULL | summer | winter
  CREATE TABLE IF NOT EXISTS sections (
    id INTEGER PRIMARY KEY,
    area_id INTEGER NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
    period TEXT NOT NULL,
    season TEXT,
    title TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    sort INTEGER NOT NULL DEFAULT 0
  );
  -- boxes: JSON array of box labels.  months: JSON array of 1-12, or NULL for every month
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY,
    section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    boxes TEXT NOT NULL DEFAULT '["Done"]',
    months TEXT,
    sort INTEGER NOT NULL DEFAULT 0
  );
  -- One row per checked box per period; the UNIQUE key is what makes a check permanent.
  -- No FK on task_id so history survives a task being deleted.
  CREATE TABLE IF NOT EXISTS checks (
    id INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL,
    box TEXT NOT NULL,
    period_key TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    checked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (task_id, box, period_key)
  );
  CREATE INDEX IF NOT EXISTS checks_period ON checks (period_key);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL);
`);

const DEFAULT_SETTINGS = {
  timezone: process.env.TZ_DEFAULT || 'America/Denver',
  summer_months: '[5,6,7,8,9]',
  winter_months: '[11,12,1,2,3]',
};
const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);

function getSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return {
    timezone: out.timezone,
    summer_months: JSON.parse(out.summer_months),
    winter_months: JSON.parse(out.winter_months),
  };
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(String(pw), salt, 64).toString('hex')}`;
}

function checkPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(String(pw), salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

seed(db);

// First run: create the admin from .env so someone can sign in and add staff.
if (!db.prepare('SELECT COUNT(*) n FROM users').get().n && process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
  db.prepare('INSERT INTO users (name, username, pass_hash, color, is_admin) VALUES (?, ?, ?, ?, 1)')
    .run(process.env.ADMIN_NAME || 'Admin', process.env.ADMIN_USERNAME, hashPassword(process.env.ADMIN_PASSWORD), '#7c3aed');
}

module.exports = { db, getSettings, hashPassword, checkPassword };
