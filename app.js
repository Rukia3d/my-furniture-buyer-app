require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { seed } = require('./db/seed');
const { loadUser, requireLogin } = require('./routes/middleware');
const authRoutes = require('./routes/auth');
const catalogueRoutes = require('./routes/catalogue');

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

app.get('/account', requireLogin, (req, res) => {
  res.render('account');
});

const port = process.env.PORT || 3003;
app.listen(port, () => {
  console.log(`Furniture buyer app running at http://localhost:${port}`);
});
