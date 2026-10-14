const PREM_PREFIX = 'prem:';

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

// Valida una licenza Lemon Squeezy tramite la loro API (la API key sta nei segreti Pages)
async function validateLemonSqueezy(env, key) {
  const r = await fetch('https://api.lemonsqueezy.com/v1/licenses/validate/' + encodeURIComponent(key), {
    headers: {
      'Authorization': 'Bearer ' + env.LS_API_KEY,
      'Accept': 'application/vnd.api+json'
    }
  });
  if (!r.ok) return null;
  let j = null;
  try { j = await r.json(); } catch (e) { return null; }
  const a = j && j.data && j.data.attributes;
  if (!a || a.valid !== true) return null;
  let until = 0;
  if (a.expires_at) until = Date.parse(a.expires_at) || 0;
  return { until: until, activated: a.activated !== false };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'json' }, 400); }

  const key = String(body.key || '').trim();
  if (!key || key.length > 200) return json({ ok: false, error: 'key' }, 400);

  try {
    const adminCode = env.ADMIN_CODE ? String(env.ADMIN_CODE) : '';
    if (adminCode && key === adminCode) {
      return json({ ok: true, plan: 'owner', until: 0 });
    }

    if (!env.LS_API_KEY) return json({ ok: false, error: 'nokey' }, 500);
    const v = await validateLemonSqueezy(env, key);
    if (!v || !v.activated) return json({ ok: false, error: 'invalid' });
    if (v.until && v.until < Date.now()) return json({ ok: false, error: 'expired' });

    const ns = env.CREDS;
    if (ns) {
      const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
      const hex = Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
      await ns.put(PREM_PREFIX + hex, JSON.stringify({ until: v.until, ts: Date.now() }));
    }

    return json({ ok: true, plan: 'pro', until: v.until });
  } catch (e) {
    const detail = String((e && (e.message || e)) || 'unknown').slice(0, 300);
    console.error('premium error:', detail);
    return json({ ok: false, error: 'server' }, 500);
  }
}
