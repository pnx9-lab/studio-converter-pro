// Notifiche push (FCM v1) al tema "aggiornamenti".
//
// REGOLA (2026-10-29): le push servono SOLO per problemi dell'app o manutenzione.
// NON si invia nulla per nuove versioni / aggiornamenti / novità.
//
// 1) POST /notify  {"check": true}                   -> NESSUNA push: aggiorna solo lo
//    stato in KV (retrocompatibile con la chiamata del sito).
// 2) POST /notify  {"status":"maintenance"}          -> push "Manutenzione in corso"
//    {"status":"issue"}                              -> push "Problema in corso"
//    {"status":"ok"}                                 -> push "Servizio ripristinato"
//    (testo personalizzabile con "body"/"message")
// 3) POST /notify  {title, body}                     -> invio libero
//    Tutti richiedono header "x-notify-secret" == env.NOTIFY_SECRET
//
// Credenziali Firebase: env.FIREBASE_SERVICE_ACCOUNT (JSON del service account)

const TOPIC = 'aggiornamenti';
const PROJECT_ID = 'studio-converter-pro';
const VERSION_URL = 'https://studioconverterpro.pages.dev/version.json';
const STATE_KEY = 'notify_state';

// Testi pronti per le push di stato (le uniche che devono partire)
const STATUS_PUSH = {
  maintenance: { title: '🛠 Manutenzione in corso', body: 'Stiamo lavorando per ripristinare il servizio. Riprova tra poco.' },
  issue: { title: '⚠️ Problema in corso', body: 'Stiamo verificando un problema. Riprova tra poco.' },
  ok: { title: '✅ Servizio ripristinato', body: 'Tutto torna a funzionare. Grazie per la pazienza!' }
};

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlStr(str) {
  return b64url(new TextEncoder().encode(str));
}

function derFromPem(pem) {
  const body = String(pem)
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, '')
    .replace(/-----END [A-Z ]*PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };
  const signingInput = b64urlStr(JSON.stringify(header)) + '.' + b64urlStr(JSON.stringify(claims));
  const key = await crypto.subtle.importKey(
    'pkcs8',
    derFromPem(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const jwt = signingInput + '.' + b64url(new Uint8Array(sig));

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error('token: ' + (data.error_description || data.error || res.status));
  }
  return data.access_token;
}

function serviceAccount(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT mancante');
  return JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
}

// Invio di una notifica al tema
async function sendPush(env, opts) {
  const title = String(opts.title || 'Studio Converter Pro').slice(0, 120);
  const text = String(opts.body || '').slice(0, 300);
  if (!text) throw new Error('body mancante');

  const data = {};
  if (opts.version) data.version = String(opts.version).slice(0, 20);
  if (opts.build) data.build = String(opts.build).slice(0, 20);
  if (opts.url) data.url = String(opts.url).slice(0, 500);

  const payload = {
    message: {
      topic: TOPIC,
      notification: { title: title, body: text },
      android: {
        priority: 'high',
        notification: { sound: 'default', tag: 'aggiornamenti' }
      }
    }
  };
  if (Object.keys(data).length) payload.message.data = data;

  const token = await accessToken(serviceAccount(env));
  const res = await fetch('https://fcm.googleapis.com/v1/projects/' + PROJECT_ID + '/messages:send', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const out = await res.json();
  if (!res.ok) {
    const e = new Error('fcm: ' + JSON.stringify(out.error || out).slice(0, 300));
    e.status = res.status || 502;
    throw e;
  }
  return out.name || null;
}

// Controllo automatico: NON invia più push. Aggiorna solo lo stato in KV.
// (regola 2026-10-29: le push servono solo per problemi/manutenzione, mai per gli aggiornamenti)
async function handleCheck(env) {
  if (!env.CREDS) return json({ ok: false, error: 'binding CREDS mancante' }, 500);

  let data;
  try {
    const res = await fetch(VERSION_URL + '?t=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } });
    data = await res.json();
  } catch (e) {
    return json({ ok: false, error: 'version.json' }, 502);
  }

  const version = String(data.version || '');
  const build = String(data.build == null ? '0' : data.build);
  if (!version) return json({ ok: false, error: 'versione mancante' }, 502);

  const now = version + '#' + build;
  await env.CREDS.put(STATE_KEY, now);
  await env.CREDS.put('notify_apk', String(data.apk_version || '') || version);
  return json({ ok: true, sent: false, state: now, note: 'update push disabilitate' });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body = {};
  try {
    body = await request.json();
  } catch (e) { body = {}; }

  // --- controllo automatico (chiamato dal sito) ---
  if (body && body.check === true) return handleCheck(env);

  // --- invio libero con secret ---
  const secret = String(env.NOTIFY_SECRET || '');
  if (!secret) return json({ ok: false, error: 'NOTIFY_SECRET mancante' }, 500);
  const given = String(request.headers.get('x-notify-secret') || '');
  const auth = String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (given !== secret && auth !== secret) return json({ ok: false, error: 'secret' }, 401);

  try {
    // --- push di stato: manutenzione / problema / ripristino ---
    const st = String(body.status || '').toLowerCase();
    if (st) {
      const preset = STATUS_PUSH[st];
      if (!preset) return json({ ok: false, error: 'status non valido (maintenance|issue|ok)' }, 400);
      const name = await sendPush(env, {
        title: body.title || preset.title,
        body: body.body || body.message || preset.body,
        url: body.url || ''
      });
      return json({ ok: true, sent: true, status: st, name: name, topic: TOPIC });
    }

    const name = await sendPush(env, {
      title: body.title || 'Studio Converter Pro',
      body: body.body || body.message || '',
      version: body.version || '',
      build: body.build || '',
      url: body.url || ''
    });
    return json({ ok: true, name: name, topic: TOPIC });
  } catch (e) {
    const detail = String((e && (e.message || e)) || 'unknown').slice(0, 400);
    console.error('notify error:', detail);
    return json({ ok: false, error: 'server', detail: detail }, e.status || 500);
  }
}

export async function onRequestGet() {
  return json({ ok: false, error: 'usa POST {"check":true} o POST con header x-notify-secret' }, 405);
}
