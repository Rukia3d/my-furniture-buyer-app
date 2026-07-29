// Point a registered account at the live shop API account from .env.
// Usage: npm run link-account <username>
//
// Only one account can be linked at a time (the API key belongs to exactly
// one shop user), so any previously linked account is demoted to local.
require('dotenv').config();
const db = require('../db/db');

const username = (process.argv[2] || '').trim().toLowerCase();
const apiUserId = process.env.SHOP_API_USER_ID;

if (!username) {
  console.error('Usage: npm run link-account <username>');
  process.exit(1);
}
if (!apiUserId) {
  console.error('SHOP_API_USER_ID is not set in .env');
  process.exit(1);
}

const user = db.prepare('SELECT id, username, account_type FROM users WHERE username = ?').get(username);
if (!user) {
  console.error(`No account called "${username}" — register it in the app first.`);
  process.exit(1);
}

const relink = db.transaction(() => {
  db.prepare("UPDATE users SET account_type = 'local', api_user_id = NULL, balance = COALESCE(balance, 1000) WHERE account_type = 'linked'").run();
  db.prepare("UPDATE users SET account_type = 'linked', api_user_id = ?, balance = NULL WHERE id = ?").run(apiUserId, user.id);
});
relink();

console.log(`"${username}" is now linked to shop account ${apiUserId} — its balance and orders are live.`);
