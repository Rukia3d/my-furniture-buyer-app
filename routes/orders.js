const express = require('express');
const db = require('../db/db');
const { requireLogin } = require('./middleware');
const account = require('../services/account');
const shopApi = require('../services/shop-api');

const router = express.Router();

router.post('/products/:itemId/buy', requireLogin, async (req, res) => {
  const quantity = Math.max(1, Math.min(10, parseInt(req.body.quantity, 10) || 1));
  try {
    const result = await account.placeOrder(req.currentUser, req.params.itemId, quantity);
    const balanceNote = result.remainingBalance != null
      ? ` Remaining balance: $${result.remainingBalance.toFixed(2)}.` : '';
    req.session.lastOrderMessage =
      `Order placed: ${quantity} × ${result.product.product_name} for $${result.total.toFixed(2)}.${balanceNote}`;
    res.redirect('/orders');
  } catch (err) {
    if (!(err instanceof account.OrderError)) throw err;
    const product = db.prepare(`
      SELECT item_id, product_name, price, category, colours, depth, height, width,
             image_data IS NOT NULL AS has_image, source
      FROM products WHERE item_id = ?
    `).get(req.params.itemId);
    if (!product) return res.status(404).render('product-missing');
    const status = { insufficient_balance: 402, rate_limited: 429, not_available: 404 }[err.code] || 400;
    res.status(status).render('product', {
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

// PDF invoices exist only for orders placed through the live shop API.
// Proxied so the API key never reaches the browser.
router.get('/orders/:id/invoice', requireLogin, async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.currentUser.id);
  if (!order || !order.api_order_id) return res.status(404).send('No invoice for this order.');
  try {
    const pdf = await shopApi.fetchInvoice(order.api_order_id);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="invoice-${order.api_order_id}.pdf"`);
    res.send(pdf);
  } catch (err) {
    res.status(502).send('Could not fetch the invoice right now — try again shortly.');
  }
});

module.exports = router;
