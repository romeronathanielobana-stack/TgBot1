// ── CONFIG ──────────────────────────────────────────────
const EMOJIS = [
  '👍','👎','❤️','🔥','🎉','🤩','🥰','😁','😱','😢',
  '💯','🤣','😂','🙏','👏','😍','🤔','🤯','😎','🫡',
  '💀','⚡','🌚','🌭','💋','👻','🎃','🎄','🎆','🎇',
  '🦄','🐳','🕊️','🐾','🍓','🍾','🍕','🎸','🎯','🏆'
];

// ── STATE ────────────────────────────────────────────────
let tokens    = [];           // [{id, token, name, valid}]
let selected  = new Set();    // selected emoji indices
let running   = false;
let pollTimer = null;
let seenMsgs  = new Set();
let stats     = { bots:0, reactions:0, messages:0 };
let tokenIdxCounter = 0;

// ── INIT ─────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  buildEmojiGrid();
  addToken(); // start with one token row
  loadFromStorage();
});

// ── STORAGE ──────────────────────────────────────────────
function saveToStorage() {
  const data = {
    tokens:   tokens.map(t => ({...t, valid: null})),
    selected: [...selected],
    chatId:   document.getElementById('chatId').value,
    delay:    document.getElementById('delay').value,
    poll:     document.getElementById('pollInterval').value,
    mode:     document.getElementById('reactionMode').value,
    auto:     document.getElementById('autoToggle').checked,
  };
  try { localStorage.setItem('tgAutoReact', JSON.stringify(data)); } catch(_) {}
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem('tgAutoReact');
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d.tokens?.length) {
      document.getElementById('tokenList').innerHTML = '';
      tokens = [];
      d.tokens.forEach(t => addToken(t.token));
    }
    if (d.selected) { selected = new Set(d.selected); refreshEmojiGrid(); }
    if (d.chatId)   document.getElementById('chatId').value = d.chatId;
    if (d.delay)    document.getElementById('delay').value  = d.delay;
    if (d.poll)     document.getElementById('pollInterval').value = d.poll;
    if (d.mode)     document.getElementById('reactionMode').value = d.mode;
    if (d.auto !== undefined) document.getElementById('autoToggle').checked = d.auto;
  } catch(_) {}
}

// ── TOKEN MANAGEMENT ─────────────────────────────────────
function addToken(prefill = '') {
  const id = ++tokenIdxCounter;
  const obj = { id, token: prefill, name: `Bot #${id}`, valid: null };
  tokens.push(obj);

  const row = document.createElement('div');
  row.className = 'token-row';
  row.dataset.id = id;
  row.innerHTML = `
    <span class="token-label">BOT TOKEN ${id}</span>
    <input type="text" placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
           value="${escHtml(prefill)}"
           oninput="onTokenInput(${id}, this.value)"
           autocomplete="off" spellcheck="false" />
    <span class="status-dot" id="dot-${id}" title="Unknown"></span>
    <button class="btn-icon" onclick="removeToken(${id})" title="Remove">✕</button>
  `;
  document.getElementById('tokenList').appendChild(row);
  updateBotCount();
}

function onTokenInput(id, val) {
  const t = tokens.find(x => x.id === id);
  if (t) { t.token = val.trim(); t.valid = null; }
  const dot = document.getElementById(`dot-${id}`);
  if (dot) { dot.className = 'status-dot'; dot.title = 'Unknown'; }
  updateBotCount();
  saveToStorage();
}

function removeToken(id) {
  tokens = tokens.filter(t => t.id !== id);
  const row = document.querySelector(`.token-row[data-id="${id}"]`);
  if (row) row.remove();
  updateBotCount();
  saveToStorage();
}

function updateBotCount() {
  const valid = tokens.filter(t => t.token && t.valid !== false).length;
  stats.bots = valid;
  document.getElementById('statBots').textContent = valid;
}

// ── EMOJI GRID ───────────────────────────────────────────
function buildEmojiGrid() {
  const grid = document.getElementById('emojiGrid');
  grid.innerHTML = '';
  EMOJIS.forEach((em, i) => {
    const btn = document.createElement('button');
    btn.className = 'emoji-btn';
    btn.textContent = em;
    btn.title = em;
    btn.onclick = () => toggleEmoji(i, btn);
    btn.id = `em-${i}`;
    grid.appendChild(btn);
  });
}

function toggleEmoji(i, btn) {
  if (selected.has(i)) { selected.delete(i); btn.classList.remove('selected'); }
  else { selected.add(i); btn.classList.add('selected'); }
  saveToStorage();
}

function refreshEmojiGrid() {
  EMOJIS.forEach((_, i) => {
    const btn = document.getElementById(`em-${i}`);
    if (btn) btn.classList.toggle('selected', selected.has(i));
  });
}

// ── TOKEN VALIDATION ─────────────────────────────────────
async function testTokens() {
  log('Validating tokens…', 'info');
  let ok = 0;
  for (const t of tokens) {
    if (!t.token) continue;
    const dot = document.getElementById(`dot-${t.id}`);
    dot.className = 'status-dot checking'; dot.title = 'Checking…';
    try {
      const res = await callApi(t.token, 'getMe', {});
      if (res.ok) {
        t.valid = true; t.name = `@${res.result.username}`;
        dot.className = 'status-dot ok'; dot.title = t.name;
        log(`✓ Token #${t.id} → ${t.name}`, 'ok');
        ok++;
      } else { throw new Error(res.description); }
    } catch(e) {
      t.valid = false;
      dot.className = 'status-dot error'; dot.title = 'Invalid token';
      log(`✗ Token #${t.id} → ${e.message}`, 'error');
    }
  }
  log(`Validation complete: ${ok}/${tokens.filter(x=>x.token).length} valid.`, ok > 0 ? 'ok' : 'error');
  updateBotCount();
}

// ── BOT CORE ─────────────────────────────────────────────
async function startBot() {
  const chatId = document.getElementById('chatId').value.trim();
  if (!chatId) { log('⚠ Please enter a Channel/Group username.', 'warn'); return; }
  const activeToks = tokens.filter(t => t.token);
  if (!activeToks.length) { log('⚠ Add at least one bot token.', 'warn'); return; }
  if (!selected.size) { log('⚠ Select at least one reaction emoji.', 'warn'); return; }

  await testTokens();
  const validToks = tokens.filter(t => t.valid);
  if (!validToks.length) { log('✗ No valid tokens found.', 'error'); return; }

  running = true;
  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled  = false;
  setProgress(100);
  log(`▶ Bot started with ${validToks.length} token(s) on ${chatId}`, 'ok');

  const pollMs = parseInt(document.getElementById('pollInterval').value, 10) * 1000 || 5000;
  pollTimer = setInterval(() => pollMessages(chatId, validToks), pollMs);
  pollMessages(chatId, validToks);
}

function stopBot() {
  running = false;
  clearInterval(pollTimer); pollTimer = null;
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled  = true;
  setProgress(0);
  log('■ Bot stopped.', 'warn');
}

async function pollMessages(chatId, validToks) {
  if (!running) return;
  try {
    // Use first valid token to read updates
    const res = await callApi(validToks[0].token, 'getUpdates', { timeout: 2, allowed_updates: ['channel_post','message'] });
    if (!res.ok) { log(`Poll error: ${res.description}`, 'error'); return; }

    const updates = res.result || [];
    for (const upd of updates) {
      const msg = upd.channel_post || upd.message;
      if (!msg) continue;
      const key = `${msg.chat.id}-${msg.message_id}`;
      if (seenMsgs.has(key)) continue;
      seenMsgs.add(key);

      if (String(msg.chat.id) !== String(chatId) &&
          msg.chat.username !== chatId.replace('@','')) continue;

      stats.messages++;
      document.getElementById('statMessages').textContent = stats.messages;
      log(`📨 New message #${msg.message_id} in ${msg.chat.title || chatId}`, 'info');

      if (document.getElementById('autoToggle').checked) {
        await reactToMessage(msg.chat.id, msg.message_id, validToks);
      }
    }
    // Acknowledge updates
    if (updates.length) {
      const lastId = updates[updates.length - 1].update_id;
      await callApi(validToks[0].token, 'getUpdates', { offset: lastId + 1, timeout: 0 });
    }
  } catch(e) {
    log(`Poll exception: ${e.message}`, 'error');
  }
}

async function reactToMessage(chatId, msgId, validToks) {
  const mode  = document.getElementById('reactionMode').value;
  const delay = parseInt(document.getElementById('delay').value, 10) || 1200;
  const emojis = [...selected].map(i => EMOJIS[i]);

  let chosen = [];
  if (mode === 'random') chosen = [emojis[Math.floor(Math.random() * emojis.length)]];
  else if (mode === 'first') chosen = [emojis[0]];
  else chosen = emojis;

  for (const tok of validToks) {
    for (const emoji of chosen) {
      try {
        const res = await callApi(tok.token, 'setMessageReaction', {
          chat_id: chatId,
          message_id: msgId,
          reaction: [{ type: 'emoji', emoji }],
          is_big: false
        });
        if (res.ok) {
          stats.reactions++;
          document.getElementById('statReactions').textContent = stats.reactions;
          log(`${emoji} Reacted to msg #${msgId} via ${tok.name}`, 'ok');
        } else {
          log(`✗ ${tok.name}: ${res.description}`, 'error');
        }
      } catch(e) {
        log(`✗ ${tok.name} exception: ${e.message}`, 'error');
      }
      await sleep(delay);
    }
  }
}

// ── API HELPER ───────────────────────────────────────────
async function callApi(token, method, params) {
  const res = await fetch(`/api/telegram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, method, params })
  });
  return res.json();
}

// ── UTILS ────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function log(msg, type = 'info') {
  const box = document.getElementById('logBox');
  const t   = new Date().toTimeString().slice(0,8);
  const line = document.createElement('div');
  line.className = 'log-line';
  line.innerHTML = `<span class="log-time">${t}</span><span class="log-${type}">${escHtml(msg)}</span>`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

function clearLog() {
  document.getElementById('logBox').innerHTML = '';
  log('Log cleared.', 'info');
}

function setProgress(pct) {
  document.getElementById('progressFill').style.width = pct + '%';
}
