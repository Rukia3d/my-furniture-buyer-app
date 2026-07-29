const express = require('express');
const db = require('../db/db');

const router = express.Router();
const PAGE_SIZE = 24;

router.get('/', (req, res) => {
  const category = req.query.category || '';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);

  const where = category ? 'WHERE category = ?' : '';
  const params = category ? [category] : [];
  const total = db.prepare(`SELECT COUNT(*) AS n FROM products ${where}`).get(...params).n;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // image_data is deliberately not selected: it's large and served separately.
  const products = db.prepare(`
    SELECT item_id, product_name, price, category, colours, image_data IS NOT NULL AS has_image
    FROM products ${where}
    ORDER BY product_name
    LIMIT ? OFFSET ?
  `).all(...params, PAGE_SIZE, (page - 1) * PAGE_SIZE);

  const categories = db.prepare('SELECT DISTINCT category FROM products ORDER BY category').all().map(r => r.category);

  // Hero backdrop: the priciest product that has a photo.
  const heroItem = db.prepare(
    'SELECT item_id, product_name FROM products WHERE image_data IS NOT NULL ORDER BY price DESC LIMIT 1'
  ).get();

  res.render('home', { products, categories, category, page, totalPages, total, heroItem });
});

router.get('/products/:itemId', (req, res) => {
  const product = db.prepare(`
    SELECT item_id, product_name, price, category, colours, depth, height, width,
           image_data IS NOT NULL AS has_image, source
    FROM products WHERE item_id = ?
  `).get(req.params.itemId);
  if (!product) {
    return res.status(404).render('product-missing');
  }
  res.render('product', { product, colours: JSON.parse(product.colours || '[]') });
});

// Lightweight product info for the chat's preview cards.
router.get('/api/products', (req, res) => {
  const ids = String(req.query.ids || '').split(',').filter(Boolean).slice(0, 12);
  const rows = ids.map(id => db.prepare(`
    SELECT item_id, product_name, price, category, image_data IS NOT NULL AS has_image
    FROM products WHERE item_id = ?
  `).get(id)).filter(Boolean);
  res.json({ products: rows });
});

router.get('/products/:itemId/image', (req, res) => {
  const row = db.prepare('SELECT image_data, image_mime_type FROM products WHERE item_id = ?').get(req.params.itemId);
  if (!row || !row.image_data) return res.status(404).end();
  res.set('Content-Type', row.image_mime_type || 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(Buffer.from(row.image_data, 'base64'));
});

module.exports = router;
