const db = require('./db');
const bcrypt = require('bcrypt');

// Demo users. Local users have an in-app balance; the linked user's balance
// and orders go through the real shop API (their api_user_id comes from .env).
// Demo password for all seeded users: "furniture" — fine for a hackathon demo,
// would never ship real credentials this way.
const DEMO_PASSWORD = 'furniture';

// Placeholder products so the home page has something to show before the
// real catalogue is loaded from MongoDB (ticket #4). Replaced wholesale then.
const placeholders = [
  { item_id: 'PLH-001', product_name: 'Placeholder Accent Chair', price: 399, category: 'Chairs', colours: '["mustard"]' },
  { item_id: 'PLH-002', product_name: 'Placeholder Dining Table', price: 899, category: 'Tables', colours: '["oak"]' },
  { item_id: 'PLH-003', product_name: 'Placeholder Bookshelf', price: 249, category: 'Storage', colours: '["white"]' },
];

function seedProducts() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
  if (count > 0) return;
  const insert = db.prepare(`
    INSERT INTO products (item_id, product_name, price, category, colours, source)
    VALUES (@item_id, @product_name, @price, @category, @colours, 'placeholder')
  `);
  for (const p of placeholders) insert.run(p);
  console.log(`Seeded ${placeholders.length} placeholder products`);
}

function seedUsers() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return;
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const insert = db.prepare(`
    INSERT INTO users (username, password_hash, display_name, account_type, api_user_id, balance)
    VALUES (@username, @hash, @display_name, @account_type, @api_user_id, @balance)
  `);
  insert.run({ username: 'demo', hash, display_name: 'Demo Shopper', account_type: 'local', api_user_id: null, balance: 1500 });
  insert.run({ username: 'guest', hash, display_name: 'Guest Shopper', account_type: 'local', api_user_id: null, balance: 800 });
  insert.run({
    username: 'inga', hash, display_name: 'Inga (live account)',
    account_type: 'linked', api_user_id: process.env.SHOP_API_USER_ID || null, balance: null,
  });
  console.log('Seeded 3 users (demo, guest, inga — password: "furniture")');
}

function seed() {
  seedProducts();
  seedUsers();
}

module.exports = { seed };
