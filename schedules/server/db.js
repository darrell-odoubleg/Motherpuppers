const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, '..', 'db', 'schedules.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Logins are the cleaning app's users (same usernames, passwords, colors,
// admin flag). Opened read-only: accounts are managed on cleaning's /admin.
const users = new Database(process.env.CLEANING_DB || path.join(__dirname, '..', '..', 'db', 'cleaning.db'), {
  readonly: true, fileMustExist: true,
});

// The schedule is a grid of half-hour slots, 6:00am to 10:00pm, the same as
// the "MP SCHEDULE Layout" workbook. Slot 0 = 6:00–6:30, slot 31 = 9:30–10:00pm.
const FIRST_SLOT_MIN = 6 * 60;
const SLOT_COUNT = 32;

db.exec(`
  -- Anyone who can be scheduled. user_id links to a cleaning login (and takes
  -- that login's color); people without a login (Sky/Tanner) keep their own.
  -- is_open marks the "Open shift" placeholder: shown, but not counted as hours.
  CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#7357a4',
    user_id INTEGER,
    is_open INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0
  );
  -- One person per half-hour slot per day, as in the workbook.
  CREATE TABLE IF NOT EXISTS cells (
    date TEXT NOT NULL,
    slot INTEGER NOT NULL,
    person_id INTEGER REFERENCES people(id),
    note TEXT NOT NULL DEFAULT '',
    updated_by TEXT,
    updated_at TEXT,
    PRIMARY KEY (date, slot)
  );
  -- The two-week "Actual Permanent Schedule": week A/B, dow 0 = Monday.
  CREATE TABLE IF NOT EXISTS template_cells (
    week TEXT NOT NULL,
    dow INTEGER NOT NULL,
    slot INTEGER NOT NULL,
    person_id INTEGER REFERENCES people(id),
    note TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (week, dow, slot)
  );
  CREATE TABLE IF NOT EXISTS changes (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    user_name TEXT NOT NULL,
    summary TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL);
`);

const DEFAULT_SETTINGS = {
  timezone: 'America/Denver',
  // A Monday that is a "Week A" of the permanent schedule; weeks alternate from it.
  week_a_anchor: '2026-11-16',
};
const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);

function getSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}

// First run: people from the workbook legend, then every week and the
// permanent schedule from seed.json (extracted from MP SCHEDULE Layout.xlsm).
const LEGEND = [
  ['Kelly', '#000000'], ['Megan', '#ff99ff'], ['Raven', '#ff0000'], ['Hailie', '#e97132'],
  ['Samantha', '#00b0f0'], ['Sky/Tanner', '#00b050'], ['Tammie', '#a02b93'],
];

function seed() {
  if (db.prepare('SELECT COUNT(*) n FROM people').get().n) return;
  const findUser = users.prepare('SELECT id FROM users WHERE name = ? COLLATE NOCASE AND active = 1');
  const ins = db.prepare('INSERT INTO people (name, color, user_id, is_open, sort) VALUES (?, ?, ?, ?, ?)');
  const ids = {};
  db.transaction(() => {
    LEGEND.forEach(([name, color], i) => {
      const u = findUser.get(name);
      ids[name] = ins.run(name, color, u ? u.id : null, 0, i).lastInsertRowid;
    });
    ids.__open = ins.run('Open shift', '#ffe600', null, 1, 99).lastInsertRowid;

    const data = require('./seed.json');
    const pid = c => (c.person ? ids[c.person] : (c.open ? ids.__open : null)) || null;
    const insCell = db.prepare('INSERT OR REPLACE INTO cells (date, slot, person_id, note, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
    const at = new Date().toISOString();
    for (const w of data.weeks) for (const d of w.days) for (const [slot, c] of Object.entries(d.cells)) {
      insCell.run(d.date, Number(slot), pid(c), c.note || '', 'Imported from MP SCHEDULE Layout', at);
    }
    const insT = db.prepare('INSERT OR REPLACE INTO template_cells (week, dow, slot, person_id, note) VALUES (?, ?, ?, ?, ?)');
    for (const t of data.template) t.days.forEach((d, dow) => {
      for (const [slot, c] of Object.entries(d.cells)) insT.run(t.week, dow, Number(slot), pid(c), c.note || '');
    });
  })();
}
seed();

module.exports = { db, users, getSettings, FIRST_SLOT_MIN, SLOT_COUNT };
