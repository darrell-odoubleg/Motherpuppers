// One sign-in for all the Mother Puppers staff sites (cleaning, schedules, walks and the
// app.motherpuppers.net shell). A signed cookie on .motherpuppers.net carries the user id;
// each site checks it against the cleaning app's users table on every request, so turning
// someone off or changing their password signs them out everywhere.
const crypto = require('crypto');

const COOKIE = 'mp_auth';
const MAX_AGE = 14 * 86400000;
const RENEW_AFTER = 86400000;
// The sites a login can be given; admins always get all of them.
const APPS = ['walks', 'cleaning', 'schedule'];
const APP_NAMES = { walks: 'Dog walks', cleaning: 'Cleaning', schedule: 'Schedule' };

function secret() {
  const s = process.env.MP_AUTH_SECRET;
  if (!s) throw new Error('MP_AUTH_SECRET is not set');
  return s;
}
const sign = (data) => crypto.createHmac('sha256', secret()).update(data).digest('base64url');
// A short fingerprint of the password hash: a new password makes old cookies stop working.
const passTag = (hash) => sign(`pw:${hash}`).slice(0, 12);

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function cookieOptions() {
  return {
    domain: process.env.MP_AUTH_DOMAIN || undefined,
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === '1',
  };
}

function issue(res, user) {
  const body = Buffer.from(JSON.stringify({ u: user.id, p: passTag(user.pass_hash), t: Date.now() })).toString('base64url');
  res.cookie(COOKIE, `${body}.${sign(body)}`, { ...cookieOptions(), maxAge: MAX_AGE });
}

function clear(res) {
  res.clearCookie(COOKIE, cookieOptions());
}

function parseApps(value, isAdmin) {
  if (isAdmin) return [...APPS];
  if (value == null) return [...APPS];
  try {
    const list = JSON.parse(value);
    if (Array.isArray(list)) return APPS.filter((a) => list.includes(a));
  } catch {}
  return [...APPS];
}

// The signed-in user (without pass_hash, with .apps), or null. Renews the cookie at most
// once a day, so it lasts 14 days from the last visit.
function userFrom(req, res, usersDb) {
  const raw = readCookie(req, COOKIE);
  if (!raw) return null;
  const [body, mac] = raw.split('.');
  if (!body || !mac) return null;
  const good = sign(body);
  if (mac.length !== good.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return null;
  let t;
  try { t = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  if (!t || !t.t || Date.now() - t.t > MAX_AGE) return null;
  const u = usersDb.prepare('SELECT id, name, username, color, is_admin, pass_hash, apps FROM users WHERE id = ? AND active = 1').get(t.u);
  if (!u || passTag(u.pass_hash) !== t.p) return null;
  if (res && Date.now() - t.t > RENEW_AFTER) issue(res, u);
  const { pass_hash: _, apps, ...user } = u;
  return { ...user, apps: parseApps(apps, u.is_admin) };
}

// Middleware: 401 when signed out, or when this login isn't allowed on this site
// (with a message, which the page shows on its sign-in form).
function requireApp(usersDb, app) {
  return (req, res, next) => {
    const u = userFrom(req, res, usersDb);
    if (!u) return res.status(401).json({ error: 'Not signed in' });
    if (!u.apps.includes(app)) return res.status(401).json({ error: `You don't have access to ${APP_NAMES[app]}. Ask an admin.`, no_access: true });
    req.user = u;
    next();
  };
}

// Same scheme as the cleaning app's db.js (salt:scrypt64).
function checkPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(String(pw), salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const MAX_FAILS = 8;
const WINDOW_MS = 15 * 60 * 1000;
const fails = new Map();

// POST /api/login for any of the sites. `app` is the site being signed into, or null
// for the app shell, which accepts anyone with at least one site.
function loginRoute(usersDb, app) {
  return (req, res) => {
    const now = Date.now();
    const entry = fails.get(req.ip);
    if (entry && now - entry.first < WINDOW_MS && entry.count >= MAX_FAILS) {
      return res.status(429).json({ error: 'Too many attempts — try again in 15 minutes' });
    }
    const { username, password } = req.body || {};
    const u = usersDb.prepare('SELECT id, pass_hash, is_admin, apps FROM users WHERE username = ? AND active = 1').get(String(username || '').trim());
    if (u && checkPassword(password, u.pass_hash)) {
      fails.delete(req.ip);
      const apps = parseApps(u.apps, u.is_admin);
      if (app ? !apps.includes(app) : !apps.length) {
        return res.status(403).json({ error: app ? `You don't have access to ${APP_NAMES[app]}. Ask an admin.` : "Your login isn't set up for any Mother Puppers app yet. Ask an admin." });
      }
      issue(res, u);
      return res.json({ ok: true, apps });
    }
    if (!entry || now - entry.first >= WINDOW_MS) fails.set(req.ip, { first: now, count: 1 });
    else entry.count += 1;
    res.status(401).json({ error: 'Wrong username or password' });
  };
}

function logoutRoute(req, res) {
  clear(res);
  res.json({ ok: true });
}

module.exports = { APPS, APP_NAMES, issue, clear, userFrom, requireApp, parseApps, checkPassword, loginRoute, logoutRoute };
