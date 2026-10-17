const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let state = null;
let areaId = null;
let viewDate = '';
let armed = null; // { task, box, timer } — first tap arms, second tap commits
try { areaId = Number(localStorage.getItem('mp-area')) || null; } catch {}

function textOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? '#111' : '#fff';
}
const initials = (name) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 3).toUpperCase();

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 3000);
}

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { showLogin(); throw new Error('signed out'); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function showLogin() {
  $('app').classList.add('hidden');
  $('login').classList.remove('hidden');
  $('u').focus();
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginErr').textContent = '';
  const res = await fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: $('u').value, password: $('p').value }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { $('loginErr').textContent = data.error || 'Sign in failed'; return; }
  $('p').value = '';
  $('login').classList.add('hidden');
  load();
});

$('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  state = null;
  showLogin();
});

$('histDate').addEventListener('change', () => {
  viewDate = $('histDate').value === state.today ? '' : $('histDate').value;
  load();
});

function fmtDate(s, opts) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', opts);
}
const fmtTime = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: state.timezone, weekday: 'short', hour: 'numeric', minute: '2-digit' });

function resetText(period) {
  const p = state.periods;
  if (period === 'daily') return state.readOnly ? fmtDate(p.date, { weekday: 'long', month: 'short', day: 'numeric' }) : 'Resets tonight at 11:59 PM';
  if (period === 'weekly') return `${fmtDate(p.weekly.starts, { month: 'short', day: 'numeric' })} – ${fmtDate(p.weekly.resets, { month: 'short', day: 'numeric' })}${state.readOnly ? '' : ' · resets Sunday 11:59 PM'}`;
  if (period === 'monthly') return `${fmtDate(p.monthly.resets, { month: 'long', year: 'numeric' })}${state.readOnly ? '' : ` · resets ${fmtDate(p.monthly.resets, { month: 'short', day: 'numeric' })} 11:59 PM`}`;
  return '';
}

function count(sections) {
  let done = 0, total = 0;
  for (const s of sections) for (const t of s.tasks) { total += t.boxes.length; done += Object.keys(t.done).length; }
  return { done, total };
}

// Info text: lines starting "## " are headings, "- " bullets, "1. " numbered.
function renderInfo(text) {
  let html = '', list = null;
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const line of text.split('\n')) {
    let m;
    if ((m = line.match(/^##\s+(.*)/))) { close(); html += `<h4>${esc(m[1])}</h4>`; }
    else if ((m = line.match(/^-\s+(.*)/))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${esc(m[1])}</li>`; }
    else if ((m = line.match(/^\d+\.\s+(.*)/))) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += `<li>${esc(m[1])}</li>`; }
    else if (line.trim()) { close(); html += `<p>${esc(line)}</p>`; }
  }
  close();
  return html;
}

function render() {
  const s = state;
  $('meName').textContent = s.me.name;
  $('meDot').style.background = s.me.color;
  $('adminLink').classList.toggle('hidden', !s.me.is_admin);
  $('histDate').classList.toggle('hidden', !s.me.is_admin);
  $('histDate').max = s.today;
  $('histDate').value = s.periods.date;
  $('dateLine').textContent = fmtDate(s.periods.date, { weekday: 'long', month: 'long', day: 'numeric' });

  const banner = $('banner');
  banner.classList.toggle('hidden', !s.readOnly);
  if (s.readOnly) banner.innerHTML = `Viewing <b>${esc(fmtDate(s.periods.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))}</b> (read-only). <a href="#" id="backToday">Back to today</a>`;
  const back = $('backToday');
  if (back) back.onclick = (e) => { e.preventDefault(); viewDate = ''; load(); };

  if (!s.areas.some((a) => a.id === areaId)) areaId = s.areas[0] && s.areas[0].id;

  $('tabs').innerHTML = s.areas.map((a) => {
    const c = count(a.sections.filter((x) => x.period === 'daily'));
    return `<button class="tab ${a.id === areaId ? 'on' : ''}" data-area="${a.id}">${esc(a.name)}<span class="count">${c.done}/${c.total}</span></button>`;
  }).join('');

  const area = s.areas.find((a) => a.id === areaId);
  let html = '';
  for (const period of ['daily', 'weekly', 'monthly']) {
    const secs = area.sections.filter((x) => x.period === period);
    if (!secs.length) continue;
    const c = count(secs);
    html += `<section class="period"><div class="period-head"><h2>${period}</h2><span class="resets">${esc(resetText(period))}</span><span class="prog">${c.done} / ${c.total}</span></div>`;
    for (const sec of secs) {
      const showTitle = !(secs.length === 1 && sec.title.toLowerCase() === period) || sec.note;
      html += '<div class="section">';
      if (showTitle) {
        html += `<div class="section-title">${esc(sec.title)}${sec.season ? `<span class="season-tag">${sec.season}</span>` : ''}${sec.note ? `<span class="snote">${esc(sec.note)}</span>` : ''}</div>`;
      }
      for (const t of sec.tasks) {
        html += `<div class="task"><div class="task-label">${esc(t.label)}${t.note ? `<span class="tnote">${esc(t.note)}</span>` : ''}</div><div class="boxes">`;
        for (const b of t.boxes) {
          const d = t.done[b];
          const label = b === 'Done' ? '' : esc(b);
          if (d) {
            html += `<button class="box done" style="background:${d.color};color:${textOn(d.color)}" data-who="${esc(d.name)} · ${esc(fmtTime(d.at))}">${label || '✓'}<span class="who">${esc(initials(d.name))}</span></button>`;
          } else {
            const isArmed = armed && armed.task === t.id && armed.box === b;
            html += `<button class="box ${s.readOnly ? 'ro' : ''} ${isArmed ? 'armed' : ''}" data-task="${t.id}" data-box="${esc(b)}">${isArmed ? 'Tap again' : (label || 'Done')}</button>`;
          }
        }
        html += '</div></div>';
      }
      html += '</div>';
    }
    html += '</section>';
  }
  const infos = area.sections.filter((x) => x.period === 'info');
  for (const sec of infos) {
    html += `<div class="section"><details class="info"><summary>${esc(sec.title)}</summary>${renderInfo(sec.note)}</details></div>`;
  }
  $('board').innerHTML = html;

  $('legend').innerHTML = s.staff.map((u) => `<span><span class="dot" style="background:${u.color}"></span>${esc(u.name)}</span>`).join('');
}

$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('.tab');
  if (!b) return;
  areaId = Number(b.dataset.area);
  try { localStorage.setItem('mp-area', areaId); } catch {}
  armed = null;
  render();
  window.scrollTo(0, 0);
});

$('board').addEventListener('click', async (e) => {
  const b = e.target.closest('.box');
  if (!b) return;
  if (b.classList.contains('done')) { toast(`Checked by ${b.dataset.who}`); return; }
  if (state.readOnly) return;
  const task = Number(b.dataset.task), box = b.dataset.box;
  if (!(armed && armed.task === task && armed.box === box)) {
    if (armed) clearTimeout(armed.timer);
    armed = { task, box, timer: setTimeout(() => { armed = null; render(); }, 4000) };
    render();
    return;
  }
  clearTimeout(armed.timer);
  armed = null;
  try {
    await api('/api/check', { method: 'POST', body: JSON.stringify({ task_id: task, box }) });
  } catch (err) {
    if (err.message !== 'signed out') toast(err.message);
  }
  load();
});

async function load() {
  try {
    state = await api('/api/board' + (viewDate ? `?date=${viewDate}` : ''));
  } catch (err) {
    if (err.message !== 'signed out') toast(err.message);
    return;
  }
  $('app').classList.remove('hidden');
  render();
}

// Keep everyone's screens in sync and roll over at 11:59 PM without a manual refresh.
setInterval(() => { if (state && !armed && !document.hidden) load(); }, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && state) load(); });

load();
