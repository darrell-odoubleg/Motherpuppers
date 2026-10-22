const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, '..', 'db', 'project.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    can_edit INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sections (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0
  );
  -- Money is stored in cents so totals never drift. due is computed (budget - paid), like the sheet.
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY,
    section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    task TEXT NOT NULL,
    assigned TEXT NOT NULL DEFAULT '',
    start_date TEXT NOT NULL DEFAULT '',
    end_date TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    budget INTEGER,
    paid INTEGER,
    comments TEXT NOT NULL DEFAULT '',
    sort INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT,
    updated_by INTEGER
  );
  -- Who changed what. No FKs so history survives deletes.
  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    user_id INTEGER,
    user_name TEXT NOT NULL,
    section TEXT NOT NULL DEFAULT '',
    task TEXT NOT NULL DEFAULT '',
    field TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL);
`);

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

// First run: load the line items from the Google Sheet export (server/seed.json).
if (!db.prepare('SELECT COUNT(*) n FROM sections').get().n) {
  const data = require('./seed.json');
  const insS = db.prepare('INSERT INTO sections (name, sort) VALUES (?, ?)');
  const insT = db.prepare('INSERT INTO tasks (section_id, task, assigned, budget, sort) VALUES (?, ?, ?, ?, ?)');
  db.transaction(() => {
    data.forEach((s, i) => {
      const sid = insS.run(s.name, (i + 1) * 10).lastInsertRowid;
      s.tasks.forEach((t, j) => insT.run(sid, t.task, t.assigned, t.budget == null ? null : Math.round(t.budget * 100), (j + 1) * 10));
    });
  })();
}

// First run: create the admin from .env so someone can sign in and add people.
if (!db.prepare('SELECT COUNT(*) n FROM users').get().n && process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
  db.prepare('INSERT INTO users (name, username, pass_hash, is_admin, can_edit) VALUES (?, ?, ?, 1, 1)')
    .run(process.env.ADMIN_NAME || 'Admin', process.env.ADMIN_USERNAME, hashPassword(process.env.ADMIN_PASSWORD));
}

module.exports = { db, hashPassword, checkPassword };
