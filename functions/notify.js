// Notifiche push (FCM v1) al tema "aggiornamenti".
// Segreto condiviso: header "x-notify-secret" == env.NOTIFY_SECRET
// Credenziali Firebase: env.FIREBASE_SERVICE_ACCOUNT (JSON del service account)

const TOPIC = 'aggiornamenti';
const PROJECT_ID = 'studio-converter-pro';

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

export async function onRequestPost(context) {
  const { request, env } = context;

  const secret = String(env.NOTIFY_SECRET || '');
  if (!secret) return json({ ok: false, error: 'NOTIFY_SECRET mancante' }, 500);

  const given = String(request.headers.get('x-notify-secret') || '');
  const auth = String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (given !== secret && auth !== secret) return json({ ok: false, error: 'secret' }, 401);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'json' }, 400);
  }

  if (!env.FIREBASE_SERVICE_ACCOUNT) return json({ ok: false, error: 'FIREBASE_SERVICE_ACCOUNT mancante' }, 500);

  let sa;
  try {
    sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  } catch (e) {
    return json({ ok: false, error: 'FIREBASE_SERVICE_ACCOUNT non e JSON valido' }, 500);
  }

  const title = String(body.title || 'Studio Converter Pro').slice(0, 120);
  const text = String(body.body || body.message || '').slice(0, 300);
  if (!text) return json({ ok: false, error: 'body mancante' }, 400);

  const data = {};
  if (body.version) data.version = String(body.version).slice(0, 20);
  if (body.apk_version) data.apk_version = String(body.apk_version).slice(0, 20);
  if (body.url) data.url = String(body.url).slice(0, 500);

  const payload = {
    message: {
      topic: TOPIC,
      notification: { title: title, body: text },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          click_action: 'OPEN_ACTIVITY_1',
          tag: 'aggiornamenti'
        }
      }
    }
  };
  if (Object.keys(data).length) payload.message.data = data;

  try {
    const token = await accessToken(sa);
    const res = await fetch('https://fcm.googleapis.com/v1/projects/' + PROJECT_ID + '/messages:send', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const out = await res.json();
    if (!res.ok) {
      return json({ ok: false, error: out.error || out }, res.status || 502);
    }
    return json({ ok: true, name: out.name || null, topic: TOPIC });
  } catch (e) {
    const detail = String((e && (e.message || e)) || 'unknown').slice(0, 400);
    console.error('notify error:', detail);
    return json({ ok: false, error: 'server', detail: detail }, 500);
  }
}

export async function onRequestGet() {
  return json({ ok: false, error: 'usa POST con header x-notify-secret' }, 405);
}
