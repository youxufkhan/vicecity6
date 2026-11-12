/**
 * Visual tour: captures the key screens and moments of the game so the
 * result can be reviewed. Writes PNGs into ./shots.
 *
 *   node scripts/tour.mjs
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';

const root = join(process.cwd(), 'dist');
const shotDir = join(process.cwd(), 'shots');
await mkdir(shotDir, { recursive: true });

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

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 680 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__game !== undefined');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  await wait(500);
  await page.screenshot({ path: join(shotDir, name) });
  console.log('→', name);
};

await shot('tour-01-title.png');

await page.evaluate(() => document.querySelector('[data-action="start"]').click());
await wait(1200);
await page.evaluate(() => document.getElementById('click-to-play').click());
await wait(600);
await shot('tour-02-onfoot.png');

// Drive into the city.
await page.evaluate(() => window.__game.debugEnterNearestVehicle());
await page.keyboard.down('KeyW');
await page.evaluate(() => window.__game.simulate(3.2));
await page.keyboard.up('KeyW');
await wait(400);
await shot('tour-03-driving.png');

// Sunset.
await page.evaluate(() => window.__game.debugSetTime(0.76));
await wait(800);
await shot('tour-04-sunset.png');

// Night.
await page.evaluate(() => window.__game.debugSetTime(0.92));
await wait(1200);
await shot('tour-05-night.png');

// Wanted + police chase at night.
await page.evaluate(() => {
  window.__game.debugRaiseWanted(3);
  window.__game.simulate(3);
});
await wait(800);
await shot('tour-06-wanted.png');

// World map.
await page.keyboard.press('KeyM');
await page.evaluate(() => window.__game.simulate(0.1));
await wait(500);
await shot('tour-06b-map.png');
await page.keyboard.press('KeyM');
await page.evaluate(() => window.__game.simulate(0.1));
await wait(300);

// Pause menu.
await page.evaluate(() => window.__game.debugPause());
await wait(400);
await shot('tour-07-pause.png');

// Resume, then die.
await page.evaluate(() => document.querySelector('[data-action="resume"]').click());
await wait(400);
await page.evaluate(() => window.__game.debugKillPlayer());
await page.evaluate(() => window.__game.simulate(0.5));
await wait(400);
await shot('tour-08-wasted.png');

// Respawn.
await page.evaluate(() => document.querySelector('[data-action="respawn"]').click());
await wait(600);
await shot('tour-09-respawn.png');

// Settings panel.
await page.evaluate(() => window.__game.debugPause());
await wait(300);
await page.evaluate(() => document.querySelector('[data-action="settings"]').click());
await wait(300);
await shot('tour-10-settings.png');

await browser.close();
server.close();
console.log('tour complete');
