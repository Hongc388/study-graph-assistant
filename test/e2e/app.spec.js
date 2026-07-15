// Happy-path E2E: boots the real app against a throwaway data directory and
// clicks through the flows a new user hits first. This is the layer the smoke
// test can't cover — smoke proves views render; these prove buttons work.
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

let app;
let page;
let tmpDir;

test.beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-e2e-'));
  app = await electron.launch({
    args: ['.', `--user-data=${tmpDir}`, '--no-sandbox'],
    cwd: path.join(__dirname, '..', '..'),
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app?.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// The suite is a journey — each test builds on the previous one's state.
test.describe.configure({ mode: 'serial' });

test('first launch shows the onboarding empty state', async () => {
  await expect(page.locator('#onboard-index')).toBeVisible();
  await expect(page.locator('.card')).toHaveCount(0);
});

test('a module can be created through the dialog', async () => {
  await page.click('#add-mod');
  await page.fill('dialog [name="code"]', 'COMP9999');
  await page.fill('dialog [name="name"]', 'E2E Testing');
  await page.click('dialog button[value="ok"]');
  const card = page.locator('.card', { hasText: 'COMP9999' });
  await expect(card).toBeVisible();
  await expect(page.locator('#onboard-index')).toHaveCount(0);
});

test('clicking the module card opens the module view', async () => {
  await page.click('.card');
  await expect(page.locator('#view')).toContainText('E2E Testing');
  await expect(page.locator('#add-topic')).toBeVisible();
});

test('a section (topic) can be added to the module', async () => {
  await page.click('#add-topic');
  await page.fill('dialog [name="name"]', 'Locator Strategies');
  await page.click('dialog button[value="ok"]');
  await expect(page.locator('#view')).toContainText('Locator Strategies');
});

test('course-info files sit in About this module, off the study board', async () => {
  await page.evaluate(async () => {
    const mod = (await window.api.modulesList())[0];
    await window.api.materialsCreate({ module_id: mod.id, title: 'Module handbook', path: '/x/handbook.pdf', type: 'overview' });
    await window.api.materialsCreate({ module_id: mod.id, title: 'Lecture 01', path: '/x/lec01.pdf', type: 'lecture' });
    location.hash = '#/dashboard'; // leave…
  });
  await expect(page.locator('#add-mod')).toBeVisible();
  await page.click('.card'); // …and re-enter the module view
  await expect(page.locator('#about-module')).toContainText('Module handbook');
  await expect(page.locator('#about-module .mat-card')).toHaveCount(1);
  // the handbook is NOT on the study board; the lecture is (in the inbox)
  await expect(page.locator('.inbox-panel')).toContainText('Lecture 01');
  await expect(page.locator('.inbox-panel')).not.toContainText('Module handbook');
});

test('pomodoro settings persist across navigation', async () => {
  await page.evaluate(() => { location.hash = '#/settings'; });
  await page.check('#pomo-on');
  await page.fill('#pomo-work', '30');
  await page.click('#save-pomo');
  await page.evaluate(() => { location.hash = '#/dashboard'; });
  await expect(page.locator('#add-mod')).toBeVisible();
  await page.evaluate(() => { location.hash = '#/settings'; });
  await expect(page.locator('#pomo-on')).toBeChecked();
  await expect(page.locator('#pomo-work')).toHaveValue('30');
});

test('notification preferences persist across navigation', async () => {
  await page.evaluate(() => { location.hash = '#/settings'; });
  await expect(page.locator('#rm-enabled')).toBeChecked(); // on by default
  await page.uncheck('#rm-streak');
  await page.click('#save-remind');
  await page.evaluate(() => { location.hash = '#/dashboard'; });
  await expect(page.locator('#add-mod')).toBeVisible();
  await page.evaluate(() => { location.hash = '#/settings'; });
  await expect(page.locator('#rm-streak')).not.toBeChecked();
  await expect(page.locator('#rm-deadlines')).toBeChecked();
});

test('settings shows the app version from package.json', async () => {
  const version = require('../../package.json').version;
  await expect(page.locator('#view')).toContainText(`Study Graph Assistant v${version}`);
});

test('data survives a full window reload (SQLite persistence)', async () => {
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => { location.hash = '#/dashboard'; });
  await expect(page.locator('.card', { hasText: 'COMP9999' })).toBeVisible();
});
