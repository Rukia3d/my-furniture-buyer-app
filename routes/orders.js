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

// Order-history report as a downloadable PDF.
router.get('/orders/export.pdf', requireLogin, (req, res) => {
  const PDFDocument = require('pdfkit');
  const { orders, totalSpent } = account.getOrders(req.currentUser);

  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', 'attachment; filename="my-orders.pdf"');

  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);

  doc.fontSize(20).text('Furniture Shop — Order History', { align: 'left' });
  doc.moveDown(0.3);
  doc.fontSize(11).fillColor('#555')
    .text(`${req.currentUser.display_name} (${req.currentUser.username})`)
    .text(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`);
  doc.moveDown();

  if (orders.length === 0) {
    doc.fillColor('#000').fontSize(12).text('No orders yet.');
  } else {
    const col = { date: 50, item: 170, qty: 380, unit: 420, total: 490 };
    doc.fontSize(10).fillColor('#000').font('Helvetica-Bold');
    doc.text('Date', col.date, doc.y, { continued: false });
    const headerY = doc.y - 12;
    doc.text('Item', col.item, headerY);
    doc.text('Qty', col.qty, headerY);
    doc.text('Unit', col.unit, headerY);
    doc.text('Total', col.total, headerY);
    doc.moveTo(50, doc.y + 2).lineTo(545, doc.y + 2).strokeColor('#ccc').stroke();
    doc.font('Helvetica').moveDown(0.4);

    for (const o of orders) {
      const y = doc.y;
      if (y > 730) doc.addPage();
      const rowY = doc.y;
      doc.text(o.created_at.slice(0, 16), col.date, rowY, { width: 110 });
      doc.text(`${o.product_name || o.item_id}${o.api_order_id ? ' (live)' : ''}`, col.item, rowY, { width: 200 });
      doc.text(String(o.quantity), col.qty, rowY);
      doc.text(`$${o.unit_price.toFixed(2)}`, col.unit, rowY);
      doc.text(`$${o.total_price.toFixed(2)}`, col.total, rowY);
      doc.moveDown(0.35);
    }

    doc.moveDown();
    doc.font('Helvetica-Bold').fontSize(12)
      .text(`Total spent: $${totalSpent.toFixed(2)}  (${orders.length} order${orders.length === 1 ? '' : 's'})`, 50);
  }

  doc.end();
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
