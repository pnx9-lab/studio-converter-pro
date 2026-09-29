const USERS_KEY = 'users';

function normalizeUser(u) {
  return String(u == null ? '' : u).trim();
}

function findKey(users, u) {
  if (Object.prototype.hasOwnProperty.call(users, u)) return u;
  const lu = String(u).toLowerCase();
  for (const k in users) {
    if (k.toLowerCase() === lu) return k;
  }
  return null;
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

// Preflight per l'app Android (origine https://localhost) che sincronizza gli account
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

// Database credenziali condiviso su Cloudflare Workers KV (KV binding "CREDS")
async function getUsers(env) {
  const ns = env && env.CREDS;
  if (!ns) throw new Error('binding CREDS mancante: crea la KV namespace e collegala al progetto Pages');
  const raw = await ns.get(USERS_KEY);
  if (!raw) return {};
  try {
    const data = JSON.parse(raw);
    return (data && typeof data === 'object') ? data : {};
  } catch (e) {
    return {};
  }
}

async function setUsers(env, users) {
  const ns = env && env.CREDS;
  if (!ns) throw new Error('binding CREDS mancante: crea la KV namespace e collegala al progetto Pages');
  await ns.put(USERS_KEY, JSON.stringify(users));
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'json' }, 400);
  }

  const action = String(body.action || '');
  const u = normalizeUser(body.u);
  const p = String(body.p == null ? '' : body.p);

  if (u.length < 2 || u.length > 32 || !/^[A-Za-z0-9._-]+$/.test(u)) return json({ ok: false, error: 'user' }, 400);
  if (p.length < 4 || p.length > 128) return json({ ok: false, error: 'pass' }, 400);

  try {
    const users = await getUsers(env);

    if (action === 'signup') {
      const k = findKey(users, u);
      if (k) {
        const h = await sha256(p);
        if (users[k] === h || users[k] === p) {
          return json({ ok: true, user: k, existed: true });
        }
        return json({ ok: false, error: 'exists' });
      }
      users[u] = await sha256(p);
      await setUsers(env, users);
      return json({ ok: true, user: u });
    }

    if (action === 'login') {
      const k = findKey(users, u);
      if (!k) return json({ ok: false });
      const h = await sha256(p);
      if (users[k] === h || users[k] === p) {
        if (users[k] !== h) {
          users[k] = h;
          try { await setUsers(env, users); } catch (e) { }
        }
        return json({ ok: true, user: k });
      }
      return json({ ok: false });
    }

    return json({ ok: false, error: 'action' }, 400);
  } catch (e) {
    const detail = String((e && (e.message || e)) || 'unknown').slice(0, 400);
    console.error('credentials error:', detail);
    return json({ ok: false, error: 'server', detail: detail }, 500);
  }
}
