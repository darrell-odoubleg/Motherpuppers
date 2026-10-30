const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, '..', 'db', 'walks.db'));
db.pragma('journal_mode = WAL');

// Logins are the cleaning app's users (same usernames, passwords, colors,
// admin flag). Opened read-only: accounts are managed on cleaning's /admin.
const users = new Database(process.env.CLEANING_DB || path.join(__dirname, '..', '..', 'db', 'cleaning.db'), {
  readonly: true, fileMustExist: true,
});

// Walks every 2 hours: slot 0 = 6 AM, slot 7 = 8 PM (covers until 9 PM close).
const FIRST_HOUR = 6;
const SLOT_HOURS = 2;
const SLOT_COUNT = 8;
const MARKS = ['walk', 'poop'];

db.exec(`
  -- The dogs staying on a date, copied from the PawPartner dashboard on each sync.
  -- gone = 1 when PawPartner no longer lists the dog but it already has marks.
  CREATE TABLE IF NOT EXISTS dogs (
    date TEXT NOT NULL,
    pet_id INTEGER NOT NULL,
    reservation_id INTEGER,
    name TEXT NOT NULL,
    breed TEXT NOT NULL DEFAULT '',
    owner TEXT NOT NULL DEFAULT '',
    service TEXT NOT NULL DEFAULT '',
    kennel TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    arrives TEXT,
    leaves TEXT,
    photo_url TEXT,
    gone INTEGER NOT NULL DEFAULT 0,
    synced_at INTEGER NOT NULL,
    PRIMARY KEY (date, pet_id)
  );
  -- One mark per dog per walk slot: walk (✓ outside / pee) or poop (filled box).
  CREATE TABLE IF NOT EXISTS marks (
    date TEXT NOT NULL,
    pet_id INTEGER NOT NULL,
    slot INTEGER NOT NULL,
    mark TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (date, pet_id, slot)
  );
  -- Every tap, including clears, so a changed mark can be traced.
  CREATE TABLE IF NOT EXISTS marks_log (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL,
    pet_id INTEGER NOT NULL,
    slot INTEGER NOT NULL,
    mark TEXT,
    user_id INTEGER NOT NULL,
    at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS syncs (
    date TEXT PRIMARY KEY,
    at INTEGER NOT NULL,
    ok INTEGER NOT NULL,
    error TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    expires INTEGER NOT NULL
  );
`);

module.exports = { db, users, FIRST_HOUR, SLOT_HOURS, SLOT_COUNT, MARKS };
