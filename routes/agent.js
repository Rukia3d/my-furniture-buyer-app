const express = require('express');
const db = require('../db/db');
const { requireLogin } = require('./middleware');
const { AgentSession } = require('../services/agent');

const router = express.Router();

// Conversations are persisted per user in SQLite so they survive restarts.
// The live AgentSession objects are cached in memory per user.
const live = new Map();
const MAX_SAVED_MESSAGES = 60; // cap context growth: keep the most recent turns

function loadConversation(user) {
  if (live.has(user.id)) {
    const s = live.get(user.id);
    s.agent.user = user; // refresh row — balance changes between turns
    return s;
  }
  const agent = new AgentSession(user);
  const row = db.prepare('SELECT messages, log FROM agent_conversations WHERE user_id = ?').get(user.id);
  const s = { agent, log: row ? JSON.parse(row.log) : [] };
  if (row) agent.messages = JSON.parse(row.messages);
  live.set(user.id, s);
  return s;
}

function saveConversation(user, s) {
  // Trim from the front, but never start history on a tool_result turn —
  // the API requires tool results to follow their tool_use.
  let messages = s.agent.messages.slice(-MAX_SAVED_MESSAGES);
  while (messages.length && Array.isArray(messages[0].content)
         && messages[0].content.some(b => b.type === 'tool_result')) {
    messages.shift();
  }
  db.prepare(`
    INSERT INTO agent_conversations (user_id, messages, log, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET messages = excluded.messages,
      log = excluded.log, updated_at = excluded.updated_at
  `).run(user.id, JSON.stringify(messages), JSON.stringify(s.log));
}

router.get('/assistant', requireLogin, (req, res) => {
  res.render('assistant', { log: loadConversation(req.currentUser).log });
});

router.post('/assistant/message', requireLogin, express.json(), async (req, res) => {
  const text = (req.body.message || '').trim().slice(0, 2000);
  if (!text) return res.status(400).json({ error: 'Empty message' });
  const s = loadConversation(req.currentUser);
  try {
    const reply = await s.agent.send(text);
    s.log.push({ role: 'user', text }, { role: 'assistant', text: reply });
    saveConversation(req.currentUser, s);
    res.json({ reply });
  } catch (err) {
    console.error('Agent error:', err.message);
    res.status(502).json({ error: 'The assistant hit a problem — please try again.' });
  }
});

router.post('/assistant/clear', requireLogin, (req, res) => {
  live.delete(req.currentUser.id);
  db.prepare('DELETE FROM agent_conversations WHERE user_id = ?').run(req.currentUser.id);
  res.redirect('/assistant');
});

module.exports = router;
