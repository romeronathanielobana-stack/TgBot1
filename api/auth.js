// api/auth.js — Register / Login endpoint
import crypto from 'crypto';

const SECRET = process.env.JWT_SECRET || 'tg-autoreact-secret-change-me';

// Use Buffer instead of btoa/atob — those are browser APIs, not available in Node.js
function b64encode(str) {
  return Buffer.from(str).toString('base64');
}
function b64decode(str) {
  return Buffer.from(str, 'base64').toString('utf8');
}

function sign(payload) {
  const header = b64encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body   = b64encode(JSON.stringify(payload));
  const sig    = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verify(token) {
  try {
    const [header, body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(b64decode(body));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

function hashPassword(pw) {
  return crypto.createHmac('sha256', SECRET + 'pw-salt').update(pw).digest('hex');
}

// ── KV helpers ───────────────────────────────────────────────
const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kvGet(key) {
  if (!KV_URL) return null;
  const res  = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  const json = await res.json();
  if (!json.result) return null;
  // Handle both raw object and double-stringified value
  try {
    return typeof json.result === 'string' ? JSON.parse(json.result) : json.result;
  } catch { return null; }
}

async function kvSet(key, value) {
  if (!KV_URL) return false;
  await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(JSON.stringify(value)),
  });
  return true;
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
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) return res.status(400).json({ ok: false, error: 'Username must be 3–32 alphanumeric characters' });
  if (password.length < 6) return res.status(400).json({ ok: false, error: 'Password must be at least 6 characters' });

  const hash = hashPassword(password);

  if (action === 'register') {
    if (!KV_URL) return res.status(503).json({ ok: false, error: 'Database not connected. Add Upstash Redis in Vercel Storage tab.' });
    const existing = await kvGet(`user:${username}`);
    if (existing) return res.status(409).json({ ok: false, error: 'Username already taken' });
    await kvSet(`user:${username}`, { username, passwordHash: hash, createdAt: Date.now() });
    const token = sign({ sub: username, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    return res.status(200).json({ ok: true, token, username });
  }

  if (action === 'login') {
    if (!KV_URL) return res.status(503).json({ ok: false, error: 'Database not connected. Add Upstash Redis in Vercel Storage tab.' });
    const user = await kvGet(`user:${username}`);
    if (!user || user.passwordHash !== hash) return res.status(401).json({ ok: false, error: 'Invalid username or password' });
    const token = sign({ sub: username, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    return res.status(200).json({ ok: true, token, username });
  }

  return res.status(400).json({ ok: false, error: 'Unknown action' });
}
