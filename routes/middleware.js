const db = require('../db/db');

// Makes the logged-in user available to all routes and views as currentUser.
function loadUser(req, res, next) {
  res.locals.currentUser = null;
  if (req.session.userId) {
    res.locals.currentUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId) || null;
  }
  req.currentUser = res.locals.currentUser;
  next();
}

function requireLogin(req, res, next) {
  if (!req.currentUser) return res.redirect('/login');
  next();
}

module.exports = { loadUser, requireLogin };
