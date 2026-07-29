require('dotenv').config();
const express = require('express');
const session = require('express-session');
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
  res.render('account', { liveBalance, liveBalanceError });
});

const port = process.env.PORT || 3003;
app.listen(port, () => {
  console.log(`Furniture buyer app running at http://localhost:${port}`);
  // Refresh prices/names from the live shop on boot; keep serving the
  // last known catalogue if the API is unreachable.
  require('./services/catalogue').refreshFromApi()
    .catch(err => console.error('Catalogue refresh skipped:', err.message));
});
