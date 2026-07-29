// Loads the shared read-only MongoDB catalogue (762 real products, with
// image URLs and dimensions) into our products table, replacing whatever
// is there. Run with: npm run load-catalogue
require('dotenv').config();
const { MongoClient } = require('mongodb');
const db = require('./db');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set in .env — see .env.example');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const docs = await client.db('catalog').collection('catalog').find().toArray();
  await client.close();

  if (docs.length === 0) {
    console.error('MongoDB returned 0 products — refusing to wipe the local table.');
    process.exit(1);
  }

  const insert = db.prepare(`
    INSERT INTO products (item_id, product_name, price, category, colours,
                          depth, height, width, image_data, image_mime_type, source, last_synced_at)
    VALUES (@item_id, @product_name, @price, @category, @colours,
            @depth, @height, @width, @image_data, @image_mime_type, 'mongo', datetime('now'))
  `);

  const replaceAll = db.transaction((rows) => {
    db.prepare('DELETE FROM products').run();
    for (const d of rows) {
      insert.run({
        item_id: d.item_id,
        product_name: d.product_name,
        price: d.price,
        category: d.category,
        colours: JSON.stringify(d.colours || []),
        depth: d.depth ?? null,
        height: d.height ?? null,
        width: d.width ?? null,
        // Despite the field name, the shared MongoDB stores base64 image
        // bytes in image_url, not a link. We serve them via /products/:id/image.
        image_data: d.image_url ?? null,
        image_mime_type: d.image_mime_type ?? 'image/jpeg',
      });
    }
  });

  replaceAll(docs);
  console.log(`Loaded ${docs.length} products from MongoDB into SQLite`);
}

main().catch((err) => {
  console.error('Catalogue load failed:', err.message);
  process.exit(1);
});
