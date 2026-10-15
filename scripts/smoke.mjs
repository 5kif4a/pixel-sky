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
const state = (fn) => page.evaluate(fn);
try {
  await page.goto('http://127.0.0.1:5173');
  await page.waitForFunction(() => window.pixelSky?.scene.scenes[0]?.player);
  mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/menu.png' });
  await page.click('[data-plane="MiG-35"]');
  await page.click('#start');
  assert.equal(await page.locator('#hud').isVisible(), true);
  assert.equal(await state(() => window.pixelSky.scene.scenes[0].player.model), 'MiG-35');
  const before = await state(() => window.pixelSky.scene.scenes[0].player.heading);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(350);
  await page.keyboard.up('KeyD');
  const after = await state(() => window.pixelSky.scene.scenes[0].player.heading);
  assert.ok(after > before + 0.1, 'steering changes heading');
  await page.keyboard.press('Escape');
  const paused = await state(() => window.pixelSky.scene.scenes[0].elapsed);
  await page.waitForTimeout(250);
  assert.equal(await state(() => window.pixelSky.scene.scenes[0].elapsed), paused);
  await page.keyboard.press('Escape');
  await page.keyboard.press('KeyB');
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(100);
  assert.equal(await state(() => window.pixelSky.scene.scenes[0].player.bombs), 7);
  assert.equal(await state(() => window.pixelSky.scene.scenes[0].player.flares), 11);
  await page.keyboard.down('Space');
  await page.waitForTimeout(250);
  await page.keyboard.up('Space');
  assert.ok(await state(() => window.pixelSky.scene.scenes[0].shots.some((s) => s.kind === 'gun')));
  await page.screenshot({ path: 'test-results/battle.png' });

  // Controlled scenarios exercise missile guidance, bomb impacts and match completion.
  const missileHit = await state(() => {
    const s = window.pixelSky.scene.scenes[0];
    s.enemies[1].hp = 0;
    const p = s.player;
    Object.assign(p, { x: 700, y: 1000, z: 100, heading: 0, speed: 150 });
    const e = s.enemies[0];
    Object.assign(e, { x: 850, y: 1000, z: 100, heading: 0, hp: 100, speed: 140, cooldown: 99 });
    s.shots = [];
    s.selected = e;
    for (let i = 0; i < 75; i++) s.step(1 / 60);
    if (s.lock < 1) return false;
    s.keys.add('KeyF');
    s.step(1 / 60);
    for (let i = 0; i < 90; i++) s.step(1 / 60);
    return p.missiles === 5 && e.hp < 100;
  });
  assert.ok(missileHit, 'a locked missile launches and damages an aircraft');
  const victory = await state(() => {
    const s = window.pixelSky.scene.scenes[0];
    s.enemies.forEach((e) => (e.hp = 0));
    for (const target of s.ground) {
      const p = s.player;
      Object.assign(p, { x: target.x - 150, y: target.y, z: 45, heading: 0, speed: 150 });
      s.keys.add('KeyB');
      s.step(1 / 60);
      for (let i = 0; i < 70 && !s.finished; i++) s.step(1 / 60);
    }
    return s.finished && s.ground.every((t) => t.hp === 0);
  });
  assert.ok(victory, 'bombs destroy the three objectives and complete the mission');
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(100);
  assert.equal(await state(() => window.pixelSky.scene.scenes[0].finished), false);
  assert.equal(await state(() => window.pixelSky.scene.scenes[0].player.bombs), 8);
  await state(() => {
    const s = window.pixelSky.scene.scenes[0];
    s.player.hp = 0;
    s.step(1 / 60);
  });
  assert.match(await page.locator('#message').innerText(), /САМОЛЁТ ПОТЕРЯН/);
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(100);
  assert.equal(await state(() => window.pixelSky.scene.scenes[0].finished), false);
  assert.deepEqual(errors, [], 'no browser runtime errors');
  console.log(
    'Browser checks passed: selection, flight, pause, weapons, missile hit, bombing victory, defeat, restart.',
  );
} finally {
  await browser.close();
}
