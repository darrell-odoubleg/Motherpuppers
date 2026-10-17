const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 2500);
}

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) { location.href = '/'; throw new Error('no access'); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}
const send = (method, path, body) => api(path, { method, body: JSON.stringify(body) });

// ---------- tabs ----------
$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('.tab');
  if (!b) return;
  document.querySelectorAll('#tabs .tab').forEach((x) => x.classList.toggle('on', x === b));
  for (const p of ['staff', 'tasks', 'settings']) $('pane-' + p).classList.toggle('hidden', p !== b.dataset.pane);
});

// ---------- staff ----------
async function loadUsers() {
  const users = await api('/api/admin/users');
  $('users').innerHTML = users.map((u) => `
    <tr data-id="${u.id}">
      <td><input type="color" data-f="color" value="${u.color}"></td>
      <td><input type="text" data-f="name" value="${esc(u.name)}"></td>
      <td><input type="text" data-f="username" value="${esc(u.username)}" autocapitalize="none"></td>
      <td><input type="checkbox" data-f="is_admin" ${u.is_admin ? 'checked' : ''}></td>
      <td><input type="checkbox" data-f="active" ${u.active ? 'checked' : ''}></td>
      <td><input type="text" data-f="password" placeholder="leave blank" autocomplete="off"></td>
      <td><button class="btn" data-save>Save</button></td>
    </tr>`).join('');
}

$('users').addEventListener('click', async (e) => {
  if (!e.target.matches('[data-save]')) return;
  const tr = e.target.closest('tr');
  const v = (f) => tr.querySelector(`[data-f=${f}]`);
  const body = {
    color: v('color').value, name: v('name').value, username: v('username').value,
    is_admin: v('is_admin').checked, active: v('active').checked,
  };
  if (v('password').value) body.password = v('password').value;
  try {
    await send('PUT', `/api/admin/users/${tr.dataset.id}`, body);
    toast('Saved');
    loadUsers();
  } catch (err) { toast(err.message); }
});

$('addUser').addEventListener('click', async () => {
  $('addErr').textContent = '';
  try {
    await send('POST', '/api/admin/users', {
      name: $('nName').value, username: $('nUser').value, password: $('nPass').value,
      color: $('nColor').value, is_admin: $('nAdmin').checked,
    });
    for (const id of ['nName', 'nUser', 'nPass']) $(id).value = '';
    $('nAdmin').checked = false;
    toast('Added');
    loadUsers();
  } catch (err) { $('addErr').textContent = err.message; }
});

// ---------- tasks ----------
let areas = [];
let areaId = null;

async function loadTasks() {
  areas = await api('/api/admin/tasks');
  if (!areas.some((a) => a.id === areaId)) areaId = areas[0] && areas[0].id;
  $('areaPick').innerHTML = areas.map((a) => `<option value="${a.id}" ${a.id === areaId ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  renderEditor();
}

$('areaPick').addEventListener('change', () => { areaId = Number($('areaPick').value); renderEditor(); });

const periodOpts = (cur) => ['daily', 'weekly', 'monthly', 'info'].map((p) => `<option ${p === cur ? 'selected' : ''}>${p}</option>`).join('');
const seasonOpts = (cur) => [['', 'all year'], ['summer', 'summer'], ['winter', 'winter']].map(([v, l]) => `<option value="${v}" ${v === (cur || '') ? 'selected' : ''}>${l}</option>`).join('');

function renderEditor() {
  const area = areas.find((a) => a.id === areaId);
  if (!area) { $('editor').innerHTML = ''; return; }
  $('editor').innerHTML = area.sections.map((s) => `
    <div class="card" data-sec="${s.id}">
      <div class="ed-sec-head">
        <input type="text" data-sf="title" value="${esc(s.title)}">
        <select data-sf="period">${periodOpts(s.period)}</select>
        <select data-sf="season">${seasonOpts(s.season)}</select>
        <button class="btn danger" data-delsec>Delete section</button>
      </div>
      <label>${s.period === 'info' ? 'Text (## heading, - bullet, 1. step)' : 'Section note'}</label>
      ${s.period === 'info'
        ? `<textarea data-sf="note" rows="8">${esc(s.note)}</textarea>`
        : `<input type="text" data-sf="note" value="${esc(s.note)}">`}
      ${s.period === 'info' ? '' : `
        <div class="ed-task muted" style="border-top:0"><span>Task</span><span>Note</span><span>Boxes</span><span>Months</span><span></span></div>
        ${s.tasks.map((t) => `
          <div class="ed-task" data-task="${t.id}">
            <input type="text" data-tf="label" value="${esc(t.label)}">
            <input type="text" data-tf="note" value="${esc(t.note)}" placeholder="note">
            <input type="text" data-tf="boxes" value="${esc(t.boxes.join(', '))}">
            <input type="text" data-tf="months" value="${t.months ? t.months.join(', ') : ''}" placeholder="every month">
            <button class="btn danger" data-deltask title="Delete task">✕</button>
          </div>`).join('')}
        <button class="btn" data-addtask style="margin-top:8px">+ Add task</button>`}
    </div>`).join('') + `
    <div class="card">
      <div class="ed-sec-head">
        <input type="text" id="newSecTitle" placeholder="New section title (e.g. Clean, Sunday)">
        <select id="newSecPeriod">${periodOpts('weekly')}</select>
        <select id="newSecSeason">${seasonOpts('')}</select>
        <button class="btn primary" id="addSec">+ Add section</button>
      </div>
    </div>`;
}

$('editor').addEventListener('change', async (e) => {
  const el = e.target;
  try {
    if (el.dataset.tf) {
      const id = el.closest('[data-task]').dataset.task;
      let val = el.value;
      if (el.dataset.tf === 'boxes') val = val.split(',');
      if (el.dataset.tf === 'months') val = val.trim() ? val.split(',') : null;
      await send('PUT', `/api/admin/tasks/${id}`, { [el.dataset.tf]: val });
      toast('Saved');
    } else if (el.dataset.sf) {
      const id = el.closest('[data-sec]').dataset.sec;
      await send('PUT', `/api/admin/sections/${id}`, { [el.dataset.sf]: el.value });
      toast('Saved');
      if (el.dataset.sf === 'period') loadTasks();
    }
  } catch (err) { toast(err.message); }
});

$('editor').addEventListener('click', async (e) => {
  const el = e.target;
  try {
    if (el.matches('[data-deltask]')) {
      const row = el.closest('[data-task]');
      if (!confirm(`Delete "${row.querySelector('[data-tf=label]').value}"?`)) return;
      await api(`/api/admin/tasks/${row.dataset.task}`, { method: 'DELETE' });
      loadTasks();
    } else if (el.matches('[data-addtask]')) {
      const label = prompt('Task name');
      if (!label) return;
      await send('POST', '/api/admin/tasks', { section_id: Number(el.closest('[data-sec]').dataset.sec), label, boxes: ['Done'] });
      loadTasks();
    } else if (el.matches('[data-delsec]')) {
      const card = el.closest('[data-sec]');
      if (!confirm(`Delete section "${card.querySelector('[data-sf=title]').value}" and all its tasks?`)) return;
      await api(`/api/admin/sections/${card.dataset.sec}`, { method: 'DELETE' });
      loadTasks();
    } else if (el.id === 'addSec') {
      const title = $('newSecTitle').value.trim();
      if (!title) return toast('Give the section a title');
      await send('POST', '/api/admin/sections', { area_id: areaId, title, period: $('newSecPeriod').value, season: $('newSecSeason').value });
      loadTasks();
    }
  } catch (err) { toast(err.message); }
});

// ---------- settings ----------
function monthChecks(el, picked) {
  el.innerHTML = MONTHS.map((m, i) => `<label style="flex:0 0 auto;margin:0"><input type="checkbox" value="${i + 1}" ${picked.includes(i + 1) ? 'checked' : ''}> ${m}</label>`).join('');
}
const picked = (el) => [...el.querySelectorAll('input:checked')].map((x) => Number(x.value));

async function loadSettings() {
  const s = await api('/api/admin/settings');
  if (![...$('tz').options].some((o) => o.value === s.timezone)) $('tz').add(new Option(s.timezone, s.timezone));
  $('tz').value = s.timezone;
  monthChecks($('summer'), s.summer_months);
  monthChecks($('winter'), s.winter_months);
}

$('saveSettings').addEventListener('click', async () => {
  try {
    await send('PUT', '/api/admin/settings', { timezone: $('tz').value, summer_months: picked($('summer')), winter_months: picked($('winter')) });
    toast('Settings saved');
  } catch (err) { toast(err.message); }
});

loadUsers();
loadTasks();
loadSettings();
