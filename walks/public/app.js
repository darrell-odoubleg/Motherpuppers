const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let me = null;
let day = null;     // last /api/day response
let viewDate = '';  // '' = today
let busy = false;
let scrolledFor = null;

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (res.status === 401) { showLogin(); throw new Error('Not signed in'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.add('hidden'), 2200);
}

const fmtDate = (iso, o) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', o);
// Clock times in the kennel's time zone, whatever the device is set to.
const fmtClock = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: (day && day.tz) || undefined });
const fmtHM = (hm) => { const [h, m] = hm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const initials = (n) => String(n || '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
function textOn(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#2a2a2a' : '#ffffff';
}
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const minutesOf = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };

// "Kennel 10" sorts after "Kennel 9".
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

function showLogin() {
  $('app').classList.add('hidden');
  $('login').classList.remove('hidden');
}

async function load(refresh) {
  if (busy) return;
  busy = true;
  try {
    const q = new URLSearchParams();
    if (viewDate) q.set('date', viewDate);
    if (refresh) q.set('refresh', '1');
    day = await api(`/api/day?${q}`);
    render();
  } catch (err) {
    if (err.message !== 'Not signed in') toast(err.message);
  } finally {
    busy = false;
  }
}

function slotState(dog, s) {
  // Dim the walks before a dog arrives or after it leaves today (still tappable).
  const start = s.hour * 60, end = start + 120;
  if (dog.arrives && end <= minutesOf(dog.arrives)) return 'off';
  if (dog.leaves && start >= minutesOf(dog.leaves)) return 'off';
  return '';
}

function markHtml(dog, s) {
  const m = (day.marks[dog.pet_id] || {})[s.slot];
  const dis = day.editable ? '' : 'disabled';
  const attrs = `data-pet="${dog.pet_id}" data-slot="${s.slot}" ${dis}`;
  if (!m) return `<button class="mark" ${attrs} aria-label="${esc(dog.name)} ${s.label}: not yet"></button>`;
  const title = `${m.mark === 'poop' ? 'Poop' : 'Outside / pee'} · ${m.name} · ${fmtClock(m.at)}`;
  const style = `--c:${m.color};--on:${textOn(m.color)}`;
  return `<button class="mark ${m.mark}" style="${style}" ${attrs} title="${esc(title)}" aria-label="${esc(dog.name)} ${s.label}: ${esc(title)}">${m.mark === 'walk' ? '✓' : ''}<span class="who">${esc(initials(m.name))}</span></button>`;
}

function render() {
  const d = day;
  const isToday = d.date === d.today;
  $('dateLine').textContent = fmtDate(d.date, { weekday: 'long', month: 'long', day: 'numeric' });
  $('next').disabled = isToday;
  $('todayBtn').hidden = isToday;
  $('refresh').hidden = !isToday;
  if (d.sync) {
    $('syncLine').textContent = d.sync.ok ? `From PawPartner · updated ${fmtClock(d.sync.at)}` : `PawPartner update failed at ${fmtClock(d.sync.at)}`;
  } else {
    $('syncLine').textContent = '';
  }

  const banner = $('banner');
  banner.className = 'banner hidden';
  if (d.sync && !d.sync.ok) {
    banner.className = 'banner err';
    banner.textContent = `Couldn't read PawPartner (${d.sync.error}). Showing the last list we have.`;
  } else if (!isToday) {
    banner.className = 'banner';
    banner.textContent = d.editable ? 'Past day — you can still fix marks as an admin.' : 'Past day (view only).';
  }

  const nowSlot = d.now_minutes == null ? -1 : d.slots.findIndex((s) => d.now_minutes >= s.hour * 60 && d.now_minutes < s.hour * 60 + 120);
  const dogs = [...d.dogs].sort((a, b) => natural(a.kennel || 'zzz', b.kennel || 'zzz') || natural(a.name, b.name));

  if (!dogs.length) {
    $('sheet').innerHTML = `<tbody><tr><td class="empty">${isToday ? 'No dogs staying today in PawPartner.' : 'No walk sheet for this day.'}</td></tr></tbody>`;
    $('foot').textContent = '';
    return;
  }

  const counts = d.slots.map((s) => dogs.filter((g) => (d.marks[g.pet_id] || {})[s.slot]).length);
  let html = `<thead><tr><th class="dogcol">${dogs.length} dog${dogs.length === 1 ? '' : 's'}</th>${d.slots.map((s, i) =>
    `<th class="${i === nowSlot ? 'now' : ''}">${s.label}<small>${counts[i]}/${dogs.length}</small></th>`).join('')}</tr></thead><tbody>`;
  let lastKennel = null;
  for (const g of dogs) {
    if (g.kennel !== lastKennel) {
      lastKennel = g.kennel;
      html += `<tr class="kennel"><th class="dogcol">${esc(g.kennel || 'No kennel')}</th><th colspan="${d.slots.length}"></th></tr>`;
    }
    const gone = g.gone ? ' <span class="tag">No longer in PawPartner</span>' : '';
    html += `<tr class="${g.gone ? 'gone' : ''}"><td class="dogcol"><div class="dog"><b>${esc(g.name)}</b>${gone}</div></td>`;
    html += d.slots.map((s, i) => `<td class="${[i === nowSlot ? 'now' : '', slotState(g, s)].join(' ').trim()}">${markHtml(g, s)}</td>`).join('');
    html += '</tr>';
  }
  $('sheet').innerHTML = html + '</tbody>';
  // On a narrow screen, start scrolled so the current walk time is in view.
  if (nowSlot > 0 && d.date !== scrolledFor) {
    scrolledFor = d.date;
    const wrap = document.querySelector('.sheet-wrap');
    const th = $('sheet').querySelectorAll('thead th')[nowSlot + 1];
    const dogW = $('sheet').querySelector('thead th').offsetWidth;
    if (th && th.offsetLeft + th.offsetWidth > wrap.clientWidth) wrap.scrollLeft = th.offsetLeft - dogW - 8;
  }
  $('foot').textContent = 'Dogs come from the PawPartner dashboard (boarding and daycare; grooming-only visits are left out). Dashed boxes are before the dog arrives or after it leaves.';
}

// Tap cycles empty → walk (✓) → poop (filled) → empty.
const NEXT = { '': 'walk', walk: 'poop', poop: '' };
$('sheet').addEventListener('click', async (e) => {
  const b = e.target.closest('.mark');
  if (!b || b.disabled) return;
  const pet = Number(b.dataset.pet), slot = Number(b.dataset.slot);
  const cur = ((day.marks[pet] || {})[slot] || {}).mark || '';
  const mark = NEXT[cur];
  const before = day.marks[pet] && day.marks[pet][slot];
  // Show it right away; undo if the server says no.
  day.marks[pet] = day.marks[pet] || {};
  if (mark) day.marks[pet][slot] = { mark, at: Date.now(), name: me.name, color: me.color };
  else delete day.marks[pet][slot];
  render();
  try {
    await api('/api/mark', { method: 'PUT', body: JSON.stringify({ date: day.date, pet_id: pet, slot, mark: mark || null }) });
  } catch (err) {
    if (before) day.marks[pet][slot] = before; else delete day.marks[pet][slot];
    render();
    toast(err.message);
  }
});

$('prev').addEventListener('click', () => { viewDate = addDays(day.date, -1); load(); });
$('next').addEventListener('click', () => { const n = addDays(day.date, 1); viewDate = n >= day.today ? '' : n; load(); });
$('todayBtn').addEventListener('click', () => { viewDate = ''; load(); });
$('refresh').addEventListener('click', async () => {
  $('refresh').disabled = true;
  await load(true);
  $('refresh').disabled = false;
  if (day && day.sync && day.sync.ok) toast(`${day.dogs.length} dogs from PawPartner`);
});
$('logout').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }).catch(() => {}); location.reload(); });

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginErr').textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ username: $('u').value, password: $('p').value }) });
    start();
  } catch (err) {
    $('loginErr').textContent = err.message;
  }
});

async function start() {
  try {
    me = await api('/api/me');
  } catch {
    return;
  }
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('meName').textContent = me.name;
  await load();
}

// Pick up other staff's marks, and roll over at midnight.
setInterval(() => { if (me && !document.hidden) load(); }, 30000);
document.addEventListener('visibilitychange', () => { if (me && !document.hidden) load(); });

start();
