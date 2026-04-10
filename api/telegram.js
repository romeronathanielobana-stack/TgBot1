// api/telegram.js — Secure Telegram Bot API proxy (auth-gated)
import { verify } from './auth.js';

const ALLOWED_METHODS = [
  'getMe', 'getUpdates', 'sendMessage',
  'setMessageReaction', 'getChat',
  'getChatMember', 'getChatMemberCount',
  'forwardMessage', 'copyMessage',
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ ok: false, description: 'Method not allowed' });

  // Auth check
  const authHeader = req.headers.authorization || '';
  const jwtToken   = authHeader.replace('Bearer ', '');
  const payload    = verify(jwtToken);
  if (!payload) return res.status(401).json({ ok: false, description: 'Unauthorized' });

  const { token, method, params } = req.body || {};
  if (!token || !method) return res.status(400).json({ ok: false, description: 'token and method are required' });
  if (!/^\d{8,12}:[A-Za-z0-9_\-]{35}$/.test(token)) return res.status(400).json({ ok: false, description: 'Invalid token format' });
  if (!ALLOWED_METHODS.includes(method)) return res.status(403).json({ ok: false, description: `Method '${method}' not permitted` });

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params || {}),
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(502).json({ ok: false, description: `Proxy error: ${err.message}` });
  }
}
