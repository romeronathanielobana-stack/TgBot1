// api/auth.js — Register / Login endpoint
// Uses Vercel KV (if available) or in-memory fallback for demo
// Passwords are hashed with SHA-256 (for production, use bcrypt via edge runtime)

import crypto from 'crypto';

// ── Simple JWT-like token (HMAC-SHA256 signed) ──────────────
const SECRET = process.env.JWT_SECRET || 'tg-autoreact-secret-change-me';

function sign(payload) {
  const header  = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body    = btoa(JSON.stringify(payload));
  const sig     = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verify(token) {
  try {
    const [header, body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(atob(body));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

function hashPassword(pw) {
  return crypto.createHmac('sha256', SECRET + 'pw-salt').update(pw).digest('hex');
}

// ── User store (Vercel KV preferred, env-var fallback) ───────
// Users stored as: KV key "user:{username}" → JSON {username, passwordHash, createdAt}
// Fallback: process.env.USERS_JSON (base64 JSON object) - read-only seed accounts

async function getUser(username) {
  // Try Vercel KV
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const res = await fetch(`${process.env.KV_REST_API_URL}/get/user:${encodeURIComponent(username)}`, {
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
    });
    const json = await res.json();
    return json.result ? JSON.parse(json.result) : null;
  }
  // Fallback: env var seed
  try {
    const seed = process.env.USERS_JSON ? JSON.parse(Buffer.from(process.env.USERS_JSON, 'base64').toString()) : {};
    return seed[username] || null;
  } catch { return null; }
}

async function setUser(username, data) {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    await fetch(`${process.env.KV_REST_API_URL}/set/user:${encodeURIComponent(username)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(JSON.stringify(data)),
    });
    return true;
  }
  return false; // read-only fallback
}

// ── Handler ──────────────────────────────────────────────────
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
    const existing = await getUser(username);
    if (existing) return res.status(409).json({ ok: false, error: 'Username already taken' });
    const user = { username, passwordHash: hash, createdAt: Date.now() };
    const saved = await setUser(username, user);
    if (!saved) return res.status(503).json({ ok: false, error: 'Registration requires Vercel KV. Add KV storage to your project.' });
    const token = sign({ sub: username, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    return res.status(200).json({ ok: true, token, username });
  }

  if (action === 'login') {
    const user = await getUser(username);
    if (!user || user.passwordHash !== hash) return res.status(401).json({ ok: false, error: 'Invalid username or password' });
    const token = sign({ sub: username, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    return res.status(200).json({ ok: true, token, username });
  }

  return res.status(400).json({ ok: false, error: 'Unknown action' });
}
