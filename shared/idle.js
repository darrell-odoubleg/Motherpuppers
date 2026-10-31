// Idle sign-out for the Mother Puppers staff sites (cleaning, walks, schedules, the app).
// The server ends a sign-in after 15 minutes with no taps or typing; only real use renews it
// (the pages' automatic refreshes don't). A minute before, this shows a warning with a
// "Stay signed in" button. Inside the app's frames the app shows the warning, not the frame.
// Usage: mpIdle({ ping: '/api/auth/ping', onSignedOut() { ... } })
window.mpIdle = function mpIdle({ ping, onSignedOut }) {
  const WARN_MS = 60000;
  const framed = window.top !== window;
  let lastPost = 0, timer = null, tick = null, deadline = 0, box = null;

  function check(method) {
    clearTimeout(timer);
    return fetch(ping, { method }).then((r) => {
      // Signed out: keep looking now and then, so a sign-in on this page is picked up.
      if (r.status === 401) { hideWarning(); onSignedOut(); timer = setTimeout(() => check('GET'), 60000); return; }
      return r.json().then((d) => {
        deadline = Date.now() + d.left_ms;
        if (d.left_ms <= WARN_MS && !framed) showWarning(); else hideWarning();
        // Look again when the warning is due (or every minute), sooner while it shows.
        timer = setTimeout(() => check('GET'), box ? 5000 : Math.min(60000, Math.max(1000, d.left_ms - WARN_MS)));
      });
    }).catch(() => { timer = setTimeout(() => check('GET'), 30000); });
  }
  function active() {
    if (box || Date.now() - lastPost > 30000) { lastPost = Date.now(); check('POST'); }
  }

  function showWarning() {
    if (!box) {
      box = document.createElement('div');
      box.setAttribute('role', 'alertdialog');
      box.setAttribute('aria-live', 'assertive');
      box.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(20,16,28,.55);font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
      box.innerHTML = '<div style="background:#fff;color:#2a2a2a;border-radius:12px;border-top:5px solid #7357a4;padding:20px 22px;max-width:340px;width:100%;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.3)">'
        + '<div style="font-weight:700;font-size:17px;margin-bottom:6px">Still there?</div>'
        + '<div>You’ll be signed out in <b data-left>1:00</b> because nothing has been tapped for a while.</div>'
        + '<button type="button" style="margin-top:14px;width:100%;padding:11px;border:0;border-radius:8px;background:#7357a4;color:#fff;font:inherit;font-weight:700;cursor:pointer">Stay signed in</button></div>';
      box.querySelector('button').addEventListener('click', () => { lastPost = 0; active(); });
      document.body.appendChild(box);
      tick = setInterval(countdown, 1000);
    }
    countdown();
  }
  function countdown() {
    const s = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    box.querySelector('[data-left]').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (s === 0) check('GET');
  }
  function hideWarning() {
    if (!box) return;
    clearInterval(tick);
    box.remove();
    box = null;
  }

  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchmove']) addEventListener(ev, active, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check('GET'); });
  active();
};
