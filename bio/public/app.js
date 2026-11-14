const $ = (id) => document.getElementById(id);
const FIELDS = ['name', 'journey', 'love', 'outside'];
let me = null;
let photoFile = null;

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { showLogin(data.no_access ? data.error : ''); throw new Error('Not signed in'); }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}
const postJson = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.add('hidden'), 2600);
}

// The typed answers are kept on this device until sent, so a sign-out mid-way loses nothing.
const draftKey = () => (me ? `mp-bio-draft-${me.id}` : null);
function saveDraft() {
  if (!draftKey()) return;
  try { localStorage.setItem(draftKey(), JSON.stringify(Object.fromEntries(FIELDS.map((f) => [f, $(f).value])))); } catch {}
}
function loadDraft() {
  try { return JSON.parse(localStorage.getItem(draftKey()) || 'null'); } catch { return null; }
}
function clearDraft() { try { localStorage.removeItem(draftKey()); } catch {} }

function showLogin(msg) {
  me = null;
  if (msg) $('loginErr').textContent = msg;
  if (!$('login').classList.contains('hidden')) return;
  $('app').classList.add('hidden');
  $('login').classList.remove('hidden');
  $('loginErr').textContent = msg || '';
  $('loginForm').reset();
  resetForm();
}

function resetForm() {
  $('bioForm').reset();
  setPhoto(null);
  $('formErr').textContent = '';
}

function setPhoto(file) {
  photoFile = file;
  const img = $('preview');
  if (img.src) URL.revokeObjectURL(img.src);
  if (file) {
    img.src = URL.createObjectURL(file);
    img.hidden = false;
    $('photoHint').hidden = true;
    $('photoBox').classList.add('has');
    $('photoBtn').textContent = 'Change picture';
  } else {
    img.removeAttribute('src');
    img.hidden = true;
    $('photoHint').hidden = false;
    $('photoBox').classList.remove('has');
    $('photoBtn').textContent = 'Choose picture';
  }
}

async function start() {
  try {
    me = await api('/api/me');
  } catch { return; }
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('meName').textContent = me.name;
  resetForm();
  const d = loadDraft();
  for (const f of FIELDS) $(f).value = (d && d[f]) || '';
  if (!$('name').value) $('name').value = me.name;
  if (me.last) {
    const when = new Date(me.last.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    $('lastNote').textContent = `You already sent a bio on ${when}. Sending again gives Tammie a new copy.`;
    $('lastNote').classList.remove('hidden');
  } else $('lastNote').classList.add('hidden');
  $('bioForm').classList.remove('hidden');
  $('done').classList.add('hidden');
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginErr').textContent = '';
  try {
    await postJson('/api/login', { username: $('u').value, password: $('p').value });
    $('loginForm').reset();
    await start();
  } catch (err) {
    if (err.message !== 'Not signed in') $('loginErr').textContent = err.message;
    else $('loginErr').textContent = 'Wrong username or password';
  }
});

$('logout').addEventListener('click', async () => {
  saveDraft();
  try { await postJson('/api/logout'); } catch {}
  showLogin('');
});

$('photo').addEventListener('change', () => {
  const f = $('photo').files[0];
  if (!f) return;
  if (f.size > 25 * 1024 * 1024) { toast('That picture is too big (25 MB max).'); $('photo').value = ''; return; }
  setPhoto(f);
});

$('bioForm').addEventListener('input', saveDraft);

$('bioForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('formErr').textContent = '';
  if (!photoFile) { $('formErr').textContent = 'Please add a picture.'; return; }
  for (const f of ['journey', 'love', 'outside']) {
    if (!$(f).value.trim()) {
      $('formErr').textContent = `Please fill in “${document.querySelector(`label[for=${f}]`).textContent}”.`;
      $(f).focus();
      return;
    }
  }
  const fd = new FormData();
  for (const f of FIELDS) fd.append(f, $(f).value);
  fd.append('photo', photoFile);
  $('send').disabled = true;
  $('send').textContent = 'Sending…';
  try {
    const r = await api('/api/bio', { method: 'POST', body: fd });
    clearDraft();
    $('doneMsg').textContent = r.emailed
      ? 'Your bio and picture were sent to Tammie.'
      : "Your bio is saved. The email to Tammie didn't go through yet — it will keep trying automatically, so you don't need to send it again.";
    $('bioForm').classList.add('hidden');
    $('done').classList.remove('hidden');
    window.scrollTo(0, 0);
  } catch (err) {
    if (err.message !== 'Not signed in') $('formErr').textContent = err.message;
  } finally {
    $('send').disabled = false;
    $('send').textContent = 'Send my bio';
  }
});

$('again').addEventListener('click', () => start());

window.addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });
mpIdle({ ping: '/api/auth/ping', onSignedOut: () => { saveDraft(); showLogin(''); } });
start();
