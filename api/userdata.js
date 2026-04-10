// api/userdata.js — Per-user bot config storage (Upstash Redis)
import { verify } from './auth.js';

const KV_URL   = process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function kvGet(key) {
  if (!KV_URL) return null;
  const res  = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  const json = await res.json();
  return json.result ? JSON.parse(json.result) : null;
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const authHeader = req.headers.authorization || '';
  const payload    = verify(authHeader.replace('Bearer ', ''));
  if (!payload) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  const key = `userdata:${payload.sub}`;

  if (req.method === 'GET') {
    const data = await kvGet(key);
    return res.status(200).json({ ok: true, data: data || getDefault() });
  }

  if (req.method === 'POST') {
    const { data } = req.body || {};
    if (!data) return res.status(400).json({ ok: false, error: 'data required' });
    const saved = await kvSet(key, sanitize(data));
    if (!saved) return res.status(503).json({ ok: false, error: 'Database not connected.' });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

function getDefault() {
  return { tokens: [], selected: [], chatId: '', delay: 1200, pollInterval: 5, reactionMode: 'random', auto: true, history: [] };
}

function sanitize(data) {
  return {
    tokens:      (data.tokens || []).map(t => ({ id: t.id, token: t.token || '', name: t.name || '' })),
    selected:    data.selected     || [],
    chatId:      data.chatId       || '',
    delay:       Number(data.delay)|| 1200,
    pollInterval:Number(data.pollInterval) || 5,
    reactionMode:data.reactionMode || 'random',
    auto:        Boolean(data.auto),
    history:     (data.history || []).slice(0, 200),
  };
}
