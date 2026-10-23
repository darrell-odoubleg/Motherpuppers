require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const express = require('express');
const session = require('express-session');
const { db, hashPassword, checkPassword } = require('./db');

const PORT = process.env.PORT || 4200;
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
  return db.prepare('SELECT id, name, username, is_admin, can_edit FROM users WHERE id = ? AND active = 1').get(req.session.userId) || null;
}

function requireUser(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'Not signed in' });
  req.user = u;
  next();
}

function requireEditor(req, res, next) {
  requireUser(req, res, () => {
    if (!req.user.can_edit && !req.user.is_admin) return res.status(403).json({ error: 'View-only account' });
    next();
  });
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

// ---------- project ----------
const STATUSES = ['', 'Not started', 'In progress', 'On hold', 'Complete', 'N/A'];
const TEXT_FIELDS = ['task', 'assigned', 'start_date', 'end_date', 'status', 'comments'];
const MONEY_FIELDS = ['budget', 'paid'];

function fmtMoney(c) { return c == null ? '' : '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2 }); }

function logChange(user, section, task, field, oldV, newV) {
  db.prepare('INSERT INTO activity (user_id, user_name, section, task, field, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(user.id, user.name, section, task, field, oldV == null ? '' : String(oldV), newV == null ? '' : String(newV));
}

app.get('/api/project', requireUser, (req, res) => {
  const sections = db.prepare('SELECT * FROM sections ORDER BY sort, id').all();
  const tasks = db.prepare(`
    SELECT t.*, u.name updated_by_name FROM tasks t LEFT JOIN users u ON u.id = t.updated_by
    ORDER BY t.sort, t.id`).all();
  res.json({
    statuses: STATUSES,
    sections: sections.map((s) => ({ ...s, tasks: tasks.filter((t) => t.section_id === s.id) })),
  });
});

// Money comes in as dollars (string or number); "" / null clears it.
function parseMoney(v) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n)) throw new Error('Not a number');
  return Math.round(n * 100);
}

function cleanText(field, v) {
  v = String(v == null ? '' : v).trim().slice(0, 2000);
  if ((field === 'start_date' || field === 'end_date') && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('Bad date');
  if (field === 'status' && !STATUSES.includes(v)) throw new Error('Bad status');
  if (field === 'task' && !v) throw new Error('Task name is required');
  return v;
}

app.patch('/api/tasks/:id', requireEditor, (req, res) => {
  const t = db.prepare('SELECT t.*, s.name section_name FROM tasks t JOIN sections s ON s.id = t.section_id WHERE t.id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const body = req.body || {};
  const updates = {};
  try {
    for (const f of TEXT_FIELDS) if (f in body) updates[f] = cleanText(f, body[f]);
    for (const f of MONEY_FIELDS) if (f in body) updates[f] = parseMoney(body[f]);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const changed = Object.keys(updates).filter((f) => updates[f] !== t[f]);
  if (changed.length) {
    db.transaction(() => {
      db.prepare(`UPDATE tasks SET ${changed.map((f) => `${f} = @${f}`).join(', ')},
        updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), updated_by = @uid WHERE id = @id`)
        .run({ ...Object.fromEntries(changed.map((f) => [f, updates[f]])), uid: req.user.id, id: t.id });
      for (const f of changed) {
        const money = MONEY_FIELDS.includes(f);
        logChange(req.user, t.section_name, updates.task || t.task, f, money ? fmtMoney(t[f]) : t[f], money ? fmtMoney(updates[f]) : updates[f]);
      }
    })();
  }
  res.json(db.prepare('SELECT t.*, u.name updated_by_name FROM tasks t LEFT JOIN users u ON u.id = t.updated_by WHERE t.id = ?').get(t.id));
});

app.post('/api/sections/:id/tasks', requireEditor, (req, res) => {
  const s = db.prepare('SELECT * FROM sections WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  let name;
  try { name = cleanText('task', (req.body || {}).task); } catch (e) { return res.status(400).json({ error: e.message }); }
  const sort = (db.prepare('SELECT MAX(sort) m FROM tasks WHERE section_id = ?').get(s.id).m || 0) + 10;
  const id = db.prepare(`INSERT INTO tasks (section_id, task, sort, updated_at, updated_by)
    VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), ?)`).run(s.id, name, sort, req.user.id).lastInsertRowid;
  logChange(req.user, s.name, name, 'added', '', name);
  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
});

app.delete('/api/tasks/:id', requireEditor, (req, res) => {
  const t = db.prepare('SELECT t.*, s.name section_name FROM tasks t JOIN sections s ON s.id = t.section_id WHERE t.id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM tasks WHERE id = ?').run(t.id);
  logChange(req.user, t.section_name, t.task, 'deleted', `${t.assigned} ${fmtMoney(t.budget)}`.trim(), '');
  res.json({ ok: true });
});

// Drag-to-arrange: ids is the full new order of one section. A task coming from
// another section is moved into it; the source section's order is still valid.
app.put('/api/sections/:id/order', requireEditor, (req, res) => {
  const s = db.prepare('SELECT * FROM sections WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const ids = Array.isArray((req.body || {}).ids) ? req.body.ids.map(Number) : null;
  if (!ids || !ids.length || new Set(ids).size !== ids.length) return res.status(400).json({ error: 'Bad order' });
  const find = db.prepare('SELECT t.id, t.task, t.section_id, s.name section_name FROM tasks t JOIN sections s ON s.id = t.section_id WHERE t.id = ?');
  const before = ids.map((id) => find.get(id));
  if (before.some((t) => !t)) return res.status(400).json({ error: 'Unknown line item — reload the page' });
  const current = db.prepare('SELECT id FROM tasks WHERE section_id = ?').all(s.id).map((r) => r.id);
  if (current.some((id) => !ids.includes(id))) return res.status(409).json({ error: 'This section changed — reload the page' });

  const moved = before.find((t) => t.id === Number(req.body.moved));
  const oldPos = moved && moved.section_id === s.id
    ? db.prepare('SELECT COUNT(*) n FROM tasks WHERE section_id = ? AND (sort < (SELECT sort FROM tasks WHERE id = ?) OR (sort = (SELECT sort FROM tasks WHERE id = ?) AND id < ?))').get(s.id, moved.id, moved.id, moved.id).n + 1
    : null;
  const upd = db.prepare('UPDATE tasks SET section_id = ?, sort = ? WHERE id = ?');
  db.transaction(() => {
    ids.forEach((id, i) => upd.run(s.id, (i + 1) * 10, id));
    if (moved) {
      const from = moved.section_id === s.id ? `#${oldPos}` : `${moved.section_name}`;
      logChange(req.user, s.name, moved.task, 'moved', from, `#${ids.indexOf(moved.id) + 1}${moved.section_id === s.id ? '' : ` in ${s.name}`}`);
    }
  })();
  res.json({ ok: true });
});

app.post('/api/sections', requireEditor, (req, res) => {
  const name = String((req.body || {}).name || '').trim().slice(0, 200);
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const sort = (db.prepare('SELECT MAX(sort) m FROM sections').get().m || 0) + 10;
  const id = db.prepare('INSERT INTO sections (name, sort) VALUES (?, ?)').run(name, sort).lastInsertRowid;
  logChange(req.user, name, '', 'section added', '', name);
  res.json({ id, name, sort, tasks: [] });
});

app.patch('/api/sections/:id', requireEditor, (req, res) => {
  const s = db.prepare('SELECT * FROM sections WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const name = String((req.body || {}).name || '').trim().slice(0, 200);
  if (!name) return res.status(400).json({ error: 'Name is required' });
  db.prepare('UPDATE sections SET name = ? WHERE id = ?').run(name, s.id);
  if (name !== s.name) logChange(req.user, name, '', 'section renamed', s.name, name);
  res.json({ ok: true });
});

app.delete('/api/sections/:id', requireAdmin, (req, res) => {
  const s = db.prepare('SELECT * FROM sections WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const n = db.prepare('SELECT COUNT(*) n FROM tasks WHERE section_id = ?').get(s.id).n;
  db.prepare('DELETE FROM sections WHERE id = ?').run(s.id);
  logChange(req.user, s.name, '', 'section deleted', `${n} line items`, '');
  res.json({ ok: true });
});

// Exports only carry line items that have a price (budget or paid) filled in.
function pricedRows() {
  return db.prepare(`SELECT s.name section, t.* FROM tasks t JOIN sections s ON s.id = t.section_id
    WHERE t.budget IS NOT NULL OR t.paid IS NOT NULL ORDER BY s.sort, s.id, t.sort, t.id`).all()
    .map((r) => ({ ...r, due: (r.budget || 0) - (r.paid || 0) }));
}
const exportName = (ext) => `mother-puppers-construction-${new Date().toISOString().slice(0, 10)}.${ext}`;

app.get('/api/export.csv', requireUser, (req, res) => {
  const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const m = (c) => (c == null ? '' : (c / 100).toFixed(2));
  const lines = [['Section', 'Task', 'Assigned To', 'Start Date', 'End Date', 'Status', 'Budget', 'Already Paid', 'Due', 'Comments'].map(q).join(',')];
  for (const r of pricedRows()) {
    lines.push([r.section, r.task, r.assigned, r.start_date, r.end_date, r.status, m(r.budget), m(r.paid), m(r.due), r.comments].map(q).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${exportName('csv')}"`);
  res.send(lines.join('\r\n'));
});

app.get('/api/export.pdf', requireUser, (req, res) => {
  const PDFDocument = require('pdfkit');
  const rows = pricedRows();
  const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 36, bufferPages: true,
    info: { Title: 'Mother Puppers Construction — Priced Line Items' } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${exportName('pdf')}"`);
  doc.pipe(res);

  const PURPLE = '#7357a4', LINE = '#e5e0ec', MUTED = '#6b6775', INK = '#2a2a2a';
  const left = 36, width = 720, bottom = 612 - 36 - 14;
  const cols = [
    { k: 'task', h: 'Task', w: 180 },
    { k: 'assigned', h: 'Assigned to', w: 110 },
    { k: 'status', h: 'Status', w: 66 },
    { k: 'budget', h: 'Budget', w: 72, money: true },
    { k: 'paid', h: 'Already paid', w: 72, money: true },
    { k: 'due', h: 'Due', w: 72, money: true },
    { k: 'comments', h: 'Comments', w: 148 },
  ];
  const PAD = 4;
  const cellText = (r, c) => (c.money ? fmtMoney(r[c.k]) : String(r[c.k] || ''));
  const sums = (list) => list.reduce((a, r) => ({ budget: a.budget + (r.budget || 0), paid: a.paid + (r.paid || 0), due: a.due + r.due }), { budget: 0, paid: 0, due: 0 });

  function drawRow(cells, { bold, fill, color = INK, size = 8.5, header = true } = {}) {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
    const h = Math.max(...cols.map((c, i) => doc.heightOfString(cells[i] || ' ', { width: c.w - PAD * 2 }))) + PAD * 2;
    if (doc.y + h > bottom) { doc.addPage(); if (header) drawHeader(); doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size); }
    const y = doc.y;
    if (fill) doc.rect(left, y, width, h).fill(fill);
    let x = left;
    cols.forEach((c, i) => {
      doc.fillColor(color).text(cells[i] || '', x + PAD, y + PAD, { width: c.w - PAD * 2, align: c.money ? 'right' : 'left' });
      x += c.w;
    });
    doc.moveTo(left, y + h).lineTo(left + width, y + h).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.x = left;
    doc.y = y + h;
  }
  const drawHeader = () => drawRow(cols.map((c) => c.h), { bold: true, fill: PURPLE, color: '#ffffff', size: 8 });

  // title block
  const logo = path.join(__dirname, '..', 'public', 'logo.png');
  doc.image(logo, left, 30, { height: 48 });
  doc.font('Helvetica-Bold').fontSize(16).fillColor(INK).text('Construction project — priced line items', left + 110, 38, { width: width - 110, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED)
    .text(`${rows.length} line items · exported ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'long', day: 'numeric', year: 'numeric' })}`, left + 110, 60, { width: width - 110, align: 'right' });
  doc.x = left;
  doc.y = 92;

  const total = sums(rows);
  if (!rows.length) {
    doc.font('Helvetica').fontSize(11).fillColor(MUTED).text('No line items have a price yet.', left, doc.y);
  } else {
    drawHeader();
    let i = 0;
    while (i < rows.length) {
      const section = rows[i].section;
      const group = [];
      while (i < rows.length && rows[i].section === section) group.push(rows[i++]);
      if (doc.y + 40 > bottom) { doc.addPage(); drawHeader(); }
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(PURPLE).text(section, left + PAD, doc.y + 6, { width: width - PAD * 2 });
      doc.x = left;
      doc.y += 2;
      for (const r of group) drawRow(cols.map((c) => cellText(r, c)));
      const s = sums(group);
      drawRow(['Section total', '', '', fmtMoney(s.budget), fmtMoney(s.paid), fmtMoney(s.due), ''], { bold: true, fill: '#faf8fc' });
    }
    doc.y += 8;
    drawRow(['Grand total', '', '', fmtMoney(total.budget), fmtMoney(total.paid), fmtMoney(total.due), ''], { bold: true, fill: PURPLE, color: '#ffffff', size: 9.5, header: false });
  }

  // page numbers
  const range = doc.bufferedPageRange();
  for (let p = range.start; p < range.start + range.count; p++) {
    doc.switchToPage(p);
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
      .text(`Mother Puppers · page ${p + 1} of ${range.count}`, left, 612 - 30, { width, align: 'right', lineBreak: false });
  }
  doc.end();
});

// ---------- admin ----------
app.get('/api/activity', requireUser, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  res.json(db.prepare('SELECT * FROM activity ORDER BY id DESC LIMIT ?').all(limit));
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, name, username, is_admin, can_edit, active, created_at FROM users ORDER BY active DESC, name').all());
});

app.post('/api/admin/users', requireAdmin, (req, res) => {
  const { name, username, password, can_edit, is_admin } = req.body || {};
  if (!String(name || '').trim() || !String(username || '').trim()) return res.status(400).json({ error: 'Name and username are required' });
  if (String(password || '').length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  try {
    db.prepare('INSERT INTO users (name, username, pass_hash, can_edit, is_admin) VALUES (?, ?, ?, ?, ?)')
      .run(String(name).trim(), String(username).trim(), hashPassword(password), can_edit ? 1 : 0, is_admin ? 1 : 0);
  } catch (e) {
    return res.status(400).json({ error: /UNIQUE/.test(e.message) ? 'That username is taken' : e.message });
  }
  res.json({ ok: true });
});

app.patch('/api/admin/users/:id', requireAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  if (u.id === req.user.id && (b.active === false || b.is_admin === false)) return res.status(400).json({ error: "You can't remove your own admin access" });
  if ('name' in b && String(b.name).trim()) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(String(b.name).trim(), u.id);
  if ('can_edit' in b) db.prepare('UPDATE users SET can_edit = ? WHERE id = ?').run(b.can_edit ? 1 : 0, u.id);
  if ('is_admin' in b) db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(b.is_admin ? 1 : 0, u.id);
  if ('active' in b) db.prepare('UPDATE users SET active = ? WHERE id = ?').run(b.active ? 1 : 0, u.id);
  if (b.password) {
    if (String(b.password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(b.password), u.id);
  }
  res.json({ ok: true });
});

// ---------- static ----------
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

app.listen(PORT, '127.0.0.1', () => console.log(`motherpuppers-project on 127.0.0.1:${PORT}`));
