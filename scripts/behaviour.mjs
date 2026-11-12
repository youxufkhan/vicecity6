/**
 * Behaviour regression test. Guards the systems that are easy to break:
 * road discipline, car following, pedestrian behaviour and the wanted system.
 *
 *   node scripts/behaviour.mjs
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';

const root = join(process.cwd(), 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  let p = normalize(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = join(root, p);
  if (!existsSync(f)) return res.writeHead(404).end('x');
  const data = await readFile(f);
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] ?? 'application/octet-stream' });
  res.end(data);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${message}`);
  if (!ok) failures.push(message);
};

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 800, height: 500 });
page.on('pageerror', (e) => {
  console.log('[pageerror]', e.message);
  failures.push(`pageerror: ${e.message}`);
});
await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__game !== undefined');
await page.evaluate(() => document.querySelector('[data-action="start"]').click());
await new Promise((r) => setTimeout(r, 900));

console.log('\n── traffic keeps to the road ──');
const traffic = await page.evaluate(() => {
  const g = window.__game;
  let worstOffRoad = 0;
  let worstPedsOnRoad = 0;
  let minSpeed = Infinity;
  for (let i = 0; i < 30; i++) {
    g.simulate(1);
    const t = g.debugTraffic();
    worstOffRoad = Math.max(worstOffRoad, t.offRoad);
    worstPedsOnRoad = Math.max(worstPedsOnRoad, t.pedOnRoad);
    minSpeed = Math.min(minSpeed, t.avgSpeed);
  }
  return { worstOffRoad, worstPedsOnRoad, minSpeed, cars: g.debugTraffic().cars };
});
check(traffic.cars > 10, `traffic is populated (${traffic.cars} cars)`);
check(
  traffic.worstOffRoad <= 4,
  `traffic stays on the roads (worst: ${traffic.worstOffRoad} of ${traffic.cars} briefly off-road)`,
);
check(traffic.minSpeed > 1, `traffic keeps moving (slowest average ${traffic.minSpeed.toFixed(1)} m/s)`);
check(
  traffic.worstPedsOnRoad <= 8,
  `pedestrians stay on the pavement (worst: ${traffic.worstPedsOnRoad} on the road)`,
);

console.log('\n── traffic queues behind the player ──');
const follow = await page.evaluate(() => {
  const g = window.__game;
  const block = g.debugBlockTraffic();
  return block;
});
check(follow !== null, 'found an AI car to block');
if (follow) {
  check(follow.speedAfter < follow.speedBefore, `the AI car brakes for the player's car (${follow.speedBefore.toFixed(1)} → ${follow.speedAfter.toFixed(1)} m/s)`);
  check(follow.distance > 2.5, `the AI car keeps its distance (${follow.distance.toFixed(1)} m)`);
}

console.log('\n── wanted level stays down while walking ──');
const walk = await page.evaluate(() => {
  const g = window.__game;
  const levels = [];
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    g.debugTeleport(Math.cos(a) * 12 + 8, Math.sin(a) * 12 + 86);
    g.simulate(1);
    levels.push(g.debugState.wanted);
  }
  return levels;
});
check(Math.max(...walk) === 0, `no wanted level from walking (max ${Math.max(...walk)})`);

console.log('\n── police respond to the wanted level ──');
const police = await page.evaluate(() => {
  const g = window.__game;
  g.debugRaiseWanted(3);
  g.simulate(6);
  return { state: g.debugState, cops: g.debugCops() };
});
check(police.state.wanted >= 1, `wanted level rose (${police.state.wanted})`);
check(police.state.police > 0, `cruisers dispatched (${police.state.police})`);
check(police.cops.count > 0, `officers on foot (${police.cops.count})`);
check(police.state.renderedVehicles >= police.state.vehicles, 'every vehicle is in the scene graph');

console.log('\n── the player starts armed ──');
const weapon = await page.evaluate(() => {
  const g = window.__game;
  const s = g.debugState;
  return { weapon: s.weapon, ammo: s.ammo };
});
check(weapon.weapon !== 'UNARMED', `player starts with a weapon (${weapon.weapon})`);
check(weapon.ammo > 0, `player starts with ammunition (${weapon.ammo})`);

console.log('\n── officers on foot can be shot and killed ──');
const copShoot = await page.evaluate(() => {
  const g = window.__game;
  return g.debugShootCop();
});
check(copShoot.hit, 'bullet hitscan detects officer on foot');
check(copShoot.killed, 'damage to officer on foot kills them');
check(!copShoot.copAlive, 'dead officer is marked not alive');

console.log('\n── traffic signal cycles vary by district density ──');
const cycles = await page.evaluate(() => {
  const g = window.__game;
  return g.debugTrafficCycles();
});
check(cycles.downtown > cycles.outer, `downtown cycle (${cycles.downtown}s) longer than perimeter (${cycles.outer}s)`);

await browser.close();
server.close();

console.log(`\nfailures: ${failures.length}`);
for (const f of failures) console.log('  ✗ ' + f);
if (failures.length) process.exitCode = 1;
else console.log('✓ all behaviour checks passed');
