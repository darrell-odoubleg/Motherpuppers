require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const express = require('express');
const session = require('express-session');
const { db, getSettings, hashPassword, checkPassword } = require('./db');
const { periodsAt, periodsForDate } = require('./periods');

const PORT = process.env.PORT || 4100;
const app = express();
app.set('trust proxy', 1);
app.use(express.json());

// Sessions live in SQLite so restarts don't sign everyone out.
class SqliteStore extends session.Store {
  get(sid, cb) {
    const row = db.prepare('SELECT data, expires FROM sessions WHERE sid = ?').get(sid);
    if (!row || row.expires < Date.now()) return cb(null, null);
    cb(null, JSON.parse(row.data));
  }
  set(sid, sess, cb) {
    const expires = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 86400000;
    db.prepare('INSERT OR REPLACE INTO sessions (sid, data, expires) VALUES (?, ?, ?)').run(sid, JSON.stringify(sess), expires);
    cb && cb(null);
  }
  destroy(sid, cb) {
    db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
    cb && cb(null);
  }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
}
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now()), 3600000).unref();

app.use(session({
  store: new SqliteStore(),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === '1', maxAge: 14 * 86400000 },
}));

// ---------- auth ----------
const MAX_FAILS = 8;
const WINDOW_MS = 15 * 60 * 1000;
const fails = new Map();

function currentUser(req) {
  if (!req.session || !req.session.userId) return null;
  return db.prepare('SELECT id, name, username, color, is_admin FROM users WHERE id = ? AND active = 1').get(req.session.userId) || null;
}

function requireUser(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'Not signed in' });
  req.user = u;
  next();
}

function requireAdmin(req, res, next) {
  requireUser(req, res, () => {
    if (!req.user.is_admin) return res.status(403).json({ error: 'Admins only' });
    next();
  });
}

app.post('/api/login', (req, res) => {
  const now = Date.now();
  const entry = fails.get(req.ip);
  if (entry && now - entry.first < WINDOW_MS && entry.count >= MAX_FAILS) {
    return res.status(429).json({ error: 'Too many attempts — try again in 15 minutes' });
  }
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT id, pass_hash FROM users WHERE username = ? AND active = 1').get(String(username || '').trim());
  if (u && checkPassword(password, u.pass_hash)) {
    fails.delete(req.ip);
    return req.session.regenerate(() => {
      req.session.userId = u.id;
      res.json({ ok: true });
    });
  }
  if (!entry || now - entry.first >= WINDOW_MS) fails.set(req.ip, { first: now, count: 1 });
  else entry.count += 1;
  res.status(401).json({ error: 'Wrong username or password' });
});

app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get('/api/me', requireUser, (req, res) => res.json(req.user));

// ---------- board ----------
function seasonActive(season, month, settings) {
  if (!season) return true;
  const months = season === 'summer' ? settings.summer_months : settings.winter_months;
  return months.includes(month);
}

function buildBoard(periods, settings) {
  const keys = { daily: periods.daily.key, weekly: periods.weekly.key, monthly: periods.monthly.key };
  const checks = db.prepare(`
    SELECT c.task_id, c.box, c.period_key, c.checked_at, u.id user_id, u.name, u.color
    FROM checks c JOIN users u ON u.id = c.user_id
    WHERE c.period_key IN (?, ?, ?)`).all(keys.daily, keys.weekly, keys.monthly);
  const checkMap = new Map();
  for (const c of checks) checkMap.set(`${c.task_id}|${c.box}|${c.period_key}`, { user_id: c.user_id, name: c.name, color: c.color, at: c.checked_at });

  const areas = db.prepare('SELECT * FROM areas ORDER BY sort, id').all();
  const sections = db.prepare('SELECT * FROM sections ORDER BY sort, id').all();
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY sort, id').all();

  return areas.map((a) => ({
    id: a.id,
    name: a.name,
    sections: sections
      .filter((s) => s.area_id === a.id && seasonActive(s.season, periods.month, settings))
      .map((s) => ({
        id: s.id, period: s.period, season: s.season, title: s.title, note: s.note,
        tasks: tasks
          .filter((t) => t.section_id === s.id)
          .filter((t) => !t.months || JSON.parse(t.months).includes(periods.month))
          .map((t) => {
            const boxes = JSON.parse(t.boxes);
            const pk = keys[s.period];
            const done = {};
            for (const b of boxes) {
              const c = checkMap.get(`${t.id}|${b}|${pk}`);
              if (c) done[b] = c;
            }
            return { id: t.id, label: t.label, note: t.note, boxes, done };
          }),
      }))
      .filter((s) => s.period === 'info' || s.tasks.length),
  }));
}

app.get('/api/board', requireUser, (req, res) => {
  const settings = getSettings();
  const today = periodsAt(settings.timezone);
  let periods = today;
  let readOnly = false;
  if (req.query.date && req.query.date !== today.date) {
    if (!req.user.is_admin) return res.status(403).json({ error: 'Only admins can view past lists' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) return res.status(400).json({ error: 'Bad date' });
    periods = periodsForDate(req.query.date);
    readOnly = true;
  }
  const staff = db.prepare('SELECT id, name, color FROM users WHERE active = 1 ORDER BY name').all();
  res.json({ me: req.user, periods, today: today.date, timezone: settings.timezone, readOnly, staff, areas: buildBoard(periods, settings) });
});

app.post('/api/check', requireUser, (req, res) => {
  const taskId = Number(req.body && req.body.task_id);
  const box = String((req.body && req.body.box) || '');
  const task = db.prepare('SELECT t.boxes, s.period FROM tasks t JOIN sections s ON s.id = t.section_id WHERE t.id = ?').get(taskId);
  if (!task || task.period === 'info' || !JSON.parse(task.boxes).includes(box)) return res.status(400).json({ error: 'Unknown task' });
  // The period is always decided by the server clock, so a stale page can't check into yesterday.
  const pk = periodsAt(getSettings().timezone)[task.period].key;
  const r = db.prepare('INSERT OR IGNORE INTO checks (task_id, box, period_key, user_id) VALUES (?, ?, ?, ?)').run(taskId, box, pk, req.user.id);
  if (!r.changes) {
    const by = db.prepare('SELECT u.name FROM checks c JOIN users u ON u.id = c.user_id WHERE task_id = ? AND box = ? AND period_key = ?').get(taskId, box, pk);
    return res.status(409).json({ error: `Already checked off by ${by ? by.name : 'someone'}` });
  }
  res.json({ ok: true });
});

// ---------- admin: staff ----------
const HEX = /^#[0-9a-fA-F]{6}$/;

app.get('/api/admin/users', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, name, username, color, is_admin, active, created_at FROM users ORDER BY active DESC, name').all());
});

app.post('/api/admin/users', requireAdmin, (req, res) => {
  const { name, username, password, color, is_admin } = req.body || {};
  if (!name || !username || !password) return res.status(400).json({ error: 'Name, username and password are required' });
  if (color && !HEX.test(color)) return res.status(400).json({ error: 'Bad color' });
  try {
    const r = db.prepare('INSERT INTO users (name, username, pass_hash, color, is_admin) VALUES (?, ?, ?, ?, ?)')
      .run(String(name).trim(), String(username).trim(), hashPassword(password), color || '#3b82f6', is_admin ? 1 : 0);
    res.json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: /UNIQUE/.test(e.message) ? 'That username is taken' : e.message });
  }
});

app.put('/api/admin/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  if (b.color && !HEX.test(b.color)) return res.status(400).json({ error: 'Bad color' });
  if (id === req.user.id && (b.is_admin === false || b.active === false)) return res.status(400).json({ error: 'You can’t remove your own admin access' });
  try {
    db.prepare('UPDATE users SET name = ?, username = ?, color = ?, is_admin = ?, active = ? WHERE id = ?').run(
      b.name != null ? String(b.name).trim() : u.name,
      b.username != null ? String(b.username).trim() : u.username,
      b.color || u.color,
      b.is_admin != null ? (b.is_admin ? 1 : 0) : u.is_admin,
      b.active != null ? (b.active ? 1 : 0) : u.active,
      id,
    );
    if (b.password) db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(b.password), id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: /UNIQUE/.test(e.message) ? 'That username is taken' : e.message });
  }
});

// ---------- admin: settings ----------
app.get('/api/admin/settings', requireAdmin, (req, res) => res.json(getSettings()));

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const b = req.body || {};
  const months = (v) => Array.isArray(v) && v.every((m) => Number.isInteger(m) && m >= 1 && m <= 12);
  if (b.timezone) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: b.timezone }); } catch { return res.status(400).json({ error: 'Unknown timezone' }); }
  }
  if (b.summer_months && !months(b.summer_months)) return res.status(400).json({ error: 'Bad summer months' });
  if (b.winter_months && !months(b.winter_months)) return res.status(400).json({ error: 'Bad winter months' });
  const set = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  if (b.timezone) set.run(b.timezone, 'timezone');
  if (b.summer_months) set.run(JSON.stringify(b.summer_months), 'summer_months');
  if (b.winter_months) set.run(JSON.stringify(b.winter_months), 'winter_months');
  res.json(getSettings());
});

// ---------- admin: task editor ----------
const PERIODS = ['daily', 'weekly', 'monthly', 'info'];

function cleanBoxes(v) {
  const arr = (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean);
  return [...new Set(arr)].length ? [...new Set(arr)] : ['Done'];
}
function cleanMonths(v) {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return null;
  const arr = (Array.isArray(v) ? v : String(v).split(',')).map(Number).filter((m) => Number.isInteger(m) && m >= 1 && m <= 12);
  return arr.length ? JSON.stringify([...new Set(arr)].sort((a, b) => a - b)) : null;
}

app.get('/api/admin/tasks', requireAdmin, (req, res) => {
  const areas = db.prepare('SELECT * FROM areas ORDER BY sort, id').all();
  const sections = db.prepare('SELECT * FROM sections ORDER BY sort, id').all();
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY sort, id').all();
  res.json(areas.map((a) => ({
    ...a,
    sections: sections.filter((s) => s.area_id === a.id).map((s) => ({
      ...s,
      tasks: tasks.filter((t) => t.section_id === s.id).map((t) => ({ ...t, boxes: JSON.parse(t.boxes), months: t.months ? JSON.parse(t.months) : null })),
    })),
  })));
});

app.post('/api/admin/sections', requireAdmin, (req, res) => {
  const b = req.body || {};
  if (!b.area_id || !b.title || !PERIODS.includes(b.period)) return res.status(400).json({ error: 'Area, title and period are required' });
  const sort = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 n FROM sections WHERE area_id = ?').get(b.area_id).n;
  const r = db.prepare('INSERT INTO sections (area_id, period, season, title, note, sort) VALUES (?, ?, ?, ?, ?, ?)')
    .run(b.area_id, b.period, ['summer', 'winter'].includes(b.season) ? b.season : null, String(b.title).trim(), b.note || '', sort);
  res.json({ id: r.lastInsertRowid });
});

// Saves the order sections appear in: ids is the area's sections, top to bottom.
app.put('/api/admin/sections-order', requireAdmin, (req, res) => {
  const ids = (req.body && req.body.ids) || [];
  if (!Array.isArray(ids) || !ids.every(Number.isInteger)) return res.status(400).json({ error: 'Bad order' });
  const set = db.prepare('UPDATE sections SET sort = ? WHERE id = ?');
  db.transaction(() => ids.forEach((id, i) => set.run(i, id)))();
  res.json({ ok: true });
});

app.put('/api/admin/sections/:id', requireAdmin, (req, res) => {
  const s = db.prepare('SELECT * FROM sections WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  if (b.period && !PERIODS.includes(b.period)) return res.status(400).json({ error: 'Bad period' });
  db.prepare('UPDATE sections SET title = ?, note = ?, period = ?, season = ?, sort = ? WHERE id = ?').run(
    b.title != null ? String(b.title).trim() : s.title,
    b.note != null ? String(b.note) : s.note,
    b.period || s.period,
    b.season !== undefined ? (['summer', 'winter'].includes(b.season) ? b.season : null) : s.season,
    b.sort != null ? Number(b.sort) : s.sort,
    s.id,
  );
  res.json({ ok: true });
});

app.delete('/api/admin/sections/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM sections WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/admin/tasks', requireAdmin, (req, res) => {
  const b = req.body || {};
  if (!b.section_id || !b.label) return res.status(400).json({ error: 'Section and label are required' });
  const sort = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 n FROM tasks WHERE section_id = ?').get(b.section_id).n;
  const r = db.prepare('INSERT INTO tasks (section_id, label, note, boxes, months, sort) VALUES (?, ?, ?, ?, ?, ?)')
    .run(b.section_id, String(b.label).trim(), b.note || '', JSON.stringify(cleanBoxes(b.boxes)), cleanMonths(b.months), sort);
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/admin/tasks/:id', requireAdmin, (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  db.prepare('UPDATE tasks SET label = ?, note = ?, boxes = ?, months = ?, sort = ? WHERE id = ?').run(
    b.label != null ? String(b.label).trim() : t.label,
    b.note != null ? String(b.note) : t.note,
    b.boxes != null ? JSON.stringify(cleanBoxes(b.boxes)) : t.boxes,
    b.months !== undefined ? cleanMonths(b.months) : t.months,
    b.sort != null ? Number(b.sort) : t.sort,
    t.id,
  );
  res.json({ ok: true });
});

app.delete('/api/admin/tasks/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- pages ----------
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, '127.0.0.1', () => console.log(`motherpuppers-cleaning on :${PORT}`));
