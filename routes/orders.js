const express = require('express');
const db = require('../db/db');
const { requireLogin } = require('./middleware');
const account = require('../services/account');

const router = express.Router();

router.post('/products/:itemId/buy', requireLogin, (req, res) => {
  const quantity = Math.max(1, Math.min(10, parseInt(req.body.quantity, 10) || 1));
  try {
    const result = account.placeOrder(req.currentUser, req.params.itemId, quantity);
    req.session.lastOrderMessage =
      `Order placed: ${quantity} × ${result.product.product_name} for $${result.total.toFixed(2)}. ` +
      `Remaining balance: $${result.remainingBalance.toFixed(2)}.`;
    res.redirect('/orders');
  } catch (err) {
    if (!(err instanceof account.OrderError)) throw err;
    const product = db.prepare(`
      SELECT item_id, product_name, price, category, colours, depth, height, width,
             image_data IS NOT NULL AS has_image, source
      FROM products WHERE item_id = ?
    `).get(req.params.itemId);
    if (!product) return res.status(404).render('product-missing');
    res.status(err.code === 'insufficient_balance' ? 402 : 400).render('product', {
      product,
      colours: JSON.parse(product.colours || '[]'),
      error: err.message,
    });
  }
});

router.get('/orders', requireLogin, (req, res) => {
  const { orders, totalSpent } = account.getOrders(req.currentUser);
  const message = req.session.lastOrderMessage || null;
  delete req.session.lastOrderMessage;
  res.render('orders', { orders, totalSpent, message });
});

module.exports = router;
