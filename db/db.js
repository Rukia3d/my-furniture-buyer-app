const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'app.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    account_type  TEXT NOT NULL DEFAULT 'local' CHECK (account_type IN ('local', 'linked')),
    api_user_id   TEXT,
    balance       REAL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    item_id        TEXT PRIMARY KEY,
    product_name   TEXT NOT NULL,
    price          REAL NOT NULL,
    category       TEXT NOT NULL,
    colours        TEXT NOT NULL DEFAULT '[]',
    depth          REAL,
    height         REAL,
    width          REAL,
    image_data     TEXT,
    image_mime_type TEXT,
    source         TEXT NOT NULL DEFAULT 'placeholder',
    last_synced_at TEXT
  );

  CREATE TABLE IF NOT EXISTS orders (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    item_id      TEXT NOT NULL REFERENCES products(item_id),
    quantity     INTEGER NOT NULL DEFAULT 1,
    unit_price   REAL NOT NULL,
    total_price  REAL NOT NULL,
    api_order_id TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

module.exports = db;
