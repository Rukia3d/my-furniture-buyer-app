const db = require('../db/db');
const shopApi = require('./shop-api');

// Refreshes prices/names/categories from the live API's search-index.
// Images and dimensions stay as loaded from MongoDB (the API doesn't offer
// them in browse form). Non-fatal on failure: the app still serves the last
// known catalogue.
async function refreshFromApi() {
  // The API caps limit at 1000 — page through with skip until a short page.
  const PAGE = 1000;
  const items = [];
  for (let skip = 0; ; skip += PAGE) {
    const page = await shopApi.searchIndex({ limit: PAGE, skip });
    items.push(...page);
    if (!Array.isArray(page) || page.length < PAGE) break;
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('search-index returned no products — keeping existing catalogue');
  }

  const update = db.prepare(`
    UPDATE products
    SET product_name = @product_name, price = @price, category = @category,
        colours = @colours, source = 'api', last_synced_at = datetime('now')
    WHERE item_id = @item_id
  `);
  const insert = db.prepare(`
    INSERT INTO products (item_id, product_name, price, category, colours, source, last_synced_at)
    VALUES (@item_id, @product_name, @price, @category, @colours, 'api', datetime('now'))
  `);

  const apply = db.transaction((rows) => {
    let updated = 0, added = 0;
    for (const item of rows) {
      const row = {
        item_id: item.item_id,
        product_name: item.product_name,
        price: item.price,
        category: item.category,
        colours: JSON.stringify(item.colours || []),
      };
      if (update.run(row).changes > 0) updated++;
      else { insert.run(row); added++; }
    }
    return { updated, added };
  });

  const { updated, added } = apply(items);
  console.log(`Catalogue refreshed from shop API: ${updated} updated, ${added} new`);
}

module.exports = { refreshFromApi };
