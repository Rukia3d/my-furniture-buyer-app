const db = require('../db/db');
const shopApi = require('./shop-api');

// Account service: balance and orders for the logged-in user.
// Local users are handled entirely in SQLite (this file). The linked user's
// balance/orders will go through the real shop API in the next milestone —
// until then their money actions are cleanly refused, not faked.

class OrderError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // 'insufficient_balance' | 'duplicate' | 'not_available' | 'not_supported_yet'
  }
}

// Reject an identical user+item order placed within this window — protects
// against double-clicked Buy buttons.
const DUPLICATE_WINDOW_SECONDS = 5;

async function getBalance(user) {
  if (user.account_type === 'linked') {
    const remote = await shopApi.getUser(user.api_user_id);
    return remote.balance;
  }
  return user.balance;
}

const placeLocalOrder = db.transaction((user, product, quantity) => {
  const total = product.price * quantity;

  const recent = db.prepare(`
    SELECT id FROM orders
    WHERE user_id = ? AND item_id = ?
      AND created_at > datetime('now', ?)
  `).get(user.id, product.item_id, `-${DUPLICATE_WINDOW_SECONDS} seconds`);
  if (recent) {
    throw new OrderError('duplicate', 'That order was already placed a moment ago — check your orders before trying again.');
  }

  const { balance } = db.prepare('SELECT balance FROM users WHERE id = ?').get(user.id);
  if (total > balance) {
    throw new OrderError('insufficient_balance',
      `Insufficient balance: this costs $${total.toFixed(2)} but you have $${balance.toFixed(2)} left.`);
  }

  db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(total, user.id);
  const result = db.prepare(`
    INSERT INTO orders (user_id, item_id, quantity, unit_price, total_price)
    VALUES (?, ?, ?, ?, ?)
  `).run(user.id, product.item_id, quantity, product.price, total);

  return {
    orderId: result.lastInsertRowid,
    total,
    remainingBalance: balance - total,
  };
});

async function placeLinkedOrder(user, product, quantity) {
  const recent = db.prepare(`
    SELECT id FROM orders
    WHERE user_id = ? AND item_id = ?
      AND created_at > datetime('now', ?)
  `).get(user.id, product.item_id, `-${DUPLICATE_WINDOW_SECONDS} seconds`);
  if (recent) {
    throw new OrderError('duplicate', 'That order was already placed a moment ago — check your orders before trying again.');
  }

  let response;
  try {
    response = await shopApi.placeOrder(user.api_user_id, product.item_id, quantity);
  } catch (err) {
    if (err instanceof shopApi.ShopApiError) {
      if (err.code === 'insufficient_balance') throw new OrderError('insufficient_balance', err.message);
      if (err.code === 'not_found') throw new OrderError('not_available', 'This item is no longer available in the shop.');
      if (err.code === 'rate_limited') throw new OrderError('rate_limited', err.message);
      throw new OrderError('shop_error', 'The shop could not process this order right now — nothing was charged. Please try again.');
    }
    throw err;
  }

  const total = response.total_price ?? product.price * quantity;
  db.prepare(`
    INSERT INTO orders (user_id, item_id, quantity, unit_price, total_price, api_order_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(user.id, product.item_id, quantity, total / quantity, total, response.order_id);

  return { orderId: response.order_id, total, remainingBalance: response.remaining_balance };
}

async function placeOrder(user, itemId, quantity = 1) {
  const product = db.prepare('SELECT item_id, product_name, price FROM products WHERE item_id = ?').get(itemId);
  if (!product) {
    throw new OrderError('not_available', 'This item is no longer available.');
  }
  if (user.account_type === 'linked') {
    return { ...(await placeLinkedOrder(user, product, quantity)), product };
  }
  return { ...placeLocalOrder(user, product, quantity), product };
}

function getOrders(user) {
  const orders = db.prepare(`
    SELECT o.*, p.product_name, p.category
    FROM orders o LEFT JOIN products p ON p.item_id = o.item_id
    WHERE o.user_id = ?
    ORDER BY o.created_at DESC, o.id DESC
  `).all(user.id);
  const totalSpent = orders.reduce((sum, o) => sum + o.total_price, 0);
  return { orders, totalSpent };
}

module.exports = { getBalance, placeOrder, getOrders, OrderError };
