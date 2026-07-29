const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  workers: 1, // serial: tests share one SQLite DB and the duplicate-order guard
  use: {
    baseURL: 'http://localhost:3003',
  },
  webServer: {
    command: 'npm start',
    url: 'http://localhost:3003',
    reuseExistingServer: true,
  },
});
