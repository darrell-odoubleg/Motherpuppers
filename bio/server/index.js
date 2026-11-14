// bio.motherpuppers.net: a staff member fills in a photo and three questions, and it is
// emailed to Tammie. Signs in with the cleaning app's logins (shared/mpauth.js). Any
// active login can use it; it is not one of the app-access checkboxes or app tabs.
// Every bio is saved first, so a failed email is retried and never loses anything.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const Database = require('better-sqlite3');
const mpauth = require('../../shared/mpauth');
const { sendBio } = require('./notify');

const PORT = Number(process.env.PORT) || 4900;
const DB_DIR = path.join(__dirname, '..', 'db');
const PHOTO_DIR = path.join(DB_DIR, 'photos');
fs.mkdirSync(PHOTO_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'bio.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS bios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    name TEXT NOT NULL,
    journey TEXT NOT NULL,
    love TEXT NOT NULL,
    outside TEXT NOT NULL,
    photo TEXT NOT NULL,            -- file name in db/photos
    created_at INTEGER NOT NULL,
    emailed_at INTEGER,
    email_error TEXT,
    email_tries INTEGER NOT NULL DEFAULT 0
  );
`);

// Logins are the cleaning app's users, read-only (accounts are managed on cleaning /admin).
const users = new Database(process.env.CLEANING_DB || path.join(__dirname, '..', '..', 'db', 'cleaning.db'), {
  readonly: true, fileMustExist: true,
});

const app = express();
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// Any signed-in, active login (no per-app check).
function requireUser(req, res, next) {
  const u = mpauth.userFrom(req, res, users);
  if (!u) return res.status(401).json({ error: 'Not signed in' });
  req.user = u;
  next();
}

app.post('/api/login', mpauth.loginRoute(users, null));
app.post('/api/logout', mpauth.logoutRoute(users));
app.all('/api/auth/ping', mpauth.pingRoute(users));
app.get('/api/me', requireUser, (req, res) => {
  const last = db.prepare('SELECT created_at, emailed_at FROM bios WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(req.user.id);
  res.json({ id: req.user.id, name: req.user.name, username: req.user.username, last: last || null });
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 10, fieldSize: 20000 },
});
const MAX_TEXT = 5000;
const clean = (s) => String(s || '').replace(/\r\n?/g, '\n').trim();

app.post('/api/bio', requireUser, (req, res, next) => {
  upload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'That picture is too big (25 MB max).' : 'Upload failed — try again.' });
    next();
  });
}, async (req, res) => {
  const v = {
    name: clean(req.body.name) || req.user.name,
    journey: clean(req.body.journey),
    love: clean(req.body.love),
    outside: clean(req.body.outside),
  };
  if (!req.file) return res.status(400).json({ error: 'Please add a picture.' });
  for (const [k, label] of [['journey', 'My journey with animals'], ['love', 'What I love about Mother Puppers'], ['outside', 'Life outside the Kennel']]) {
    if (!v[k]) return res.status(400).json({ error: `Please fill in “${label}”.` });
    if (v[k].length > MAX_TEXT) return res.status(400).json({ error: `“${label}” is too long (${MAX_TEXT} characters max).` });
  }
  if (v.name.length > 100) return res.status(400).json({ error: 'Name is too long.' });

  // Turn whatever was uploaded into an upright JPEG no bigger than 2000px.
  let jpeg;
  try {
    jpeg = await sharp(req.file.buffer, { failOn: 'none' }).rotate()
      .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  } catch {
    return res.status(400).json({ error: "That file couldn't be read as a picture. Try a JPG or PNG." });
  }
  const now = Date.now();
  const photo = `${req.user.id}-${now}.jpg`;
  fs.writeFileSync(path.join(PHOTO_DIR, photo), jpeg);
  const id = db.prepare(`INSERT INTO bios (user_id, username, name, journey, love, outside, photo, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(req.user.id, req.user.username, v.name, v.journey, v.love, v.outside, photo, now).lastInsertRowid;

  const emailed = await deliver(id);
  res.json({ ok: true, emailed });
});

// Sends one saved bio; records success or the error. Returns true when sent.
async function deliver(id) {
  const b = db.prepare('SELECT * FROM bios WHERE id = ?').get(id);
  if (!b || b.emailed_at) return !!b;
  try {
    await sendBio(b, fs.readFileSync(path.join(PHOTO_DIR, b.photo)));
    db.prepare('UPDATE bios SET emailed_at = ?, email_error = NULL, email_tries = email_tries + 1 WHERE id = ?').run(Date.now(), id);
    return true;
  } catch (err) {
    console.error(`bio ${id} email failed:`, err.message);
    db.prepare('UPDATE bios SET email_error = ?, email_tries = email_tries + 1 WHERE id = ?').run(String(err.message).slice(0, 500), id);
    return false;
  }
}

// Retry unsent bios every 10 minutes (for up to 3 days).
setInterval(async () => {
  const rows = db.prepare('SELECT id FROM bios WHERE emailed_at IS NULL AND created_at > ? ORDER BY id').all(Date.now() - 3 * 86400000);
  for (const r of rows) await deliver(r.id);
}, 10 * 60000).unref();

app.use(express.static(path.join(__dirname, '..', 'public'), { setHeaders: (res, file) => { if (file.endsWith('.html')) res.set('Cache-Control', 'no-store'); } }));
app.get('*', (req, res) => res.set('Cache-Control', 'no-store').sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.listen(PORT, '127.0.0.1', () => console.log(`motherpuppers-bio on 127.0.0.1:${PORT}`));
