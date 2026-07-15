// E2E config: drives the real Electron app (no browser download needed —
// Playwright's _electron launcher uses the electron binary already in
// node_modules). Tests live apart from the plain-node unit tests so
// `npm test` stays fast and dependency-free.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'test/e2e',
  timeout: 30000,
  // One app instance per file, tests share it — run files one at a time.
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
});
