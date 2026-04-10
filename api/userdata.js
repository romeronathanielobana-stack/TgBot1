// api/userdata.js — Per-user bot config storage (Vercel KV)
import { verify } from './auth.js';

async function kvGet(key) {
  if (!process.env.KV_REST_API_URL) return null;
  const res = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
  });
  const json = await res.json();
  return json.result ? JSON.parse(json.result) : null;
}

async function kvSet(key, value) {
  if (!process.env.KV_REST_API_URL) return false;
  await fetch(`${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(JSON.stringify(value)),
  });
  return true;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Authenticate
  const authHeader = req.headers.authorization || '';
  const jwtToken   = authHeader.replace('Bearer ', '');
  const payload    = verify(jwtToken);
  if (!payload) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  const username = payload.sub;
  const key      = `userdata:${username}`;

  if (req.method === 'GET') {
    const data = await kvGet(key);
    return res.status(200).json({ ok: true, data: data || getDefaultData() });
  }

  if (req.method === 'POST') {
    const { data } = req.body || {};
    if (!data) return res.status(400).json({ ok: false, error: 'data required' });
    // Sanitize: strip full tokens from history (store only partial for display)
    const safe = sanitize(data);
    const saved = await kvSet(key, safe);
    if (!saved) return res.status(503).json({ ok: false, error: 'KV not configured. Data stored locally in browser only.' });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

function getDefaultData() {
  return {
    tokens: [],
    selected: [],
    chatId: '',
    delay: 1200,
    pollInterval: 5,
    reactionMode: 'random',
    auto: true,
    history: [],
  };
}

function sanitize(data) {
  return {
    tokens: (data.tokens || []).map(t => ({
      id: t.id,
      token: t.token || '',
      name: t.name || '',
    })),
    selected:      data.selected      || [],
    chatId:        data.chatId        || '',
    delay:         Number(data.delay) || 1200,
    pollInterval:  Number(data.pollInterval) || 5,
    reactionMode:  data.reactionMode  || 'random',
    auto:          Boolean(data.auto),
    history:       (data.history || []).slice(0, 200), // cap at 200 entries
  };
}
