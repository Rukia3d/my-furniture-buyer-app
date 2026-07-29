const express = require('express');
const { requireLogin } = require('./middleware');
const { AgentSession } = require('../services/agent');

const router = express.Router();

// One agent conversation per browser session, in memory (lost on restart —
// deliberate, see architecture.md). Keyed by session ID + user so a login
// switch never leaks another user's conversation.
const sessions = new Map();

function sessionFor(req) {
  const key = `${req.session.id}:${req.currentUser.id}`;
  if (!sessions.has(key)) sessions.set(key, { agent: new AgentSession(req.currentUser), log: [] });
  const s = sessions.get(key);
  s.agent.user = req.currentUser; // refresh row (balance changes between turns)
  return s;
}

router.get('/assistant', requireLogin, (req, res) => {
  res.render('assistant', { log: sessionFor(req).log });
});

router.post('/assistant/message', requireLogin, express.json(), async (req, res) => {
  const text = (req.body.message || '').trim().slice(0, 2000);
  if (!text) return res.status(400).json({ error: 'Empty message' });
  const s = sessionFor(req);
  try {
    const reply = await s.agent.send(text);
    s.log.push({ role: 'user', text }, { role: 'assistant', text: reply });
    res.json({ reply });
  } catch (err) {
    console.error('Agent error:', err.message);
    res.status(502).json({ error: 'The assistant hit a problem — please try again.' });
  }
});

module.exports = router;
