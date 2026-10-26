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
// Up to three people can be on at once: each day has lanes 0–2 side by side.
const LANES = 3;

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
  -- One person per lane per half-hour slot per day (the workbook had one lane).
  CREATE TABLE IF NOT EXISTS cells (
    date TEXT NOT NULL,
    slot INTEGER NOT NULL,
    lane INTEGER NOT NULL DEFAULT 0,
    person_id INTEGER REFERENCES people(id),
    note TEXT NOT NULL DEFAULT '',
    updated_by TEXT,
    updated_at TEXT,
    PRIMARY KEY (date, slot, lane)
  );
  -- The two-week "Actual Permanent Schedule": week A/B, dow 0 = Monday.
  CREATE TABLE IF NOT EXISTS template_cells (
    week TEXT NOT NULL,
    dow INTEGER NOT NULL,
    slot INTEGER NOT NULL,
    lane INTEGER NOT NULL DEFAULT 0,
    person_id INTEGER REFERENCES people(id),
    note TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (week, dow, slot, lane)
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

// Databases made before lanes existed: rebuild both grids with a lane column
// (the primary key changes, so ALTER TABLE isn't enough). Old cells go in lane 0.
function addLanes(table, keyCols) {
  if (db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === 'lane')) return;
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name).join(', ');
  db.transaction(() => {
    db.exec(`ALTER TABLE ${table} RENAME TO ${table}_old`);
    const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(`${table}_old`).sql
      .replace(`${table}_old`, table)
      .replace('slot INTEGER NOT NULL,', 'slot INTEGER NOT NULL,\n    lane INTEGER NOT NULL DEFAULT 0,')
      .replace(`PRIMARY KEY (${keyCols})`, `PRIMARY KEY (${keyCols}, lane)`);
    db.exec(ddl);
    db.exec(`INSERT INTO ${table} (${cols}) SELECT ${cols} FROM ${table}_old; DROP TABLE ${table}_old;`);
  })();
}
addLanes('cells', 'date, slot');

// Per-person notes: time-off requests, kids/childcare constraints. Admins edit;
// staff see only their own.
if (!db.prepare('PRAGMA table_info(people)').all().some(c => c.name === 'notes')) {
  db.exec("ALTER TABLE people ADD COLUMN notes TEXT NOT NULL DEFAULT ''");
}
addLanes('template_cells', 'week, dow, slot');

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

module.exports = { db, users, getSettings, FIRST_SLOT_MIN, SLOT_COUNT, LANES };
