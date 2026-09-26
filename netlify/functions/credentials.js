const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STORE_NAME = 'studio-converter-credentials';
const USERS_KEY = 'users';
const LOCAL_FILE = path.join(__dirname, '.data-users.json');

function isNetlify() {
  return String(process.env.NETLIFY || '').toLowerCase() === 'true' || !!process.env.DEPLOY_ID || !!process.env.SITE_ID;
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

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

// Ritorna lo store Blobs, oppure null in locale (sviluppo/test senza Netlify)
async function openStore() {
  let mod = null;
  try {
    mod = await import('@netlify/blobs');
  } catch (e) {
    if (isNetlify()) throw new Error('blobs import: ' + String((e && e.message) || e));
    return null;
  }
  const getStore = mod.getStore || (mod.default && mod.default.getStore);
  if (typeof getStore !== 'function') {
    if (isNetlify()) throw new Error('@netlify/blobs: getStore non disponibile');
    return null;
  }
  try {
    return getStore(STORE_NAME);
  } catch (e) {
    throw new Error('blobs getStore: ' + String((e && e.message) || e));
  }
}

async function getUsers() {
  const store = await openStore();
  if (store) {
    try {
      const data = await store.get(USERS_KEY, { type: 'json' });
      return (data && typeof data === 'object') ? data : {};
    } catch (e) {
      throw new Error('blobs get: ' + String((e && e.message) || e));
    }
  }
  try {
    return JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

async function setUsers(users) {
  const store = await openStore();
  if (store) {
    try {
      await store.set(USERS_KEY, JSON.stringify(users));
    } catch (e) {
      throw new Error('blobs set: ' + String((e && e.message) || e));
    }
    return;
  }
  fs.writeFileSync(LOCAL_FILE, JSON.stringify(users, null, 2));
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(obj)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'method' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { ok: false, error: 'json' });
  }

  const action = String(body.action || '');
  const u = normalizeUser(body.u);
  const p = String(body.p == null ? '' : body.p);

  if (u.length < 2 || u.length > 32 || !/^[A-Za-z0-9._-]+$/.test(u)) return json(400, { ok: false, error: 'user' });
  if (p.length < 4 || p.length > 128) return json(400, { ok: false, error: 'pass' });

  try {
    const users = await getUsers();

    if (action === 'signup') {
      const k = findKey(users, u);
      if (k) {
        const h = sha256(p);
        if (users[k] === h || users[k] === p) {
          return json(200, { ok: true, user: k, existed: true });
        }
        return json(200, { ok: false, error: 'exists' });
      }
      users[u] = sha256(p);
      await setUsers(users);
      return json(200, { ok: true, user: u });
    }

    if (action === 'login') {
      const k = findKey(users, u);
      if (!k) return json(200, { ok: false });
      const h = sha256(p);
      if (users[k] === h || users[k] === p) {
        if (users[k] !== h) {
          users[k] = h;
          try { await setUsers(users); } catch (e) { }
        }
        return json(200, { ok: true, user: k });
      }
      return json(200, { ok: false });
    }

    return json(400, { ok: false, error: 'action' });
  } catch (e) {
    const detail = String((e && (e.message || e)) || 'unknown').slice(0, 400);
    console.error('credentials error:', detail);
    return json(500, { ok: false, error: 'server', detail: detail });
  }
};
