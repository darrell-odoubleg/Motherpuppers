// Emails a staff bio (with the picture attached) to NOTIFY_TO. Delivered straight to
// motherpuppers.net's Microsoft 365 mail server, with no mailbox login. Outbound port 25
// only works over IPv6 from this server, and Microsoft wants SPF there, so
// bio.motherpuppers.net needs a TXT record listing this server's IPv6 address.
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const QUESTIONS = [
  ['journey', 'My journey with animals'],
  ['love', 'What I love about Mother Puppers'],
  ['outside', 'Life outside the Kennel'],
];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function bodies(b) {
  const when = new Date(b.created_at).toLocaleString('en-US', { timeZone: process.env.TZ_NAME || 'America/Denver', dateStyle: 'medium', timeStyle: 'short' });
  const text = [
    `Staff bio from ${b.name} (login: ${b.username}), sent ${when}`,
    '',
    ...QUESTIONS.flatMap(([k, q]) => [q.toUpperCase(), b[k], '']),
    'Picture attached.',
  ].join('\n');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#2a2a2a;max-width:640px">
<h2 style="color:#7357a4;margin:0 0 4px">${esc(b.name)}</h2>
<p style="color:#6b6775;margin:0 0 16px;font-size:13px">Staff bio · login ${esc(b.username)} · ${esc(when)}</p>
<p><img src="cid:bio-photo" alt="${esc(b.name)}" style="max-width:320px;height:auto;border-radius:8px"></p>
${QUESTIONS.map(([k, q]) => `<h3 style="color:#7357a4;margin:20px 0 6px;font-size:16px">${q}</h3><p style="margin:0;white-space:pre-wrap">${esc(b[k])}</p>`).join('\n')}
</div>`;
  return { text, html };
}

async function sendBio(b, jpeg) {
  const { NOTIFY_TO, NOTIFY_FROM, SMTP_HOST, SMTP_PORT } = process.env;
  if (!NOTIFY_TO || !SMTP_HOST) throw new Error('Email is not set up (NOTIFY_TO / SMTP_HOST)');
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 25,
    secure: false,
    name: 'bio.motherpuppers.net',
    connectionTimeout: 20000,
    disableFileAccess: true,
    disableUrlAccess: true,
    // DKIM signing once DKIM_SELECTOR is set (TXT at <selector>._domainkey.bio.motherpuppers.net).
    ...(process.env.DKIM_SELECTOR ? { dkim: {
      domainName: 'bio.motherpuppers.net',
      keySelector: process.env.DKIM_SELECTOR,
      privateKey: fs.readFileSync(process.env.DKIM_KEY_FILE || path.join(__dirname, '..', 'db', 'dkim', 'bio.key'), 'utf8'),
    } } : {}),
  });
  const safe = b.name.replace(/[^\w .-]+/g, '').trim() || 'staff';
  await transport.sendMail({
    from: { name: 'Mother Puppers Bios', address: NOTIFY_FROM },
    to: NOTIFY_TO,
    subject: `Staff bio: ${b.name}`,
    ...bodies(b),
    attachments: [
      { filename: `${safe}.jpg`, content: jpeg, contentType: 'image/jpeg', cid: 'bio-photo' },
    ],
  });
}

module.exports = { sendBio };
