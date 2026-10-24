(function () {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let me = null;
  let people = [];
  let byId = new Map();
  let view = 'week';
  let weekStart = null;   // Monday YYYY-MM-DD
  let tmplWeek = 'A';
  let data = null;        // current grid: { days, cells, totals, ... }
  let tool = null;        // { type: 'person', id } | { type: 'erase' } | { type: 'note' }
  const undoStack = [];

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const out = await res.json().catch(() => ({}));
    if (res.status === 401) { showLogin(); throw new Error('Signed out'); }
    if (!res.ok) throw new Error(out.error || `Request failed (${res.status})`);
    return out;
  }

  function banner(msg, isErr) {
    const b = $('#banner');
    b.textContent = msg;
    b.className = 'banner' + (isErr ? ' err' : '');
    clearTimeout(banner.t);
    banner.t = setTimeout(() => b.classList.add('hidden'), isErr ? 8000 : 3500);
  }

  // ---------- dates ----------
  const toUTC = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const addDays = (s, n) => { const d = toUTC(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const mondayOf = s => addDays(s, -((toUTC(s).getUTCDay() + 6) % 7));
  const md = s => `${Number(s.slice(5, 7))}/${Number(s.slice(8))}`;
  const longDate = s => toUTC(s).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
  function slotLabel(slot, firstMin, end) {
    const m = firstMin + slot * 30 + (end ? 30 : 0);
    const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, '0');
    return `${((h + 11) % 12) + 1}:${mm}${end ? (h < 12 ? 'am' : 'pm') : ''}`;
  }

  function textColor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#000';
    const n = parseInt(m[1], 16);
    const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111' : '#fff';
  }

  // ---------- auth ----------
  function showLogin() {
    $('#app').classList.add('hidden');
    $('#login').classList.remove('hidden');
  }

  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    $('#loginErr').textContent = '';
    try {
      await api('/api/login', { method: 'POST', body: { username: $('#u').value, password: $('#p').value } });
      $('#p').value = '';
      start();
    } catch (err) { $('#loginErr').textContent = err.message; }
  });

  $('#logout').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    showLogin();
  });

  // ---------- people / palette ----------
  async function loadPeople() {
    people = await api('/api/people');
    byId = new Map(people.map(p => [p.id, p]));
  }

  function renderPalette() {
    if (!me.is_admin) return;
    const editable = view === 'week' || view === 'template';
    $('#palette').classList.toggle('hidden', !editable);
    const chips = people.map(p => `<button class="chip${tool && tool.type === 'person' && tool.id === p.id ? ' on' : ''}" data-person="${p.id}" type="button">
        <span class="sw" style="background:${esc(p.color)}"></span>${esc(p.name)}</button>`).join('');
    const isTool = t => tool && tool.type === t ? ' on' : '';
    $('#palette').innerHTML = `<span class="lbl">Paint:</span>${chips}
      <button class="chip tool${isTool('erase')}" data-tool="erase" type="button"><span class="sw" style="background:transparent"></span>Erase</button>
      <button class="chip tool${isTool('note')}" data-tool="note" type="button">✎ Note</button>
      <button class="btn" id="undoBtn" type="button"${undoStack.length ? '' : ' disabled'}>Undo</button>`;
  }

  $('#palette').addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'undoBtn') return undo();
    const next = b.dataset.person ? { type: 'person', id: Number(b.dataset.person) } : { type: b.dataset.tool };
    const same = tool && tool.type === next.type && tool.id === next.id;
    tool = same ? null : next;
    renderPalette();
    $('#grid').classList.toggle('paint', !!tool);
    // Let the page scroll on phones unless a paint tool is picked.
    $('#grid').style.touchAction = tool && tool.type !== 'note' ? 'none' : '';
  });

  // ---------- grid ----------
  function render() {
    const { days, cells, slots, firstSlotMin } = data;
    const todayKey = data.today;
    const head = `<thead><tr><th class="time"></th>${days.map(d => {
      const isToday = d.date === todayKey;
      const sub = /^\d{4}-/.test(d.date) ? md(d.date) : '';
      return `<th class="${isToday ? 'today' : ''}">${esc(d.name.slice(0, 3))}<span class="d">${sub}</span></th>`;
    }).join('')}</tr></thead>`;
    let body = '<tbody>';
    for (let s = 0; s < slots; s++) {
      body += `<tr class="${s % 2 === 0 ? 'hour' : ''}"><td class="time">${slotLabel(s, firstSlotMin)}</td>`;
      for (const d of days) body += cellHtml(d.date, s, (cells[d.date] || {})[s], d.date === todayKey);
      body += '</tr>';
    }
    body += '</tbody>';
    $('#grid').innerHTML = head + body;
    renderTotals();
  }

  function cellHtml(key, slot, c, isToday) {
    const p = c && c.p ? byId.get(c.p) : null;
    const style = p ? `background:${p.color};color:${textColor(p.color)}` : '';
    const dim = $('#onlyMe').checked && view === 'week' && me.person_id && (!p || p.id !== me.person_id);
    const cls = ['c', isToday ? 'today' : '', p && p.is_open ? 'open' : '', dim ? 'dim' : ''].join(' ');
    const label = c && c.n ? c.n : (p && p.is_open ? 'OPEN' : '');
    const title = `${p ? p.name : 'Nobody'} · ${slotLabel(slot, data.firstSlotMin)}–${slotLabel(slot, data.firstSlotMin, true)}${c && c.n ? ` · ${c.n}` : ''}`;
    return `<td class="${cls}" data-key="${esc(key)}" data-slot="${slot}" style="${style}" title="${esc(title)}">${esc(label)}</td>`;
  }

  function redrawCell(key, slot) {
    const td = $(`#grid td.c[data-key="${CSS.escape(key)}"][data-slot="${slot}"]`);
    if (!td) return;
    td.outerHTML = cellHtml(key, slot, (data.cells[key] || {})[slot], key === data.today);
  }

  function computeTotals() {
    const t = {};
    for (const day of Object.values(data.cells)) for (const c of Object.values(day)) {
      const p = c.p && byId.get(c.p);
      if (p && !p.is_open) t[p.id] = (t[p.id] || 0) + 0.5;
    }
    return t;
  }

  function renderTotals() {
    const t = computeTotals();
    const label = view === 'template' ? `Week ${tmplWeek} hours:` : 'Hours this week:';
    $('#totals').innerHTML = `<span class="muted" style="align-self:center">${label}</span>` + people.filter(p => !p.is_open).map(p =>
      `<span class="total"><span class="sw" style="background:${esc(p.color)}"></span>${esc(p.name)} <b>${t[p.id] || 0}</b></span>`).join('');
  }

  function setLocal(key, slot, person, note) {
    const day = data.cells[key] = data.cells[key] || {};
    const cur = day[slot] || { p: null, n: '' };
    const next = { p: person !== undefined ? person : cur.p, n: note !== undefined ? note : cur.n };
    if (!next.p && !next.n) delete day[slot]; else day[slot] = next;
    redrawCell(key, slot);
  }

  // Paint strokes: press on a cell, drag across others, release to save.
  let stroke = null;
  const grid = $('#grid');

  function cellFromPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    return el && el.closest && el.closest('td.c');
  }

  function addToStroke(td) {
    if (!td || !stroke) return;
    const id = td.dataset.key + '|' + td.dataset.slot;
    if (stroke.seen.has(id)) return;
    stroke.seen.add(id);
    const item = { key: td.dataset.key, slot: Number(td.dataset.slot) };
    if (tool.type === 'person') { item.person_id = tool.id; setLocal(item.key, item.slot, tool.id); }
    else { item.person_id = null; item.note = ''; setLocal(item.key, item.slot, null, ''); }
    stroke.items.push(item);
  }

  grid.addEventListener('pointerdown', e => {
    const td = e.target.closest('td.c');
    if (!td || !me.is_admin || !tool) return;
    if (tool.type === 'note') return editNote(td);
    e.preventDefault();
    stroke = { items: [], seen: new Set(), before: JSON.parse(JSON.stringify(data.cells)) };
    addToStroke(td);
  });
  window.addEventListener('pointermove', e => { if (stroke) addToStroke(cellFromPoint(e.clientX, e.clientY)); });
  window.addEventListener('pointerup', () => { if (stroke) finishStroke(); });
  window.addEventListener('pointercancel', () => { if (stroke) finishStroke(); });

  async function finishStroke() {
    const s = stroke;
    stroke = null;
    if (!s.items.length) return;
    try {
      const r = await api('/api/cells', { method: 'POST', body: { items: s.items } });
      undoStack.push(r.previous);
      if (undoStack.length > 50) undoStack.shift();
      renderPalette();
      renderTotals();
    } catch (err) {
      data.cells = s.before;
      render();
      banner(err.message, true);
    }
  }

  async function editNote(td) {
    const key = td.dataset.key, slot = Number(td.dataset.slot);
    const cur = ((data.cells[key] || {})[slot] || {}).n || '';
    const note = prompt('Note for this half hour (blank to remove):', cur);
    if (note === null) return;
    try {
      const r = await api('/api/cells', { method: 'POST', body: { items: [{ key, slot, note }] } });
      undoStack.push(r.previous);
      setLocal(key, slot, undefined, note.trim().slice(0, 60));
      renderPalette();
    } catch (err) { banner(err.message, true); }
  }

  async function undo() {
    const prev = undoStack.pop();
    if (!prev) return;
    try {
      await api('/api/cells', { method: 'POST', body: { items: prev.map(p => ({ key: p.key, slot: p.slot, person_id: p.person_id, note: p.note })), log: false } });
      for (const p of prev) setLocal(p.key, p.slot, p.person_id, p.note);
      renderTotals();
      renderPalette();
    } catch (err) { banner(err.message, true); }
  }

  // ---------- week view ----------
  async function loadWeek(startDate) {
    const d = await api('/api/week' + (startDate ? `?start=${startDate}` : ''));
    weekStart = d.start;
    data = d;
    $('#weekTitle').textContent = `${longDate(d.days[0].date)} – ${longDate(d.days[6].date)}`;
    $('#jumpDate').value = d.start;
    render();
  }

  $('#prevWeek').addEventListener('click', () => loadWeek(addDays(weekStart, -7)));
  $('#nextWeek').addEventListener('click', () => loadWeek(addDays(weekStart, 7)));
  $('#thisWeek').addEventListener('click', () => loadWeek());
  $('#jumpDate').addEventListener('change', () => { if ($('#jumpDate').value) loadWeek(mondayOf($('#jumpDate').value)); });
  $('#onlyMe').addEventListener('change', () => { render(); try { localStorage.setItem('mp_only_me', $('#onlyMe').checked ? '1' : ''); } catch (e) {} });
  $('#printBtn').addEventListener('click', () => window.print());
  $('#printBtn2').addEventListener('click', () => window.print());

  $('#fillBtn').addEventListener('click', () => {
    const dlg = $('#fillDlg');
    dlg.querySelector(`input[name=fw][value="${data.templateWeek}"]`).checked = true;
    dlg.returnValue = '';
    dlg.showModal();
  });
  $('#fillDlg').addEventListener('close', async () => {
    const dlg = $('#fillDlg');
    if (dlg.returnValue !== 'ok') return;
    const week = dlg.querySelector('input[name=fw]:checked').value;
    const mode = dlg.querySelector('input[name=fm]:checked').value;
    if (mode === 'replace' && !confirm('Replace everything on this week with permanent Week ' + week + '?')) return;
    try {
      await api('/api/week/apply-template', { method: 'POST', body: { start: weekStart, week, mode } });
      undoStack.length = 0;
      await loadWeek(weekStart);
      renderPalette();
      banner(`Filled from permanent Week ${week}.`);
    } catch (err) { banner(err.message, true); }
  });

  $('#copyBtn').addEventListener('click', () => {
    $('#copyText').textContent = `From the week of ${longDate(addDays(weekStart, -7))} into the week of ${longDate(weekStart)}.`;
    $('#copyDlg').returnValue = '';
    $('#copyDlg').showModal();
  });
  $('#copyDlg').addEventListener('close', async () => {
    const dlg = $('#copyDlg');
    if (dlg.returnValue !== 'ok') return;
    const mode = dlg.querySelector('input[name=cm]:checked').value;
    if (mode === 'replace' && !confirm('Replace everything on this week with last week?')) return;
    try {
      await api('/api/week/copy', { method: 'POST', body: { from: addDays(weekStart, -7), to: weekStart, mode } });
      undoStack.length = 0;
      await loadWeek(weekStart);
      renderPalette();
      banner('Copied last week.');
    } catch (err) { banner(err.message, true); }
  });

  // ---------- permanent template ----------
  async function loadTemplate(week) {
    tmplWeek = week;
    const d = await api('/api/template?week=' + week);
    data = { ...d, today: null };
    $$('#tmplSeg .btn').forEach(b => b.classList.toggle('on', b.dataset.week === week));
    $('#tmplHint').textContent = me.is_admin ? 'Changes here don’t touch real weeks until you use “Fill from permanent” on a week.' : '';
    render();
  }
  $('#tmplSeg').addEventListener('click', e => { const b = e.target.closest('[data-week]'); if (b) loadTemplate(b.dataset.week); });

  // ---------- my shifts ----------
  async function loadMine() {
    const sel = $('#minePerson');
    const pid = (me.is_admin && sel.value) || me.person_id || '';
    const r = await api('/api/shifts' + (pid ? `?person_id=${pid}` : ''));
    if (r.note) { $('#mineList').innerHTML = `<div class="card muted">${esc(r.note)}</div>`; return; }
    if (!r.shifts.length) { $('#mineList').innerHTML = '<div class="card muted">No shifts in the next three weeks.</div>'; return; }
    const p = byId.get(r.person_id);
    const weeks = new Map();
    for (const s of r.shifts) {
      const k = mondayOf(s.date);
      if (!weeks.has(k)) weeks.set(k, []);
      weeks.get(k).push(s);
    }
    const today = data && data.today;
    $('#mineList').innerHTML = [...weeks].map(([monday, list]) => `<div class="week-group">
        <h3><span>Week of ${longDate(monday)}</span><span class="muted">${list.reduce((t, s) => t + s.hours, 0)} hrs</span></h3>
        ${list.map(s => `<div class="shift${s.date === today ? ' today' : ''}" style="border-left-color:${esc(p ? p.color : '')}">
          <span class="when">${esc(s.day.slice(0, 3))} ${md(s.date)}</span>
          <span>${esc(s.start)} – ${esc(s.end)}${s.notes.length ? ` <span class="muted">· ${esc(s.notes.join(', '))}</span>` : ''}</span>
          <span class="hrs">${s.hours} hr${s.hours === 1 ? '' : 's'}</span></div>`).join('')}
      </div>`).join('');
  }
  $('#minePerson').addEventListener('change', loadMine);

  // ---------- activity ----------
  async function loadActivity() {
    const rows = await api('/api/changes');
    $('#activityList').innerHTML = rows.length ? rows.map(r => `<div class="row"><div>${esc(r.summary)}</div>
      <div class="t">${esc(r.user_name)} · ${new Date(r.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div></div>`).join('')
      : '<div class="muted">No changes yet.</div>';
  }

  // ---------- people (admin) ----------
  let logins = [];
  async function loadPeopleAdmin() {
    const [all, ls, settings] = await Promise.all([api('/api/people?all=1'), api('/api/logins'), api('/api/settings')]);
    logins = ls;
    const loginOpts = sel => `<option value="">No login</option>` + logins.map(l => `<option value="${l.id}"${l.id === sel ? ' selected' : ''}>${esc(l.name)} (${esc(l.username)})</option>`).join('');
    $('#newLogin').innerHTML = loginOpts(null);
    $('#peopleTable').innerHTML = `<tr><th>Name</th><th>Color</th><th>Login</th><th>On schedule</th></tr>` + all.map(p => `<tr data-id="${p.id}">
        <td><input type="text" data-f="name" value="${esc(p.name)}"></td>
        <td>${p.user_id ? `<span class="sw" style="display:inline-block;width:22px;height:22px;border-radius:6px;background:${esc(p.color)};vertical-align:middle"></span> <span class="muted">from login</span>` : `<input type="color" data-f="color" value="${esc(p.color)}">`}</td>
        <td>${p.is_open ? '<span class="muted">—</span>' : `<select data-f="user_id">${loginOpts(p.user_id)}</select>`}</td>
        <td><input type="checkbox" data-f="active"${p.active ? ' checked' : ''}></td></tr>`).join('');
    $('#anchor').value = settings.week_a_anchor;
  }

  $('#peopleTable').addEventListener('change', async e => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const f = e.target.dataset.f;
    const v = f === 'active' ? e.target.checked : f === 'user_id' ? (Number(e.target.value) || null) : e.target.value;
    try {
      await api('/api/people/' + tr.dataset.id, { method: 'PUT', body: { [f]: v } });
      await loadPeople();
      await loadPeopleAdmin();
    } catch (err) { alert(err.message); }
  });

  $('#addPerson').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api('/api/people', { method: 'POST', body: { name: $('#newName').value, color: $('#newColor').value, user_id: Number($('#newLogin').value) || null } });
      $('#newName').value = '';
      await loadPeople();
      await loadPeopleAdmin();
    } catch (err) { alert(err.message); }
  });

  $('#saveAnchor').addEventListener('click', async () => {
    try {
      const s = await api('/api/settings', { method: 'PUT', body: { week_a_anchor: $('#anchor').value } });
      $('#anchor').value = s.week_a_anchor;
      $('#anchorMsg').textContent = 'Saved.';
    } catch (err) { $('#anchorMsg').textContent = err.message; }
  });

  // ---------- routing ----------
  async function show(v) {
    view = ['week', 'mine', 'template', 'activity', 'people'].includes(v) ? v : 'week';
    if (view === 'people' && !me.is_admin) view = 'week';
    $$('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.view === view));
    $$('.view').forEach(s => s.classList.add('hidden'));
    const gridView = view === 'week' || view === 'template';
    $(gridView ? '#view-grid' : `#view-${view}`).classList.remove('hidden');
    $('#weekBar').classList.toggle('hidden', view !== 'week');
    $('#templateBar').classList.toggle('hidden', view !== 'template');
    tool = null;
    undoStack.length = 0;
    $('#grid').classList.remove('paint');
    $('#grid').style.touchAction = '';
    renderPalette();
    try {
      if (view === 'week') await loadWeek(weekStart);
      else if (view === 'template') await loadTemplate(tmplWeek);
      else if (view === 'mine') await loadMine();
      else if (view === 'activity') await loadActivity();
      else if (view === 'people') await loadPeopleAdmin();
    } catch (err) { if (err.message !== 'Signed out') banner(err.message, true); }
  }
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));

  async function start() {
    try {
      me = await api('/api/me');
    } catch (err) { return; }
    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#meName').textContent = me.name;
    $$('.admin-only').forEach(el => el.classList.toggle('hidden', !me.is_admin));
    $('#onlyMeWrap').classList.toggle('hidden', !me.person_id);
    try { $('#onlyMe').checked = !!me.person_id && localStorage.getItem('mp_only_me') === '1'; } catch (e) {}
    await loadPeople();
    if (me.is_admin) {
      $('#minePerson').innerHTML = people.filter(p => !p.is_open).map(p => `<option value="${p.id}"${p.id === me.person_id ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
    }
    show(location.hash.slice(1) || 'week');
  }

  start();
})();
