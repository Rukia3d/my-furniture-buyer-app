const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db/db');

const router = express.Router();

router.get('/login', (req, res) => {
  res.render('login', { error: null });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get((username || '').trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).render('login', { error: 'Wrong username or password.' });
  }
  req.session.userId = user.id;
  res.redirect('/');
});

router.get('/register', (req, res) => {
  res.render('register', { error: null, values: {} });
});

router.post('/register', (req, res) => {
  const username = (req.body.username || '').trim().toLowerCase();
  const displayName = (req.body.display_name || '').trim();
  const password = req.body.password || '';

  const values = { username, display_name: displayName };
  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    return res.status(400).render('register', { error: 'Username must be 3–20 characters: letters, numbers, underscores.', values });
  }
  if (!displayName) {
    return res.status(400).render('register', { error: 'Please enter a display name.', values });
  }
  if (password.length < 6) {
    return res.status(400).render('register', { error: 'Password must be at least 6 characters.', values });
  }
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    return res.status(400).render('register', { error: 'That username is taken.', values });
  }

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(`
    INSERT INTO users (username, password_hash, display_name, account_type, balance)
    VALUES (?, ?, ?, 'local', 1000)
  `).run(username, hash, displayName);
  req.session.userId = result.lastInsertRowid;
  res.redirect('/');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
