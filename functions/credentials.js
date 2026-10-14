const USERS_KEY = 'users';
const OTPS_KEY = 'otps';
const GUEST_KEY = 'guest_counter';
const WARN_KEY = 'warn_otp';
const OTP_MINUTES = 10;

function normalizeUser(u) {
  return String(u == null ? '' : u).trim();
}

function normalizeEmail(e) {
  return String(e == null ? '' : e).trim().toLowerCase();
}

function findKey(users, u) {
  if (Object.prototype.hasOwnProperty.call(users, u)) return u;
  const lu = String(u).toLowerCase();
  for (const k in users) {
    if (k.toLowerCase() === lu) return k;
  }
  return null;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  });
}

async function getKV(env, key) {
  const ns = env && env.CREDS;
  if (!ns) throw new Error('binding CREDS mancante');
  const raw = await ns.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

async function setKV(env, key, val) {
  const ns = env && env.CREDS;
  if (!ns) throw new Error('binding CREDS mancante');
  await ns.put(key, JSON.stringify(val));
}

async function getUsers(env) {
  const data = await getKV(env, USERS_KEY);
  const users = (data && typeof data === 'object') ? data : {};
  let changed = false;
  for (const k in users) {
    if (typeof users[k] === 'string') { users[k] = { pass: users[k] }; changed = true; }
  }
  if (changed) { try { await setKV(env, USERS_KEY, users); } catch (e) { } }
  return users;
}

async function setUsers(env, users) {
  await setKV(env, USERS_KEY, users);
}

function genOtp() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function getPass(rec) {
  if (rec && typeof rec === 'object') return rec.pass;
  return rec;
}

// Invio email via SendGrid (mittente singolo verificato, gratis) oppure Resend.
// Chiavi in env.SENDGRID_API_KEY / env.RESEND_API_KEY (secret Cloudflare, MAI nel codice).
function mailConfigured(env) {
  return !!(env.SENDGRID_API_KEY || env.RESEND_API_KEY);
}

async function sendMail(env, to, subject, html) {
  if (!to) return { sent: false, error: 'no_recipient' };
  const sg = env.SENDGRID_API_KEY ? String(env.SENDGRID_API_KEY) : '';
  const rs = env.RESEND_API_KEY ? String(env.RESEND_API_KEY) : '';
  if (!sg && !rs) return { sent: false, error: 'mail_not_configured' };
  try {
    if (sg) {
      const fromAddr = env.MAIL_FROM_ADDR ? String(env.MAIL_FROM_ADDR) : '';
      if (!fromAddr) return { sent: false, error: 'mail_from_missing' };
      const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + sg, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: fromAddr, name: 'Studio Converter Pro' },
          subject: subject,
          content: [{ type: 'text/html', value: html }]
        })
      });
      if (!r.ok) {
        let msg = '';
        try {
          const j = await r.json();
          const errs = j && j.errors;
          msg = (errs && errs[0] && errs[0].message) || '';
        } catch (e) { }
        return { sent: false, error: String(msg || ('http_' + r.status)).slice(0, 200) };
      }
      return { sent: true };
    }
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + rs, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.MAIL_FROM ? String(env.MAIL_FROM) : 'Studio Converter Pro <onboarding@resend.dev>',
        to: [to],
        subject: subject,
        html: html
      })
    });
    if (!r.ok) {
      let msg = '';
      try { const j = await r.json(); msg = (j && j.message) || (j && j.name) || ''; } catch (e) { }
      return { sent: false, error: String(msg || ('http_' + r.status)).slice(0, 200) };
    }
    return { sent: true };
  } catch (e) {
    return { sent: false, error: 'mail_error' };
  }
}

function otpMail(code) {
  return '<div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:24px;">'
    + '<h2 style="margin:0 0 8px;">Il tuo codice di verifica</h2>'
    + '<p style="color:#555;margin:0 0 16px;">Inseriscilo in Studio Converter Pro per continuare. Scade tra ' + OTP_MINUTES + ' minuti.</p>'
    + '<div style="font-size:36px;font-weight:800;letter-spacing:12px;text-align:center;background:#f4f4f5;border-radius:12px;padding:16px;color:#111;">' + escapeHtml(code) + '</div>'
    + '<p style="color:#999;font-size:12px;margin:16px 0 0;">Se non hai richiesto tu questo codice, ignora questa email e cambia la password.</p></div>';
}

function resetMail(code) {
  return '<div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:24px;">'
    + '<h2 style="margin:0 0 8px;">Reimposta la password</h2>'
    + '<p style="color:#555;margin:0 0 16px;">Usa questo codice per creare una nuova password. Scade tra ' + OTP_MINUTES + ' minuti.</p>'
    + '<div style="font-size:36px;font-weight:800;letter-spacing:12px;text-align:center;background:#f4f4f5;border-radius:12px;padding:16px;color:#111;">' + escapeHtml(code) + '</div>'
    + '<p style="color:#999;font-size:12px;margin:16px 0 0;">Se non hai richiesto tu il reset, ignora questa email e cambia la password.</p></div>';
}

function warnMail(user) {
  return '<div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:24px;">'
    + '<h2 style="margin:0 0 8px;">Tentativo di accesso al tuo account</h2>'
    + '<p style="color:#555;margin:0;">Qualcuno ha inserito un codice di verifica <b>errato</b> per l\u2019account <b>' + escapeHtml(user) + '</b>.</p>'
    + '<p style="color:#555;">Se non sei tu, cambia subito la password.</p></div>';
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'json' }, 400); }

  const action = String(body.action || '');
  const u = normalizeUser(body.u);
  const p = String(body.p == null ? '' : body.p);
  const email = normalizeEmail(body.email);

  try {
    if (action === 'guest') {
      let counter = await getKV(env, GUEST_KEY) || 0;
      counter = (counter || 0) + 1;
      await setKV(env, GUEST_KEY, counter);
      const guestName = 'Guest ' + String(counter).padStart(2, '0');
      return json({ ok: true, user: guestName, guest: true });
    }

    if (u.length < 2 || u.length > 32 || !/^[A-Za-z0-9._-]+$/.test(u)) return json({ ok: false, error: 'user' }, 400);
    const NEED_PASS = ['signup', 'login', 'deleteAccount', 'updateUsername', 'updatePassword'];
    if (NEED_PASS.indexOf(action) !== -1 && (p.length < 4 || p.length > 128)) return json({ ok: false, error: 'pass' }, 400);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: 'email' }, 400);

    const users = await getUsers(env);

    if (action === 'signup') {
      const k = findKey(users, u);
      const h = await sha256(p);
      if (k && getPass(users[k]) !== h && getPass(users[k]) !== p) {
        return json({ ok: false, error: 'exists' });
      }
      if (!email) {
        const name = k || u;
        if (!k) {
          users[u] = { pass: h, created: Date.now() };
          await setUsers(env, users);
        }
        return json({ ok: true, user: name, needOtp: false });
      }
      const name = k || u;
      const otp = genOtp();
      const otpData = await getKV(env, OTPS_KEY) || {};
      otpData[name] = { otp, email, pass: h, ts: Date.now() };
      await setKV(env, OTPS_KEY, otpData);
      const mail = await sendMail(env, email, 'Il tuo codice di verifica — Studio Converter Pro', otpMail(otp));
      const resp = { ok: true, user: name, needOtp: true, emailSent: mail.sent };
      if (!mail.sent) {
        resp.emailError = mail.error;
        if (!mailConfigured(env)) resp.otp = otp;
      }
      return json(resp);
    }

    if (action === 'verifyOtp') {
      const otpData = await getKV(env, OTPS_KEY) || {};
      const rec = otpData[u];
      if (!rec) return json({ ok: false, error: 'no_otp' });
      if (Date.now() - rec.ts > OTP_MINUTES * 60 * 1000) return json({ ok: false, error: 'expired' });
      if (String(body.otp || '') !== rec.otp) {
        try {
          const owner = env.OWNER_EMAIL ? String(env.OWNER_EMAIL) : (env.MAIL_FROM_ADDR ? String(env.MAIL_FROM_ADDR) : '');
          if (owner) {
            const warns = await getKV(env, WARN_KEY) || {};
            if (Date.now() - (warns[u] || 0) > 3600 * 1000) {
              warns[u] = Date.now();
              await setKV(env, WARN_KEY, warns);
              await sendMail(env, owner, 'Tentativo di accesso — Studio Converter Pro', warnMail(u));
            }
          }
        } catch (e) { }
        return json({ ok: false, error: 'wrong_otp' });
      }
      const k = findKey(users, u);
      if (k) {
        const cur = (users[k] && typeof users[k] === 'object') ? users[k] : { pass: users[k] };
        cur.pass = rec.pass;
        if (email) cur.email = email;
        else if (rec.email) cur.email = rec.email;
        users[k] = cur;
      } else {
        users[u] = { pass: rec.pass, email: email || rec.email, created: Date.now() };
      }
      await setUsers(env, users);
      delete otpData[u];
      await setKV(env, OTPS_KEY, otpData);
      return json({ ok: true, user: u });
    }

    if (action === 'login') {
      const k = findKey(users, u);
      if (!k) return json({ ok: false });
      const h = await sha256(p);
      const rec = (users[k] && typeof users[k] === 'object') ? users[k] : { pass: users[k] };
      if (getPass(rec) !== h && getPass(rec) !== p) return json({ ok: false });
      if (getPass(rec) !== h) {
        users[k] = { pass: h, email: rec.email };
        try { await setUsers(env, users); } catch (e) { }
      }
      const loginEmail = rec.email || email;
      if (!loginEmail) return json({ ok: true, user: k, needOtp: false });
      const otp = genOtp();
      const otpData = await getKV(env, OTPS_KEY) || {};
      otpData[k] = { otp, email: loginEmail, pass: h, ts: Date.now() };
      await setKV(env, OTPS_KEY, otpData);
      const mail = await sendMail(env, loginEmail, 'Il tuo codice di verifica — Studio Converter Pro', otpMail(otp));
      const resp = { ok: true, user: k, needOtp: true, emailSent: mail.sent };
      if (!mail.sent) {
        resp.emailError = mail.error;
        if (!mailConfigured(env)) resp.otp = otp;
      }
      return json(resp);
    }

    if (action === 'deleteAccount') {
      const k = findKey(users, u);
      if (!k) return json({ ok: false });
      const h = await sha256(p);
      if (getPass(users[k]) !== h && getPass(users[k]) !== p) return json({ ok: false });
      delete users[k];
      await setUsers(env, users);
      return json({ ok: true });
    }

    if (action === 'resetPassword') {
      const k = findKey(users, u);
      if (!k) return json({ ok: false });
      const rec = (users[k] && typeof users[k] === 'object') ? users[k] : { pass: users[k] };
      const to = rec.email || email;
      if (!to) return json({ ok: false, error: 'noemail' });
      const otp = genOtp();
      const otpData = await getKV(env, OTPS_KEY) || {};
      otpData[k] = { otp, email: to, pass: null, ts: Date.now(), reset: true };
      await setKV(env, OTPS_KEY, otpData);
      const mail = await sendMail(env, to, 'Reimposta la password — Studio Converter Pro', resetMail(otp));
      const resp = { ok: true, user: k, needOtp: true, emailSent: mail.sent };
      if (!mail.sent) {
        resp.emailError = mail.error;
        if (!mailConfigured(env)) resp.otp = otp;
      }
      return json(resp);
    }

    if (action === 'verifyResetOtp') {
      const otpData = await getKV(env, OTPS_KEY) || {};
      const rec = otpData[u];
      if (!rec || !rec.reset) return json({ ok: false, error: 'no_otp' });
      if (Date.now() - rec.ts > OTP_MINUTES * 60 * 1000) return json({ ok: false, error: 'expired' });
      if (String(body.otp || '') !== rec.otp) return json({ ok: false, error: 'wrong_otp' });
      const newPass = String(body.newPass || '');
      if (newPass.length < 4 || newPass.length > 128) return json({ ok: false, error: 'pass' });
      const k = findKey(users, u);
      if (k) {
        const cur = (users[k] && typeof users[k] === 'object') ? users[k] : { pass: users[k] };
        cur.pass = await sha256(newPass);
        users[k] = cur;
        await setUsers(env, users);
      }
      delete otpData[u];
      await setKV(env, OTPS_KEY, otpData);
      return json({ ok: true, user: u });
    }

    if (action === 'updateUsername') {
      const k = findKey(users, u);
      if (!k) return json({ ok: false });
      const h = await sha256(p);
      if (getPass(users[k]) !== h && getPass(users[k]) !== p) return json({ ok: false });
      const newU = normalizeUser(body.newU);
      if (newU.length < 2 || newU.length > 32 || !/^[A-Za-z0-9._-]+$/.test(newU)) return json({ ok: false, error: 'user' });
      if (findKey(users, newU)) return json({ ok: false, error: 'exists' });
      users[newU] = users[k];
      delete users[k];
      await setUsers(env, users);
      return json({ ok: true, user: newU });
    }

    if (action === 'updatePassword') {
      const k = findKey(users, u);
      if (!k) return json({ ok: false });
      const h = await sha256(p);
      if (getPass(users[k]) !== h && getPass(users[k]) !== p) return json({ ok: false });
      const newPass = String(body.newPass || '');
      if (newPass.length < 4 || newPass.length > 128) return json({ ok: false, error: 'pass' });
      const cur = (users[k] && typeof users[k] === 'object') ? users[k] : { pass: users[k] };
      cur.pass = await sha256(newPass);
      users[k] = cur;
      await setUsers(env, users);
      return json({ ok: true });
    }

    return json({ ok: false, error: 'action' }, 400);
  } catch (e) {
    const detail = String((e && (e.message || e)) || 'unknown').slice(0, 400);
    console.error('credentials error:', detail);
    return json({ ok: false, error: 'server', detail: detail }, 500);
  }
}
