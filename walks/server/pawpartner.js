// Reads the day's dogs from the PawPartner business dashboard. PawPartner has no API,
// so this signs in like the website does and parses the dashboard's three tables
// (Checking In, Current Guests, Checking Out).
const BASE = 'https://pawpartner.com';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const TABLES = ['pl-checking-in-table', 'pl-checked-in-table', 'pl-checking-out-table'];

const cookies = new Map();

function keepCookies(res) {
  for (const c of res.headers.getSetCookie()) {
    const kv = c.split(';')[0];
    const i = kv.indexOf('=');
    if (i > 0) cookies.set(kv.slice(0, i).trim(), kv.slice(i + 1));
  }
}

async function request(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
    headers: { 'User-Agent': UA, Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...(opts.headers || {}) },
  });
  keepCookies(res);
  return res;
}

const decode = (s) => String(s || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');
const strip = (s) => decode(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

async function login() {
  const email = process.env.PAWPARTNER_EMAIL;
  const password = process.env.PAWPARTNER_PASSWORD;
  if (!email || !password) throw new Error('PawPartner login is not set up');
  cookies.clear();
  const page = await (await request(`${BASE}/user/login`)).text();
  const token = /name="jr_html_form_token" value="([^"]+)"/.exec(page);
  if (!token) throw new Error('PawPartner login page changed');
  const form = new FormData();
  form.set('jr_html_form_token', token[1]);
  form.set('user_remember', 'on');
  form.set('user_email_or_name', email);
  form.set('user_password', password);
  const res = await request(`${BASE}/user/login_save`, { method: 'POST', body: form, headers: { 'X-Requested-With': 'XMLHttpRequest' } });
  const out = await res.json().catch(() => ({}));
  if (!out.redirect) throw new Error(`PawPartner sign-in failed${out.notice ? `: ${strip(out.notice)}` : ''}`);
}

async function dashboardHtml(date) {
  const url = `${BASE}/pz/dashboard/profile_id=${process.env.PAWPARTNER_PROFILE_ID}/date=${date.replace(/-/g, '')}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await request(url);
    const html = res.status === 200 ? await res.text() : '';
    if (html.includes(`id="${TABLES[0]}"`)) return html;
    await login();
  }
  throw new Error('Could not open the PawPartner dashboard');
}

// "10/22 10:28AM" → { date: '2026-10-22', time: '10:28' }, picking the year closest to the day being synced.
function stamp(md, time, ref) {
  const [m, d] = md.split('/').map(Number);
  const refYear = Number(ref.slice(0, 4));
  const pad = (n) => String(n).padStart(2, '0');
  const candidates = [refYear - 1, refYear, refYear + 1].map((y) => `${y}-${pad(m)}-${pad(d)}`);
  const refMs = Date.parse(ref);
  const date = candidates.sort((a, b) => Math.abs(Date.parse(a) - refMs) - Math.abs(Date.parse(b) - refMs))[0];
  let t = null;
  const tm = /^(\d{1,2}):(\d{2})([AP]M)$/.exec(time || '');
  if (tm) t = `${pad((Number(tm[1]) % 12) + (tm[3] === 'PM' ? 12 : 0))}:${tm[2]}`;
  return { date, time: t };
}

// Grooming visits (bath, haircut, nails) are short appointments, not stays, so they get no walk row.
const isGrooming = (service, area) => /^grooming/i.test(area) || /groom|bath|brush|haircut|nail|trim|deshed/i.test(service);

function parseDashboard(html, date) {
  const dogs = new Map();
  for (const table of TABLES) {
    const start = html.indexOf(`id="${table}"`);
    if (start < 0) continue;
    const body = html.slice(start, html.indexOf('</table>', start));
    for (const row of body.matchAll(/<tr id="res_id_row_(\d+)"([^>]*)>([\s\S]*?)<\/tr>/g)) {
      const [, resId, attrs, cells] = row;
      const attr = (n) => { const m = new RegExp(`${n}="([^"]*)"`).exec(attrs); return m ? decode(m[1]) : ''; };
      const pet = /\/pet\/(\d+)\//.exec(cells);
      if (!pet) continue;
      const petId = Number(pet[1]);
      if (dogs.has(petId)) continue;

      const info = /class="dtc3">([\s\S]*?)<\/td>/.exec(cells);
      const lines = info ? info[1].split(/<br\s*\/?>/i).map(strip).filter(Boolean) : [];
      const service = attr('data-service') || lines[0] || '';
      const range = lines[1] || '';
      const area = lines[2] || '';
      if (isGrooming(service, area)) continue;

      // Stays read "10/22 10:28AM - 10/30 5:00PM"; keep only dogs whose stay includes this date.
      let arrives = null, leaves = null;
      const r = /^(\d{1,2}\/\d{1,2})\s+(\d{1,2}:\d{2}[AP]M)\s*-\s*(\d{1,2}\/\d{1,2})\s+(\d{1,2}:\d{2}[AP]M)/.exec(range);
      if (r) {
        const a = stamp(r[1], r[2], date);
        const l = stamp(r[3], r[4], date);
        if (a.date > date || l.date < date) continue;
        if (a.date === date) arrives = a.time;
        if (l.date === date) leaves = l.time;
      }

      const name = decode(attr('data-pet')) || strip((/<h3>([\s\S]*?)<\/h3>/.exec(cells) || [])[1]);
      const owner = strip((/pl-pet-owner-small"><a[^>]*>([\s\S]*?)<\/a>/.exec(cells) || [])[1]);
      const filter = attr('data-filter');
      const first = name.split(' ')[0];
      const breed = filter.startsWith(first) && owner && filter.includes(owner)
        ? filter.slice(first.length, filter.indexOf(owner)).trim() : '';
      const photo = /<img[^>]*src="(https:\/\/pawpartner\.com\/s3\/image\/[^"]+)"[^>]*class="pl-res-pet-img"/.exec(cells);
      dogs.set(petId, {
        pet_id: petId,
        reservation_id: Number(resId),
        name,
        breed,
        owner,
        service,
        kennel: area.includes(':') ? area.split(':').slice(1).join(':').trim() : area,
        status: strip((/<b>([\s\S]*?)<\/b>/.exec(cells) || [])[1]),
        arrives,
        leaves,
        photo_url: photo ? decode(photo[1]) : null,
      });
    }
  }
  return [...dogs.values()];
}

async function dogsFor(date) {
  return parseDashboard(await dashboardHtml(date), date);
}

// Pet photos sit behind a PawPartner link that redirects to the full-size image on S3.
async function fetchPhoto(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`photo ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { dogsFor, fetchPhoto, parseDashboard };
