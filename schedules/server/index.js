require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const express = require('express');
const mpauth = require('../../shared/mpauth');
const { db, users, getSettings, FIRST_SLOT_MIN, SLOT_COUNT, LANES } = require('./db');

const PORT = process.env.PORT || 4300;
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

// ---------- auth (one sign-in across the Mother Puppers sites, see ../../shared/mpauth.js) ----------
const signedIn = mpauth.requireApp(users, 'schedule');

// Adds the schedule person linked to the login, if any.
function requireUser(req, res, next) {
  signedIn(req, res, () => {
    const p = db.prepare('SELECT id FROM people WHERE user_id = ? AND active = 1').get(req.user.id);
    req.user = { ...req.user, person_id: p ? p.id : null };
    next();
  });
}

function requireAdmin(req, res, next) {
  requireUser(req, res, () => {
    if (!req.user.is_admin) return res.status(403).json({ error: 'Only admins can change the schedule' });
    next();
  });
}

app.post('/api/login', mpauth.loginRoute(users, 'schedule'));
app.post('/api/logout', mpauth.logoutRoute);
app.get('/api/me', requireUser, (req, res) => res.json(req.user));

// ---------- dates ----------
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const toUTC = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fromUTC = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = toUTC(s); d.setUTCDate(d.getUTCDate() + n); return fromUTC(d); };
const mondayOf = s => addDays(s, -((toUTC(s).getUTCDay() + 6) % 7));

function today() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: getSettings().timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return parts; // en-CA formats as YYYY-MM-DD
}

function templateWeekFor(monday) {
  const weeks = Math.round((toUTC(monday) - toUTC(mondayOf(getSettings().week_a_anchor))) / (7 * 86400000));
  return ((weeks % 2) + 2) % 2 === 0 ? 'A' : 'B';
}

function slotLabel(slot, end) {
  const m = FIRST_SLOT_MIN + slot * 30 + (end ? 30 : 0);
  const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, '0');
  return `${((h + 11) % 12) + 1}:${mm}${h < 12 ? 'am' : 'pm'}`;
}

// ---------- people ----------
function listPeople({ includeInactive = false } = {}) {
  const rows = db.prepare(`SELECT * FROM people ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY is_open, sort, name`).all();
  const userColor = users.prepare('SELECT name, username, color FROM users WHERE id = ?');
  return rows.map(p => {
    const u = p.user_id ? userColor.get(p.user_id) : null;
    return { ...p, color: u ? u.color : p.color, login: u ? u.username : null };
  });
}

app.get('/api/people', requireUser, (req, res) => {
  const list = listPeople({ includeInactive: req.query.all === '1' });
  res.json(list.map(p => (req.user.is_admin || p.id === req.user.person_id ? p : { ...p, notes: undefined })));
});

app.get('/api/logins', requireAdmin, (req, res) => {
  res.json(users.prepare('SELECT id, name, username, color FROM users WHERE active = 1 ORDER BY name').all());
});

app.post('/api/people', requireAdmin, (req, res) => {
  const { name, color, user_id } = req.body || {};
  if (!String(name || '').trim()) return res.status(400).json({ error: 'Name is required' });
  const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 s FROM people WHERE is_open = 0').get().s;
  const id = db.prepare('INSERT INTO people (name, color, user_id, sort) VALUES (?, ?, ?, ?)')
    .run(String(name).trim(), color || '#7357a4', user_id || null, sort).lastInsertRowid;
  logChange(req.user, `Added ${String(name).trim()} to the schedule`);
  res.json({ id });
});

app.put('/api/people/:id', requireAdmin, (req, res) => {
  const p = db.prepare('SELECT * FROM people WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const next = {
    name: b.name !== undefined ? String(b.name).trim() || p.name : p.name,
    color: b.color || p.color,
    user_id: b.user_id !== undefined ? (b.user_id || null) : p.user_id,
    active: b.active !== undefined ? (b.active ? 1 : 0) : p.active,
    sort: Number.isInteger(b.sort) ? b.sort : p.sort,
    notes: b.notes !== undefined ? String(b.notes || '').trim().slice(0, 4000) : p.notes,
  };
  db.prepare('UPDATE people SET name = @name, color = @color, user_id = @user_id, active = @active, sort = @sort, notes = @notes WHERE id = @id')
    .run({ ...next, id: p.id });
  if (b.notes !== undefined && next.notes !== p.notes) logChange(req.user, `Updated notes for ${next.name}`);
  res.json({ ok: true });
});

// ---------- grid ----------
const peopleById = () => new Map(listPeople({ includeInactive: true }).map(p => [p.id, p]));

function weekData(monday) {
  const days = Array.from({ length: 7 }, (_, i) => ({ date: addDays(monday, i), name: DAY_NAMES[i] }));
  const rows = db.prepare('SELECT date, slot, lane, person_id, note FROM cells WHERE date BETWEEN ? AND ?').all(days[0].date, days[6].date);
  const cells = {};
  for (const r of rows) putCell(cells, r.date, r);
  return { start: monday, days, cells, totals: totals(rows), templateWeek: templateWeekFor(monday) };
}

// cells[key][slot][lane] = { p, n }
function putCell(cells, key, r) {
  const day = cells[key] = cells[key] || {};
  (day[r.slot] = day[r.slot] || {})[r.lane] = { p: r.person_id, n: r.note };
}

function totals(rows) {
  const people = peopleById();
  const t = {};
  for (const r of rows) {
    const p = r.person_id && people.get(r.person_id);
    if (p && !p.is_open) t[p.id] = (t[p.id] || 0) + 0.5;
  }
  return t;
}

app.get('/api/week', requireUser, (req, res) => {
  const start = mondayOf(isDate(req.query.start) ? req.query.start : today());
  res.json({ ...weekData(start), today: today(), slots: SLOT_COUNT, lanes: LANES, firstSlotMin: FIRST_SLOT_MIN });
});

app.get('/api/template', requireUser, (req, res) => {
  const week = req.query.week === 'B' ? 'B' : 'A';
  const rows = db.prepare('SELECT dow, slot, lane, person_id, note FROM template_cells WHERE week = ?').all(week);
  const cells = {};
  for (const r of rows) putCell(cells, `${week}:${r.dow}`, r);
  const days = DAY_NAMES.map((name, dow) => ({ date: `${week}:${dow}`, name }));
  res.json({ week, days, cells, totals: totals(rows), slots: SLOT_COUNT, lanes: LANES, firstSlotMin: FIRST_SLOT_MIN });
});

// Sets person and/or note on a batch of cells (one paint stroke). `key` is a
// date for the real schedule, or "A:0".."B:6" for the permanent template;
// `lane` (0–2) is which of the day's three columns.
// Returns the previous values so the page can undo the stroke.
app.post('/api/cells', requireAdmin, (req, res) => {
  const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
  if (!items.length || items.length > 2000) return res.status(400).json({ error: 'Nothing to save' });
  const people = peopleById();
  const now = new Date().toISOString();
  const previous = [];
  const getCell = db.prepare('SELECT person_id, note FROM cells WHERE date = ? AND slot = ? AND lane = ?');
  const getT = db.prepare('SELECT person_id, note FROM template_cells WHERE week = ? AND dow = ? AND slot = ? AND lane = ?');
  const upCell = db.prepare(`INSERT INTO cells (date, slot, lane, person_id, note, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, slot, lane) DO UPDATE SET person_id = excluded.person_id, note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at`);
  const delCell = db.prepare('DELETE FROM cells WHERE date = ? AND slot = ? AND lane = ?');
  const upT = db.prepare(`INSERT INTO template_cells (week, dow, slot, lane, person_id, note) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(week, dow, slot, lane) DO UPDATE SET person_id = excluded.person_id, note = excluded.note`);
  const delT = db.prepare('DELETE FROM template_cells WHERE week = ? AND dow = ? AND slot = ? AND lane = ?');
  // Someone can't be in two lanes at the same half hour ("Open shift" can).
  const dupCell = db.prepare('SELECT 1 FROM cells WHERE date = ? AND slot = ? AND lane != ? AND person_id = ?');
  const dupT = db.prepare('SELECT 1 FROM template_cells WHERE week = ? AND dow = ? AND slot = ? AND lane != ? AND person_id = ?');

  try {
    db.transaction(() => {
      for (const it of items) {
        const slot = Number(it.slot);
        const lane = Number(it.lane || 0);
        if (!Number.isInteger(slot) || slot < 0 || slot >= SLOT_COUNT) throw new Error('Bad time slot');
        if (!Number.isInteger(lane) || lane < 0 || lane >= LANES) throw new Error('Bad column');
        if (it.person_id != null && !people.has(Number(it.person_id))) throw new Error('Unknown person');
        const tm = /^([AB]):([0-6])$/.exec(String(it.key));
        if (!tm && !isDate(it.key)) throw new Error('Bad day');
        const old = (tm ? getT.get(tm[1], Number(tm[2]), slot, lane) : getCell.get(it.key, slot, lane)) || { person_id: null, note: '' };
        previous.push({ key: it.key, slot, lane, person_id: old.person_id, note: old.note });
        const person = it.person_id !== undefined ? (it.person_id == null ? null : Number(it.person_id)) : old.person_id;
        const note = it.note !== undefined ? String(it.note || '').trim().slice(0, 60) : old.note;
        if (person != null && person !== old.person_id && !people.get(person).is_open &&
            (tm ? dupT.get(tm[1], Number(tm[2]), slot, lane, person) : dupCell.get(it.key, slot, lane, person))) {
          throw new Error(`${people.get(person).name} is already on at ${slotLabel(slot)}`);
        }
        if (tm) {
          if (person == null && !note) delT.run(tm[1], Number(tm[2]), slot, lane);
          else upT.run(tm[1], Number(tm[2]), slot, lane, person, note);
        } else if (person == null && !note) delCell.run(it.key, slot, lane);
        else upCell.run(it.key, slot, lane, person, note, req.user.name, now);
      }
    })();
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (req.body.log !== false) logChange(req.user, describeStroke(items, people));
  res.json({ ok: true, previous });
});

// "Megan: Mon 10/26 6:00am–11:00am" — one line per day, contiguous slots joined.
function describeStroke(items, people) {
  const byKey = new Map();
  for (const it of items) {
    if (!byKey.has(it.key)) byKey.set(it.key, []);
    byKey.get(it.key).push(it);
  }
  const parts = [];
  for (const [key, list] of byKey) {
    const slots = [...new Set(list.map(i => Number(i.slot)))].sort((a, b) => a - b);
    const ranges = [];
    for (const s of slots) {
      const last = ranges[ranges.length - 1];
      if (last && s === last[1] + 1) last[1] = s; else ranges.push([s, s]);
    }
    const tm = /^([AB]):([0-6])$/.exec(key);
    const day = tm ? `permanent week ${tm[1]} ${DAY_NAMES[Number(tm[2])].slice(0, 3)}` :
      `${DAY_NAMES[(toUTC(key).getUTCDay() + 6) % 7].slice(0, 3)} ${Number(key.slice(5, 7))}/${Number(key.slice(8))}`;
    const first = list[0];
    const what = first.person_id !== undefined
      ? (first.person_id == null ? 'cleared' : (people.get(Number(first.person_id)) || {}).name || 'someone')
      : `note "${String(first.note || '').trim() || '(removed)'}"`;
    parts.push(`${what}: ${day} ${ranges.map(([a, b]) => `${slotLabel(a)}–${slotLabel(b, true)}`).join(', ')}`);
  }
  return parts.join('; ');
}

// Puts a copied cell into an empty slot+lane, skipping anyone who is already
// on at that half hour in another lane (fill-empty mode can collide).
function fillCell(userName, now) {
  const ins = db.prepare(`INSERT INTO cells (date, slot, lane, person_id, note, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, slot, lane) DO NOTHING`);
  const dup = db.prepare('SELECT 1 FROM cells c JOIN people p ON p.id = c.person_id WHERE c.date = ? AND c.slot = ? AND c.person_id = ? AND p.is_open = 0');
  return (date, r) => {
    if (r.person_id && dup.get(date, r.slot, r.person_id)) return;
    ins.run(date, r.slot, r.lane, r.person_id, r.note, userName, now);
  };
}

// Fill a week from the permanent schedule. mode "replace" overwrites the
// whole week; "fill" only fills empty slots.
app.post('/api/week/apply-template', requireAdmin, (req, res) => {
  const { start, week, mode } = req.body || {};
  if (!isDate(start) || !['A', 'B'].includes(week)) return res.status(400).json({ error: 'Pick a week and A or B' });
  const monday = mondayOf(start);
  const rows = db.prepare('SELECT dow, slot, lane, person_id, note FROM template_cells WHERE week = ?').all(week);
  const now = new Date().toISOString();
  db.transaction(() => {
    if (mode === 'replace') db.prepare('DELETE FROM cells WHERE date BETWEEN ? AND ?').run(monday, addDays(monday, 6));
    const fill = fillCell(req.user.name, now);
    for (const r of rows) fill(addDays(monday, r.dow), r);
  })();
  logChange(req.user, `${mode === 'replace' ? 'Replaced' : 'Filled empty slots in'} the week of ${monday} from permanent week ${week}`);
  res.json(weekData(monday));
});

app.post('/api/week/copy', requireAdmin, (req, res) => {
  const { from, to, mode } = req.body || {};
  if (!isDate(from) || !isDate(to)) return res.status(400).json({ error: 'Pick both weeks' });
  const src = mondayOf(from), dst = mondayOf(to);
  if (src === dst) return res.status(400).json({ error: 'That is the same week' });
  const rows = db.prepare('SELECT date, slot, lane, person_id, note FROM cells WHERE date BETWEEN ? AND ?').all(src, addDays(src, 6));
  const now = new Date().toISOString();
  db.transaction(() => {
    if (mode === 'replace') db.prepare('DELETE FROM cells WHERE date BETWEEN ? AND ?').run(dst, addDays(dst, 6));
    const fill = fillCell(req.user.name, now);
    const offset = Math.round((toUTC(dst) - toUTC(src)) / 86400000);
    for (const r of rows) fill(addDays(r.date, offset), r);
  })();
  logChange(req.user, `Copied the week of ${src} to the week of ${dst}${mode === 'replace' ? ' (replaced)' : ' (empty slots only)'}`);
  res.json(weekData(dst));
});

// A person's shifts as time ranges, for the "My shifts" view.
app.get('/api/shifts', requireUser, (req, res) => {
  const personId = Number(req.query.person_id || req.user.person_id);
  if (!personId) return res.json({ shifts: [], note: 'Your login is not linked to anyone on the schedule yet.' });
  const from = isDate(req.query.from) ? req.query.from : today();
  const to = isDate(req.query.to) ? req.query.to : addDays(from, 20);
  const rows = db.prepare(`SELECT date, slot, GROUP_CONCAT(NULLIF(note, ''), ', ') note FROM cells
    WHERE person_id = ? AND date BETWEEN ? AND ? GROUP BY date, slot ORDER BY date, slot`).all(personId, from, to);
  const shifts = [];
  for (const r of rows) {
    const last = shifts[shifts.length - 1];
    if (last && last.date === r.date && last.endSlot === r.slot - 1) {
      last.endSlot = r.slot;
      if (r.note && !last.notes.includes(r.note)) last.notes.push(r.note);
    } else shifts.push({ date: r.date, startSlot: r.slot, endSlot: r.slot, notes: r.note ? [r.note] : [] });
  }
  res.json({
    person_id: personId, from, to,
    shifts: shifts.map(s => ({
      ...s, day: DAY_NAMES[(toUTC(s.date).getUTCDay() + 6) % 7],
      start: slotLabel(s.startSlot), end: slotLabel(s.endSlot, true), hours: (s.endSlot - s.startSlot + 1) / 2,
    })),
  });
});

// ---------- activity + settings ----------
function logChange(user, summary) {
  if (summary) db.prepare('INSERT INTO changes (user_name, summary) VALUES (?, ?)').run(user.name, summary.slice(0, 1000));
}

app.get('/api/changes', requireUser, (req, res) => {
  res.json(db.prepare('SELECT * FROM changes ORDER BY id DESC LIMIT 300').all());
});

app.get('/api/settings', requireUser, (req, res) => res.json(getSettings()));

app.put('/api/settings', requireAdmin, (req, res) => {
  const { week_a_anchor } = req.body || {};
  if (week_a_anchor !== undefined) {
    if (!isDate(week_a_anchor)) return res.status(400).json({ error: 'Pick a date' });
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(mondayOf(week_a_anchor), 'week_a_anchor');
  }
  res.json(getSettings());
});

require('./chat')(app, { requireUser, listPeople, today, addDays, mondayOf, templateWeekFor, slotLabel, DAY_NAMES, isDate, toUTC });

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.listen(PORT, '127.0.0.1', () => console.log(`motherpuppers-schedules on 127.0.0.1:${PORT}`));
