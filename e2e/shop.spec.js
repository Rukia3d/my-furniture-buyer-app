// E2E smoke tests. IMPORTANT: each run registers its OWN throwaway local
// account — never the linked account — so a test run can never spend the
// real event balance. No credentials live in this repo.
const { test, expect } = require('@playwright/test');

const CHEAP_ITEM = '80336433';      // Knob, $1.20
const EXPENSIVE_ITEM = '59161492';  // Table and 6 chairs, ~$1622 — above the $1000 starting balance
const PASSWORD = 'e2e-' + Math.random().toString(36).slice(2, 10);

let username; // registered once, reused by the tests that need a login

async function register(page, name = `e2e_${Date.now()}`) {
  await page.goto('/register');
  await page.fill('input[name="username"]', name);
  await page.fill('input[name="display_name"]', 'E2E Test User');
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  return name;
}

async function login(page, name = username, password = PASSWORD) {
  await page.goto('/login');
  await page.fill('input[name="username"]', name);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  username = await register(page);
  await page.close();
});

test('home page shows the real catalogue with category filter', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.product-card')).toHaveCount(24); // one page
  await expect(page.locator('.notice')).toContainText('762 products');
  await page.selectOption('select[name="category"]', 'Chairs');
  await expect(page.locator('.notice')).toContainText('in Chairs');
  await expect(page.locator('.product-card').first()).toBeVisible();
});

test('product detail shows price, image and dimensions', async ({ page }) => {
  await page.goto(`/products/${CHEAP_ITEM}`);
  await expect(page.locator('h2')).toContainText('Knob');
  await expect(page.locator('.big-price')).toContainText('$1.20');
  const img = page.locator('.product-detail-image img');
  await expect(img).toBeVisible();
});

test('wrong password is rejected with a message', async ({ page }) => {
  await login(page, username, 'definitely-not-the-password');
  await expect(page.locator('.error')).toContainText('Wrong username or password');
});

test('buying while logged out redirects to login', async ({ page }) => {
  await page.goto(`/products/${CHEAP_ITEM}`);
  await expect(page.locator('.muted-note')).toContainText('Log in to buy');
});

test('registration creates a working account with $1000', async ({ page }) => {
  await register(page, `e2e_r${Date.now().toString().slice(-9)}`);
  await page.goto('/account');
  await expect(page.locator('.account-details')).toContainText('$1000.00');
});

test('local user can buy, sees order history, balance drops', async ({ page }) => {
  await login(page);
  const before = parseFloat(
    (await page.goto('/account').then(() => page.locator('.account-details').textContent()))
      .match(/\$([\d.]+)/)[1]
  );
  await page.goto(`/products/${CHEAP_ITEM}`);
  await page.click('.buy-form button');
  await expect(page).toHaveURL(/\/orders$/);
  await expect(page.locator('.success')).toContainText('Order placed: 1 × Knob for $1.20');
  await page.goto('/account');
  await expect(page.locator('.account-details')).toContainText(`$${(before - 1.2).toFixed(2)}`);
});

test('overspending is blocked with a clear message', async ({ page }) => {
  await login(page);
  await page.goto(`/products/${EXPENSIVE_ITEM}`);
  await page.click('.buy-form button');
  await expect(page.locator('.error')).toContainText('Insufficient balance');
});

test('unknown product shows a friendly page, not a crash', async ({ page }) => {
  const response = await page.goto('/products/DOES-NOT-EXIST');
  expect(response.status()).toBe(404);
  await expect(page.locator('h2')).toContainText('no longer available');
});
