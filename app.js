require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./db/db');
const { seed } = require('./db/seed');

seed();

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  const products = db.prepare('SELECT * FROM products ORDER BY category, product_name').all();
  res.render('home', { products });
});

const port = process.env.PORT || 3003;
app.listen(port, () => {
  console.log(`Furniture buyer app running at http://localhost:${port}`);
});
