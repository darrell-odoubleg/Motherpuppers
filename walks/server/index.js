require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const express = require('express');
const mpauth = require('../../shared/mpauth');
const sharp = require('sharp');
const { db, users, FIRST_HOUR, SLOT_HOURS, SLOT_COUNT, MARKS } = require('./db');
const pawpartner = require('./pawpartner');

const PORT = process.env.PORT || 4600;
const TZ = process.env.TZ_NAME || 'America/Denver';
const PHOTO_DIR = path.join(__dirname, '..', 'db', 'photos');
const SYNC_MAX_AGE = 5 * 60 * 1000;
fs.mkdirSync(PHOTO_DIR, { recursive: true });

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));

// ---------- auth (one sign-in across the Mother Puppers sites, see ../../shared/mpauth.js) ----------
const requireUser = mpauth.requireApp(users, 'walks');

app.post('/api/login', mpauth.loginRoute(users, 'walks'));
app.post('/api/logout', mpauth.logoutRoute);
app.get('/api/me', requireUser, (req, res) => res.json(req.user));

// ---------- dates ----------
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function nowMinutes() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return Number(p.hour) * 60 + Number(p.minute);
}

const slots = Array.from({ length: SLOT_COUNT }, (_, i) => {
  const h = FIRST_HOUR + i * SLOT_HOURS;
  return { slot: i, hour: h, label: `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}` };
});

// ---------- PawPartner sync ----------
// Only today is synced: for later dates PawPartner's "Current Guests" table still shows who is in now.
const upsertDog = db.prepare(`
  INSERT INTO dogs (date, pet_id, reservation_id, name, breed, owner, service, kennel, status, arrives, leaves, photo_url, gone, synced_at)
  VALUES (@date, @pet_id, @reservation_id, @name, @breed, @owner, @service, @kennel, @status, @arrives, @leaves, @photo_url, 0, @synced_at)
  ON CONFLICT (date, pet_id) DO UPDATE SET reservation_id = excluded.reservation_id, name = excluded.name, breed = excluded.breed,
    owner = excluded.owner, service = excluded.service, kennel = excluded.kennel, status = excluded.status,
    arrives = excluded.arrives, leaves = excluded.leaves, photo_url = COALESCE(excluded.photo_url, dogs.photo_url),
    gone = 0, synced_at = excluded.synced_at`);

let running = null;
function sync(date) {
  if (running) return running;
  running = (async () => {
    const at = Date.now();
    try {
      const dogs = await pawpartner.dogsFor(date);
      db.transaction(() => {
        for (const d of dogs) upsertDog.run({ ...d, date, synced_at: at });
        // Dogs PawPartner dropped: forget them, unless someone already marked a walk (then keep, faded).
        const stale = db.prepare('SELECT pet_id FROM dogs WHERE date = ? AND synced_at < ?').all(date, at);
        for (const { pet_id: id } of stale) {
          const marked = db.prepare('SELECT 1 FROM marks WHERE date = ? AND pet_id = ?').get(date, id);
          if (marked) db.prepare('UPDATE dogs SET gone = 1 WHERE date = ? AND pet_id = ?').run(date, id);
          else db.prepare('DELETE FROM dogs WHERE date = ? AND pet_id = ?').run(date, id);
        }
        db.prepare('INSERT OR REPLACE INTO syncs (date, at, ok, error) VALUES (?, ?, 1, NULL)').run(date, at);
      })();
      return { ok: true, count: dogs.length };
    } catch (err) {
      console.error('[sync]', err.message);
      db.prepare('INSERT INTO syncs (date, at, ok, error) VALUES (?, ?, 0, ?) ON CONFLICT (date) DO UPDATE SET at = excluded.at, ok = 0, error = excluded.error')
        .run(date, at, err.message);
      return { ok: false, error: err.message };
    } finally {
      running = null;
    }
  })();
  return running;
}

// Keep today fresh while the building is open, even if nobody has the page up.
setInterval(() => {
  const m = nowMinutes();
  if (m >= 5 * 60 && m <= 22 * 60) sync(today());
}, 10 * 60 * 1000).unref();

// ---------- walk sheet ----------
app.get('/api/day', requireUser, async (req, res) => {
  const t = today();
  const date = isDate(req.query.date) ? req.query.date : t;
  if (date > t) return res.status(400).json({ error: "PawPartner only gives today's guests" });
  if (date === t) {
    const last = db.prepare('SELECT at FROM syncs WHERE date = ?').get(date);
    if (!last || Date.now() - last.at > SYNC_MAX_AGE || req.query.refresh) await sync(date);
  }
  const dogs = db.prepare('SELECT * FROM dogs WHERE date = ?').all(date);
  const marks = db.prepare('SELECT pet_id, slot, mark, user_id, at FROM marks WHERE date = ?').all(date);
  const who = users.prepare('SELECT name, color FROM users WHERE id = ?');
  const people = new Map();
  const out = {};
  for (const m of marks) {
    if (!people.has(m.user_id)) people.set(m.user_id, who.get(m.user_id) || { name: '?', color: '#888888' });
    (out[m.pet_id] = out[m.pet_id] || {})[m.slot] = { mark: m.mark, at: m.at, ...people.get(m.user_id) };
  }
  res.set('Cache-Control', 'no-store').json({
    date,
    today: t,
    tz: TZ,
    now_minutes: date === t ? nowMinutes() : null,
    editable: date === t || Boolean(req.user.is_admin),
    slots,
    dogs: dogs.map((d) => ({ ...d, photo_url: undefined, has_photo: Boolean(d.photo_url) })),
    marks: out,
    sync: db.prepare('SELECT at, ok, error FROM syncs WHERE date = ?').get(date) || null,
  });
});

app.put('/api/mark', requireUser, (req, res) => {
  const b = req.body || {};
  const t = today();
  const date = isDate(b.date) ? b.date : null;
  const slot = Number(b.slot);
  const mark = b.mark || null;
  if (!date || !Number.isInteger(slot) || slot < 0 || slot >= SLOT_COUNT) return res.status(400).json({ error: 'Bad request' });
  if (mark && !MARKS.includes(mark)) return res.status(400).json({ error: 'Bad mark' });
  if (date !== t && !req.user.is_admin) return res.status(403).json({ error: 'Only today can be marked' });
  if (!db.prepare('SELECT 1 FROM dogs WHERE date = ? AND pet_id = ?').get(date, Number(b.pet_id))) return res.status(404).json({ error: 'Dog not on this day' });
  const at = Date.now();
  db.transaction(() => {
    if (mark) {
      db.prepare('INSERT OR REPLACE INTO marks (date, pet_id, slot, mark, user_id, at) VALUES (?, ?, ?, ?, ?, ?)').run(date, Number(b.pet_id), slot, mark, req.user.id, at);
    } else {
      db.prepare('DELETE FROM marks WHERE date = ? AND pet_id = ? AND slot = ?').run(date, Number(b.pet_id), slot);
    }
    db.prepare('INSERT INTO marks_log (date, pet_id, slot, mark, user_id, at) VALUES (?, ?, ?, ?, ?, ?)').run(date, Number(b.pet_id), slot, mark, req.user.id, at);
  })();
  res.json({ ok: true, at, name: req.user.name, color: req.user.color });
});

// Dog photos: fetched once from PawPartner, shrunk, and cached on disk.
app.get('/api/photo/:petId', requireUser, async (req, res) => {
  const id = Number(req.params.petId);
  if (!Number.isInteger(id)) return res.status(404).end();
  const file = path.join(PHOTO_DIR, `${id}.jpg`);
  try {
    if (!fs.existsSync(file)) {
      const row = db.prepare('SELECT photo_url FROM dogs WHERE pet_id = ? AND photo_url IS NOT NULL ORDER BY date DESC LIMIT 1').get(id);
      if (!row) return res.status(404).end();
      const img = await sharp(await pawpartner.fetchPhoto(row.photo_url)).rotate().resize(160, 160, { fit: 'cover' }).jpeg({ quality: 78 }).toBuffer();
      fs.writeFileSync(file, img);
    }
    res.set('Cache-Control', 'private, max-age=86400').type('jpeg').sendFile(file);
  } catch (err) {
    console.error('[photo]', id, err.message);
    res.status(404).end();
  }
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.listen(PORT, '127.0.0.1', () => console.log(`motherpuppers-walks on 127.0.0.1:${PORT}`));
