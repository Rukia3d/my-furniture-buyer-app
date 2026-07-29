const express = require('express');
const db = require('../db/db');
const { requireLogin } = require('./middleware');
const { AgentSession } = require('../services/agent');

const router = express.Router();

// Every conversation is a row in agent_conversations; users can have many
// and reopen any of them from /chats. Live AgentSession objects are cached
// per conversation id.
const live = new Map();
const MAX_SAVED_MESSAGES = 60;

function conversationRow(id, userId) {
  return db.prepare('SELECT * FROM agent_conversations WHERE id = ? AND user_id = ?').get(id, userId);
}

function activeConversation(req) {
  let row = req.session.activeChatId && conversationRow(req.session.activeChatId, req.currentUser.id);
  if (!row) {
    row = db.prepare(
      'SELECT * FROM agent_conversations WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1'
    ).get(req.currentUser.id);
  }
  if (!row) {
    const r = db.prepare('INSERT INTO agent_conversations (user_id) VALUES (?)').run(req.currentUser.id);
    row = conversationRow(r.lastInsertRowid, req.currentUser.id);
  }
  req.session.activeChatId = row.id;
  return row;
}

function liveSession(row, user) {
  if (live.has(row.id)) {
    const s = live.get(row.id);
    s.agent.user = user; // refresh — balance changes between turns
    return s;
  }
  const agent = new AgentSession(user);
  agent.messages = JSON.parse(row.messages);
  const s = { agent, log: JSON.parse(row.log) };
  live.set(row.id, s);
  return s;
}

function saveConversation(row, s, firstUserText) {
  let messages = s.agent.messages.slice(-MAX_SAVED_MESSAGES);
  while (messages.length && Array.isArray(messages[0].content)
         && messages[0].content.some(b => b.type === 'tool_result')) {
    messages.shift();
  }
  const title = row.title === 'New chat' && firstUserText
    ? firstUserText.slice(0, 60)
    : row.title;
  db.prepare(`
    UPDATE agent_conversations
    SET messages = ?, log = ?, title = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(JSON.stringify(messages), JSON.stringify(s.log), title, row.id);
}

router.get('/assistant', requireLogin, (req, res) => {
  if (req.query.chat) {
    const requested = conversationRow(parseInt(req.query.chat, 10), req.currentUser.id);
    if (requested) req.session.activeChatId = requested.id;
  }
  const row = activeConversation(req);
  res.render('assistant', { log: liveSession(row, req.currentUser).log, chatTitle: row.title });
});

router.post('/assistant/message', requireLogin, express.json(), async (req, res) => {
  const text = (req.body.message || '').trim().slice(0, 2000);
  if (!text) return res.status(400).json({ error: 'Empty message' });
  const row = activeConversation(req);
  const s = liveSession(row, req.currentUser);
  try {
    const reply = await s.agent.send(text);
    s.log.push({ role: 'user', text }, { role: 'assistant', text: reply });
    saveConversation(row, s, text);
    res.json({ reply });
  } catch (err) {
    console.error('Agent error:', err.message);
    res.status(502).json({ error: 'The assistant hit a problem — please try again.' });
  }
});

router.post('/assistant/new', requireLogin, (req, res) => {
  const r = db.prepare('INSERT INTO agent_conversations (user_id) VALUES (?)').run(req.currentUser.id);
  req.session.activeChatId = r.lastInsertRowid;
  res.redirect('/assistant');
});

router.get('/chats', requireLogin, (req, res) => {
  const chats = db.prepare(`
    SELECT id, title, updated_at, json_array_length(log) AS turns
    FROM agent_conversations WHERE user_id = ?
    ORDER BY updated_at DESC, id DESC
  `).all(req.currentUser.id);
  res.render('chats', { chats, activeChatId: req.session.activeChatId });
});

router.post('/chats/:id/delete', requireLogin, (req, res) => {
  const row = conversationRow(parseInt(req.params.id, 10), req.currentUser.id);
  if (row) {
    db.prepare('DELETE FROM agent_conversations WHERE id = ?').run(row.id);
    live.delete(row.id);
    if (req.session.activeChatId === row.id) delete req.session.activeChatId;
  }
  res.redirect('/chats');
});

module.exports = router;
