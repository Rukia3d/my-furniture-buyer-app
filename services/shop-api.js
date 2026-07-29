// The only module that talks to the furniture-shop API.
// Base URL + credentials come from .env; API errors are mapped to typed
// ShopApiError codes the rest of the app can handle without knowing HTTP.

const BASE = (process.env.SHOP_API_BASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SHOP_API_KEY;

class ShopApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code; // 'insufficient_balance' | 'not_found' | 'auth' | 'rate_limited' | 'unavailable'
    this.status = status;
  }
}

function mapError(status, body) {
  const detail = (body && (body.detail || body.message)) || '';
  switch (status) {
    case 401:
    case 403: return new ShopApiError('auth', `Shop API rejected our credentials (${status}). ${detail}`, status);
    case 402: return new ShopApiError('insufficient_balance', detail || 'Insufficient balance for this order.', status);
    case 404: return new ShopApiError('not_found', detail || 'Not found.', status);
    case 429: return new ShopApiError('rate_limited', 'The shop is receiving too many requests — try again shortly.', status);
    default: return new ShopApiError('unavailable', `Shop API error ${status}. ${detail}`, status);
  }
}

async function request(path, { method = 'GET', body, auth = false, retried = false } = {}) {
  const headers = {};
  if (auth) headers['X-Api-Key'] = KEY;
  if (body) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (err) {
    throw new ShopApiError('unavailable', `Could not reach the shop API: ${err.message}`);
  }

  if (res.status === 429 && !retried) {
    const wait = Math.min(parseInt(res.headers.get('Retry-After'), 10) || 2, 15);
    await new Promise(r => setTimeout(r, wait * 1000));
    return request(path, { method, body, auth, retried: true });
  }

  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) throw mapError(res.status, data);
  return data ?? res;
}

module.exports = {
  ShopApiError,
  health: () => request('/health'),
  searchIndex: ({ category, limit = 1000, skip = 0 } = {}) => {
    const params = new URLSearchParams({ limit, skip });
    if (category) params.set('category', category);
    return request(`/catalogue/search-index?${params}`);
  },
  getUser: (userId) => request(`/users/${encodeURIComponent(userId)}`, { auth: true }),
  // Note: the real API takes an items array — the event guide's flat
  // {item_id, quantity} body is outdated and 422s.
  placeOrder: (userId, itemId, quantity) =>
    request('/orders', {
      method: 'POST',
      auth: true,
      body: { user_id: userId, items: [{ item_id: itemId, quantity }] },
    }),
  getOrders: (userId) => request(`/orders/${encodeURIComponent(userId)}`, { auth: true }),
  fetchInvoice: async (orderId) => {
    const res = await fetch(`${BASE}/orders/${encodeURIComponent(orderId)}/invoice`, {
      headers: { 'X-Api-Key': KEY },
    });
    if (!res.ok) throw mapError(res.status, null);
    return Buffer.from(await res.arrayBuffer());
  },
};
