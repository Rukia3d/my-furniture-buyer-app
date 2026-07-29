const db = require('./db');

// Placeholder products so the home page has something to show before the
// real catalogue is loaded from MongoDB (ticket #4). Replaced wholesale then.
const placeholders = [
  { item_id: 'PLH-001', product_name: 'Placeholder Accent Chair', price: 399, category: 'Chairs', colours: '["mustard"]' },
  { item_id: 'PLH-002', product_name: 'Placeholder Dining Table', price: 899, category: 'Tables', colours: '["oak"]' },
  { item_id: 'PLH-003', product_name: 'Placeholder Bookshelf', price: 249, category: 'Storage', colours: '["white"]' },
];

function seed() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
  if (count > 0) return;
  const insert = db.prepare(`
    INSERT INTO products (item_id, product_name, price, category, colours, source)
    VALUES (@item_id, @product_name, @price, @category, @colours, 'placeholder')
  `);
  for (const p of placeholders) insert.run(p);
  console.log(`Seeded ${placeholders.length} placeholder products`);
}

module.exports = { seed };
