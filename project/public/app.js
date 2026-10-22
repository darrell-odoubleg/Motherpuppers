const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `Error ${r.status}`), { status: r.status });
  return j;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.add('hidden'), 2600);
}

const money = (c) => (c == null ? '' : '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const moneyShort = (c) => '$' + Math.round((c || 0) / 100).toLocaleString('en-US');
const rawMoney = (c) => (c == null ? '' : String(c / 100));
const isNA = (t) => t.status === 'N/A' || /^n\/?a$/i.test(t.assigned.trim());
const dueOf = (t) => (t.budget == null && t.paid == null ? null : (t.budget || 0) - (t.paid || 0));

let me = null;
let data = null;
let canEdit = false;

// remembered per browser: which sections are open + filters
const store = {
  get(k, d) { try { const v = localStorage.getItem('mpp:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('mpp:' + k, JSON.stringify(v)); } catch {} },
};
let open = new Set(store.get('open', []));

// ---------- login ----------
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginErr').textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: { username: $('#u').value, password: $('#p').value } });
    start();
  } catch (err) {
    $('#loginErr').textContent = err.message;
  }
});
$('#logout').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); location.reload(); });

async function start() {
  try {
    me = await api('/api/me');
  } catch {
    $('#login').classList.remove('hidden');
    $('#app').classList.add('hidden');
    return;
  }
  canEdit = !!(me.can_edit || me.is_admin);
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#meName').textContent = me.name + (canEdit ? '' : ' (view only)');
  $('#adminLink').classList.toggle('hidden', !me.is_admin);
  $('#addSectionWrap').classList.toggle('hidden', !canEdit);
  await load();
}

async function load() {
  data = await api('/api/project');
  const sf = $('#statusFilter');
  if (sf.options.length === 1) {
    for (const s of data.statuses) sf.insertAdjacentHTML('beforeend', `<option value="${esc(s || '__blank')}">${esc(s || 'No status')}</option>`);
    sf.value = store.get('status', '');
    $('#hideNA').checked = store.get('hideNA', false);
    $('#onlyMoney').checked = store.get('onlyMoney', false);
  }
  render();
}

// ---------- filters ----------
function matches(t) {
  const q = $('#q').value.trim().toLowerCase();
  const sf = $('#statusFilter').value;
  if ($('#hideNA').checked && isNA(t)) return false;
  if ($('#onlyMoney').checked && t.budget == null && t.paid == null) return false;
  if (sf && (sf === '__blank' ? t.status !== '' : t.status !== sf)) return false;
  if (q && ![t.task, t.assigned, t.comments, t.status].some((v) => v.toLowerCase().includes(q))) return false;
  return true;
}
const filtering = () => !!($('#q').value.trim() || $('#statusFilter').value || $('#hideNA').checked || $('#onlyMoney').checked);

$('#q').addEventListener('input', render);
for (const id of ['statusFilter', 'hideNA', 'onlyMoney']) {
  $('#' + id).addEventListener('change', (e) => { store.set(id === 'statusFilter' ? 'status' : id, e.target.type === 'checkbox' ? e.target.checked : e.target.value); render(); });
}
$('#expandAll').addEventListener('click', () => { open = new Set(data.sections.map((s) => s.id)); store.set('open', [...open]); render(); });
$('#collapseAll').addEventListener('click', () => { open = new Set(); store.set('open', []); render(); });
$('#print').addEventListener('click', () => window.print());

// ---------- totals ----------
function sums(tasks) {
  let budget = 0, paid = 0, due = 0;
  for (const t of tasks) { budget += t.budget || 0; paid += t.paid || 0; due += dueOf(t) || 0; }
  return { budget, paid, due };
}

function renderTotals() {
  const all = data.sections.flatMap((s) => s.tasks);
  const { budget, paid, due } = sums(all);
  const live = all.filter((t) => !isNA(t));
  const done = live.filter((t) => t.status === 'Complete').length;
  const going = live.filter((t) => t.status === 'In progress').length;
  const pctPaid = budget ? Math.round((paid / budget) * 100) : 0;
  const pctDone = live.length ? Math.round((done / live.length) * 100) : 0;
  $('#tiles').innerHTML = `
    <div class="tile"><div class="k">Budget</div><div class="v">${moneyShort(budget)}</div><div class="sub">${all.filter((t) => t.budget != null).length} priced items</div></div>
    <div class="tile"><div class="k">Already paid</div><div class="v">${moneyShort(paid)}</div><div class="bar"><span style="width:${Math.min(pctPaid, 100)}%"></span></div><div class="sub">${pctPaid}% of budget</div></div>
    <div class="tile"><div class="k">Due</div><div class="v">${moneyShort(due)}</div><div class="sub">Budget − paid</div></div>
    <div class="tile"><div class="k">Progress</div><div class="v">${pctDone}%</div><div class="bar"><span style="width:${pctDone}%"></span></div><div class="sub">${done} of ${live.length} complete · ${going} in progress</div></div>`;
  $('#grand').innerHTML = `<span><small>Total budget</small>${money(budget)}</span><span><small>Already paid</small>${money(paid)}</span><span><small>Total due</small>${money(due)}</span>`;
}

function renderSectionTotals(sec, el) {
  const s = sums(sec.tasks);
  $('.sum', el).textContent = s.budget ? moneyShort(s.budget) : '';
  const live = sec.tasks.filter((t) => !isNA(t));
  const done = live.filter((t) => t.status === 'Complete').length;
  $('.meta', el).textContent = `${done}/${live.length} complete`;
  const f = $('tfoot', el);
  if (f) f.innerHTML = `<tr><td colspan="6" data-l="">Section total</td><td class="num">${money(s.budget)}</td><td class="num">${money(s.paid)}</td><td class="num">${money(s.due)}</td><td colspan="2"></td></tr>`;
}

// ---------- render ----------
function row(t) {
  const dis = canEdit ? '' : 'disabled';
  const due = dueOf(t);
  const statusOpts = data.statuses.map((s) => `<option value="${esc(s)}" ${s === t.status ? 'selected' : ''}>${esc(s || '— status —')}</option>`).join('');
  const who = t.updated_by_name && t.updated_at ? `${esc(t.updated_by_name)} · ${new Date(t.updated_at).toLocaleDateString()}` : '';
  return `<tr data-id="${t.id}" class="${isNA(t) ? 'na' : ''}">
    <td class="t-grip">${canEdit && !filtering() ? `<button class="grip" type="button" title="Drag to move (or focus and use ↑ ↓)" aria-label="Move ${esc(t.task)}">⠿</button>` : ''}</td>
    <td class="t-task"><input class="cell" data-f="task" value="${esc(t.task)}" ${dis} aria-label="Task"></td>
    <td data-l="Assigned to"><input class="cell" data-f="assigned" value="${esc(t.assigned)}" ${dis} placeholder="${canEdit ? '—' : ''}" aria-label="Assigned to"></td>
    <td data-l="Start"><input type="date" class="cell ${t.start_date ? '' : 'empty'}" data-f="start_date" value="${esc(t.start_date)}" ${dis} aria-label="Start date"></td>
    <td data-l="End"><input type="date" class="cell ${t.end_date ? '' : 'empty'}" data-f="end_date" value="${esc(t.end_date)}" ${dis} aria-label="End date"></td>
    <td data-l="Status"><select class="status" data-f="status" data-s="${esc(t.status)}" ${dis} aria-label="Status">${statusOpts}</select></td>
    <td data-l="Budget" class="num"><input class="cell num" data-f="budget" inputmode="decimal" value="${esc(money(t.budget))}" ${dis} placeholder="${canEdit ? '—' : ''}" aria-label="Budget"></td>
    <td data-l="Already paid" class="num"><input class="cell num" data-f="paid" inputmode="decimal" value="${esc(money(t.paid))}" ${dis} placeholder="${canEdit ? '—' : ''}" aria-label="Already paid"></td>
    <td data-l="Due" class="num"><span class="due ${due > 0 ? 'owed' : due === 0 && t.budget ? 'zero' : ''}">${money(due)}</span></td>
    <td data-l="Comments" class="t-com"><textarea class="cell" data-f="comments" rows="1" ${dis} aria-label="Comments">${esc(t.comments)}</textarea>${who ? `<div class="who">${who}</div>` : ''}</td>
    <td class="t-x">${canEdit ? `<button class="x" data-del="${t.id}" title="Delete line item" aria-label="Delete">×</button>` : ''}</td>
  </tr>`;
}

function render() {
  if (!data) return;
  renderTotals();
  const f = filtering();
  const wrap = $('#sections');
  wrap.innerHTML = '';
  let shown = 0;
  for (const sec of data.sections) {
    const rows = sec.tasks.filter(matches);
    if (f && !rows.length) continue;
    shown++;
    const isOpen = f || open.has(sec.id);
    const el = document.createElement('section');
    el.className = 'sec' + (isOpen ? ' open' : '');
    el.dataset.sid = sec.id;
    el.innerHTML = `
      <div class="sec-head" role="button" tabindex="0" aria-expanded="${isOpen}">
        <span class="chev">▶</span><h2>${esc(sec.name)}</h2>
        <span class="meta"></span><span class="sum"></span>
      </div>
      <div class="sec-body">
        <table class="grid">
          <colgroup><col class="col-grip"><col class="col-task"><col class="col-asg"><col class="col-date"><col class="col-date"><col class="col-status"><col class="col-money"><col class="col-money"><col class="col-money"><col class="col-com"><col class="col-x"></colgroup>
          <thead><tr><th></th><th>Task</th><th>Assigned to</th><th>Start date</th><th>End date</th><th>Status</th><th class="num">Budget</th><th class="num">Already paid</th><th class="num">Due</th><th>Comments</th><th></th></tr></thead>
          <tbody>${rows.map(row).join('')}</tbody>
          <tfoot></tfoot>
        </table>
        ${canEdit ? `<div class="sec-foot">
          <button class="btn small" data-add="${sec.id}">+ Add line item</button>
          <span class="spacer"></span>
          <button class="btn small" data-rename="${sec.id}">Rename section</button>
          ${me.is_admin ? `<button class="btn small danger" data-delsec="${sec.id}">Delete section</button>` : ''}
        </div>` : ''}
      </div>`;
    wrap.appendChild(el);
    renderSectionTotals(sec, el);
  }
  if (!shown) wrap.innerHTML = '<div class="panel muted">Nothing matches those filters.</div>';
}

function findTask(id) {
  for (const s of data.sections) {
    const t = s.tasks.find((x) => x.id === id);
    if (t) return { sec: s, t };
  }
  return {};
}

// ---------- interactions ----------
const sectionsEl = $('#sections');

sectionsEl.addEventListener('click', async (e) => {
  const head = e.target.closest('.sec-head');
  if (head) {
    const el = head.parentElement;
    const id = Number(el.dataset.sid);
    el.classList.toggle('open');
    head.setAttribute('aria-expanded', el.classList.contains('open'));
    if (el.classList.contains('open')) open.add(id); else open.delete(id);
    store.set('open', [...open]);
    return;
  }
  const b = e.target.closest('button');
  if (!b) return;
  try {
    if (b.dataset.add) {
      const sid = Number(b.dataset.add);
      const name = prompt('New line item:');
      if (!name || !name.trim()) return;
      const t = await api(`/api/sections/${sid}/tasks`, { method: 'POST', body: { task: name } });
      t.updated_by_name = me.name;
      data.sections.find((s) => s.id === sid).tasks.push(t);
      open.add(sid); store.set('open', [...open]);
      render();
    } else if (b.dataset.del) {
      const { sec, t } = findTask(Number(b.dataset.del));
      if (!t || !confirm(`Delete "${t.task}" from ${sec.name}?`)) return;
      await api(`/api/tasks/${t.id}`, { method: 'DELETE' });
      sec.tasks = sec.tasks.filter((x) => x !== t);
      render();
    } else if (b.dataset.rename) {
      const sec = data.sections.find((s) => s.id === Number(b.dataset.rename));
      const name = prompt('Section name:', sec.name);
      if (!name || !name.trim() || name.trim() === sec.name) return;
      await api(`/api/sections/${sec.id}`, { method: 'PATCH', body: { name: name.trim() } });
      sec.name = name.trim();
      render();
    } else if (b.dataset.delsec) {
      const sec = data.sections.find((s) => s.id === Number(b.dataset.delsec));
      if (!confirm(`Delete the whole "${sec.name}" section and its ${sec.tasks.length} line items? This can't be undone.`)) return;
      await api(`/api/sections/${sec.id}`, { method: 'DELETE' });
      data.sections = data.sections.filter((s) => s !== sec);
      render();
    }
  } catch (err) {
    toast(err.message);
  }
});

sectionsEl.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('sec-head')) { e.preventDefault(); e.target.click(); }
  if (e.key === 'Enter' && e.target.matches('input.cell')) e.target.blur();
  if (e.key === 'Escape' && e.target.matches('.cell')) {
    const { t } = findTask(Number(e.target.closest('tr').dataset.id));
    const f = e.target.dataset.f;
    e.target.value = f === 'budget' || f === 'paid' ? money(t[f]) : t[f];
    e.target.blur();
  }
});

// money cells show "$1,234.00" at rest and a plain number while editing
sectionsEl.addEventListener('focusin', (e) => {
  const f = e.target.dataset && e.target.dataset.f;
  if (f === 'budget' || f === 'paid') {
    const { t } = findTask(Number(e.target.closest('tr').dataset.id));
    e.target.value = rawMoney(t[f]);
    e.target.select();
  }
});

sectionsEl.addEventListener('focusout', (e) => {
  const f = e.target.dataset && e.target.dataset.f;
  if (f === 'budget' || f === 'paid') {
    const { t } = findTask(Number(e.target.closest('tr').dataset.id));
    // if nothing changed, put the formatted value back
    const typed = e.target.value.replace(/[$,\s]/g, '');
    if ((typed === '' ? null : Math.round(Number(typed) * 100)) === t[f]) e.target.value = money(t[f]);
  }
});

sectionsEl.addEventListener('change', async (e) => {
  const el = e.target;
  const f = el.dataset.f;
  if (!f) return;
  const tr = el.closest('tr');
  const { sec, t } = findTask(Number(tr.dataset.id));
  if (!t) return;
  if (f === 'status') el.dataset.s = el.value;
  if (f === 'start_date' || f === 'end_date') el.classList.toggle('empty', !el.value);
  if (f === 'task' && !el.value.trim()) { el.value = t.task; return toast('Task name is required'); }
  el.classList.remove('saved', 'bad');
  el.classList.add('saving');
  try {
    const updated = await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { [f]: el.value } });
    Object.assign(t, updated);
    el.classList.remove('saving');
    el.classList.add('saved');
    setTimeout(() => el.classList.remove('saved'), 900);
    if (f === 'budget' || f === 'paid') {
      if (document.activeElement !== el) el.value = money(t[f]);
      const d = dueOf(t);
      const due = $('.due', tr);
      due.textContent = money(d);
      due.className = 'due ' + (d > 0 ? 'owed' : d === 0 && t.budget ? 'zero' : '');
    }
    tr.classList.toggle('na', isNA(t));
    const who = $('.who', tr);
    const whoText = `${t.updated_by_name} · ${new Date(t.updated_at).toLocaleDateString()}`;
    if (who) who.textContent = whoText;
    else $('.t-com', tr).insertAdjacentHTML('beforeend', `<div class="who">${esc(whoText)}</div>`);
    renderTotals();
    renderSectionTotals(sec, tr.closest('.sec'));
  } catch (err) {
    el.classList.remove('saving');
    el.classList.add('bad');
    toast(err.status === 401 ? 'Signed out — please sign in again' : err.message);
  }
});

// comments box grows to fit its text
sectionsEl.addEventListener('input', (e) => {
  if (e.target.tagName === 'TEXTAREA') { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 2 + 'px'; }
});

// ---------- drag to arrange ----------
// Grab the ⠿ handle and drag (mouse or finger). Drop between rows of any open section,
// or on a collapsed section's header to send the item to the end of that section.
let drag = null;

async function saveOrder(tr, fromSid) {
  const secEl = tr.closest('.sec');
  const toSid = Number(secEl.dataset.sid);
  const ids = [...tr.parentElement.children].map((r) => Number(r.dataset.id));
  const from = data.sections.find((s) => s.id === fromSid);
  const to = data.sections.find((s) => s.id === toSid);
  if (fromSid === toSid && ids.every((id, i) => from.tasks[i] && from.tasks[i].id === id)) return;
  try {
    await api(`/api/sections/${toSid}/order`, { method: 'PUT', body: { ids, moved: Number(tr.dataset.id) } });
    const task = from.tasks.find((t) => t.id === Number(tr.dataset.id));
    if (from !== to) from.tasks = from.tasks.filter((t) => t !== task);
    const byId = new Map([...to.tasks, task].map((t) => [t.id, t]));
    to.tasks = ids.map((id) => byId.get(id));
    task.section_id = toSid;
    renderSectionTotals(to, secEl);
    if (from !== to) {
      const fromEl = sectionsEl.querySelector(`.sec[data-sid="${fromSid}"]`);
      if (fromEl) renderSectionTotals(from, fromEl);
      if (!secEl.classList.contains('open')) toast(`Moved to ${to.name}`);
    }
    renderTotals();
  } catch (err) {
    toast(err.message);
    load();
  }
}

function dropTargetAt(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const head = el.closest('.sec:not(.open) .sec-head');
  if (head) return { head };
  const row = el.closest('.sec.open tbody tr');
  if (row && row !== drag.tr) return { row, after: y > row.getBoundingClientRect().top + row.offsetHeight / 2 };
  const sec = el.closest('.sec.open');
  if (sec && !row) return { tbody: $('tbody', sec) };
  return null;
}

function endDrag(cancel) {
  if (!drag) return;
  const d = drag;
  drag = null;
  cancelAnimationFrame(d.raf);
  d.tr.classList.remove('dragging');
  document.body.classList.remove('is-dragging');
  sectionsEl.querySelectorAll('.drop').forEach((h) => h.classList.remove('drop'));
  if (cancel) {
    d.home.parent.insertBefore(d.tr, d.home.next);
    return;
  }
  if (d.overHead) $('tbody', d.overHead.closest('.sec')).appendChild(d.tr);
  saveOrder(d.tr, d.fromSid);
}

sectionsEl.addEventListener('pointerdown', (e) => {
  const grip = e.target.closest('.grip');
  if (!grip || e.button !== 0) return;
  e.preventDefault();
  const tr = grip.closest('tr');
  drag = {
    tr, y: e.clientY, x: e.clientX, raf: 0, overHead: null,
    fromSid: Number(tr.closest('.sec').dataset.sid),
    home: { parent: tr.parentElement, next: tr.nextSibling },
  };
  tr.classList.add('dragging');
  document.body.classList.add('is-dragging');
  // keep the page scrolling when dragging near the top/bottom edge
  const tick = () => {
    if (!drag) return;
    const edge = 90;
    if (drag.y < edge) window.scrollBy(0, -Math.ceil((edge - drag.y) / 6));
    else if (drag.y > innerHeight - 60) window.scrollBy(0, Math.ceil((drag.y - innerHeight + 60) / 6));
    drag.raf = requestAnimationFrame(tick);
  };
  drag.raf = requestAnimationFrame(tick);
});

document.addEventListener('pointermove', (e) => {
  if (!drag) return;
  drag.x = e.clientX;
  drag.y = e.clientY;
  const t = dropTargetAt(e.clientX, e.clientY);
  const head = t && t.head;
  if (head !== drag.overHead) {
    if (drag.overHead) drag.overHead.classList.remove('drop');
    if (head) head.classList.add('drop');
    drag.overHead = head || null;
  }
  if (!t || head) return;
  if (t.row) t.row.parentElement.insertBefore(drag.tr, t.after ? t.row.nextSibling : t.row);
  else if (t.tbody && drag.tr.parentElement !== t.tbody && !t.tbody.children.length) t.tbody.appendChild(drag.tr);
});
document.addEventListener('pointerup', () => endDrag(false));
document.addEventListener('pointercancel', () => endDrag(true));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drag) endDrag(true); });

// keyboard: focus the handle, then ↑ / ↓ moves the item one row within its section
sectionsEl.addEventListener('keydown', (e) => {
  const grip = e.target.closest('.grip');
  if (!grip || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
  e.preventDefault();
  const tr = grip.closest('tr');
  const sib = e.key === 'ArrowUp' ? tr.previousElementSibling : tr.nextElementSibling;
  if (!sib) return;
  tr.parentElement.insertBefore(tr, e.key === 'ArrowUp' ? sib : sib.nextSibling);
  grip.focus();
  clearTimeout(saveOrder.t);
  saveOrder.t = setTimeout(() => saveOrder(tr, Number(tr.closest('.sec').dataset.sid)), 400);
});

$('#addSection').addEventListener('click', async () => {
  const name = prompt('New section name:');
  if (!name || !name.trim()) return;
  try {
    const s = await api('/api/sections', { method: 'POST', body: { name: name.trim().toUpperCase() } });
    data.sections.push(s);
    open.add(s.id); store.set('open', [...open]);
    render();
  } catch (err) { toast(err.message); }
});

// pick up other people's edits when the tab comes back into view
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && data && !document.activeElement.matches('.cell, select')) load().catch(() => {});
});

start();
