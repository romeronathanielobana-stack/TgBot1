// api/auth.js — Register / Login endpoint
import crypto from 'crypto';

const SECRET = process.env.JWT_SECRET || 'tg-autoreact-secret-change-me';

// Node.js-safe base64 (btoa/atob are browser-only)
const b64enc = s => Buffer.from(s, 'utf8').toString('base64');
const b64dec = s => Buffer.from(s, 'base64').toString('utf8');

function sign(payload) {
  const header = b64enc(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body   = b64enc(JSON.stringify(payload));
  const sig    = crypto.createHmac('sha256', SECRET)
                       .update(`${header}.${body}`)
                       .digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verify(token) {
  try {
    if (!token || !token.includes('.')) return null;
    const [header, body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', SECRET)
                           .update(`${header}.${body}`)
                           .digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(b64dec(body));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

function hashPassword(pw) {
  return crypto.createHmac('sha256', SECRET + 'pw-salt').update(pw).digest('hex');
}

// ── KV helpers ───────────────────────────────────────────────
// Support both Upstash env var naming conventions
const KV_URL   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN  || process.env.UPSTASH_REDIS_REST_TOKEN;

async function kvGet(key) {
  if (!KV_URL) return null;
  try {
    const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.result) return null;
    return typeof json.result === 'string' ? JSON.parse(json.result) : json.result;
  } catch { return null; }
}

async function kvSet(key, value) {
  if (!KV_URL) return false;
  try {
    const res = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(JSON.stringify(value)),
    });
    return res.ok;
  } catch { return false; }
}

// ── Handler ───────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const { action, username, password } = req.body || {};

  if (!username || !password) return res.status(400).json({ ok: false, error: 'Username and password required' });
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) return res.status(400).json({ ok: false, error: 'Username must be 3-32 alphanumeric characters' });
  if (password.length < 6) return res.status(400).json({ ok: false, error: 'Password must be at least 6 characters' });

  const hash = hashPassword(password);

  // ── Fallback: env-var credentials (set ADMIN_USERNAME + ADMIN_PASSWORD in Vercel) ──
  const envUser = process.env.ADMIN_USERNAME;
  const envPass = process.env.ADMIN_PASSWORD;
  if (envUser && envPass && username === envUser && password === envPass) {
    const token = sign({ sub: username, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    return res.status(200).json({ ok: true, token, username });
  }

  if (!KV_URL) {
    return res.status(503).json({
      ok: false,
      error: 'Database not connected. Set ADMIN_USERNAME + ADMIN_PASSWORD in Vercel env vars, or add Upstash Redis.'
    });
  }

  if (action === 'register') {
    const existing = await kvGet(`user:${username}`);
    if (existing) return res.status(409).json({ ok: false, error: 'Username already taken' });
    const saved = await kvSet(`user:${username}`, { username, passwordHash: hash, createdAt: Date.now() });
    if (!saved) return res.status(503).json({ ok: false, error: 'Failed to save user. Check KV database.' });
    const token = sign({ sub: username, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    return res.status(200).json({ ok: true, token, username });
  }

  if (action === 'login') {
    const user = await kvGet(`user:${username}`);
    if (!user) return res.status(401).json({ ok: false, error: 'User not found. Please register first.' });
    if (user.passwordHash !== hash) return res.status(401).json({ ok: false, error: 'Incorrect password.' });
    const token = sign({ sub: username, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    return res.status(200).json({ ok: true, token, username });
  }

  return res.status(400).json({ ok: false, error: 'Unknown action' });
}
