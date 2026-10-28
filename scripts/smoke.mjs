import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const executablePath = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto('http://127.0.0.1:5173');
  await page.waitForFunction(() => window.battleScene);
  mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/menu.png' });
  await page.click('#start');
  assert.equal(await page.locator('#hud').isVisible(), true);
  await page.keyboard.down('ShiftLeft');
  await page.waitForTimeout(3000);
  await page.keyboard.up('ShiftLeft');
  const speed = await page.evaluate(() => window.battleScene.battle.player.speed);
  assert.ok(speed > 10, 'afterburner accelerates the aircraft on the runway');
  await page.keyboard.press('Escape');
  const t = await page.evaluate(() => window.battleScene.battle.time);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.battleScene.battle.time), t, 'pause stops time');
  await page.screenshot({ path: 'test-results/battle.png' });
  assert.deepEqual(errors, [], 'no browser runtime errors');
  console.log('Browser checks passed: menu, take-off roll, pause.');
} finally {
  await browser.close();
}
