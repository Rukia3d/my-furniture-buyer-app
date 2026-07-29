require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const path = require('path');
const { seed } = require('./db/seed');
const { loadUser, requireLogin } = require('./routes/middleware');
const authRoutes = require('./routes/auth');
const catalogueRoutes = require('./routes/catalogue');
const orderRoutes = require('./routes/orders');
const agentRoutes = require('./routes/agent');

seed();

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  // Sessions live in SQLite so a server restart never logs anyone out.
  store: new SqliteStore({ client: require('./db/db'), expired: { clear: true, intervalMs: 15 * 60 * 1000 } }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 },
}));
app.use(loadUser);
app.use(authRoutes);
app.use(catalogueRoutes);
app.use(orderRoutes);
app.use(agentRoutes);

app.get('/account', requireLogin, async (req, res) => {
  let liveBalance = null;
  let liveBalanceError = null;
  if (req.currentUser.account_type === 'linked') {
    try {
      liveBalance = await require('./services/account').getBalance(req.currentUser);
    } catch (err) {
      liveBalanceError = 'Could not reach the shop to fetch your balance — try refreshing.';
    }
  }
  res.render('account', {
    liveBalance,
    liveBalanceError,
    saved: req.query.saved === '1',
    error: null,
  });
});

app.post('/account/display-name', requireLogin, (req, res) => {
  const displayName = (req.body.display_name || '').trim();
  if (!displayName || displayName.length > 50) {
    return res.status(400).render('account', {
      liveBalance: null,
      liveBalanceError: req.currentUser.account_type === 'linked' ? 'Refresh to see your balance.' : null,
      saved: false,
      error: 'Display name must be 1–50 characters.',
    });
  }
  require('./db/db').prepare('UPDATE users SET display_name = ? WHERE id = ?')
    .run(displayName, req.currentUser.id);
  res.redirect('/account?saved=1');
});

const port = process.env.PORT || 3003;
app.listen(port, () => {
  console.log(`Furniture buyer app running at http://localhost:${port}`);
  // Refresh prices/names from the live shop on boot; keep serving the
  // last known catalogue if the API is unreachable.
  require('./services/catalogue').refreshFromApi()
    .catch(err => console.error('Catalogue refresh skipped:', err.message));
});
