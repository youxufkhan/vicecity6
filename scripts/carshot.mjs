/**
 * Renders showcase shots of cars from several angles into shots/.
 *   node scripts/carshot.mjs sedan [coupe ...]
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
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] ?? 'application/octet-stream' });
  res.end(await readFile(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 560 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__game !== undefined');
await page.evaluate(() => document.querySelector('[data-action="start"]').click());
await new Promise((r) => setTimeout(r, 800));
await page.evaluate(() => document.getElementById('click-to-play')?.click());
await new Promise((r) => setTimeout(r, 500));
if (process.env.NIGHT) await page.evaluate(() => window.__game.debugSetTime(0.02));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (const id of process.argv.slice(2)) {
  if (id.startsWith('player')) {
    await page.evaluate((w) => { window.__weapon = w; }, id.split(':')[1] ?? 'pistol'); // character close-up
    await page.evaluate(() => {
      const g = window.__game;
      document.getElementById('hud').style.display = 'none';
      g.player.group.visible = true;
      const p = g.player.position;
      const w = window.__weapon ?? 'pistol'; g.weapons.give(w, 30); g.player.setWeapon(w);
      const a = g.player.yaw - 1.0; // three-quarter view from the right
      g.debugCameraPose(p.x + Math.sin(a) * 2.1, 1.35, p.z + Math.cos(a) * 2.1, p.x, 1.0, p.z);
      g.simulate(0.05);
    });
    await wait(600);
    await page.screenshot({ path: join(shotDir, `char-${id.replace(':', '-')}.png`) });
    console.log('→ char-player.png');
    continue;
  }
  for (const [tag, ang] of [['front34', 0.6], ['rear34', 2.6], ['side', 1.57]]) {
    await page.evaluate((id, ang) => {
      const g = window.__game;
      document.getElementById('hud').style.display = 'none';
      g.player.group.visible = false;
      window.__showcase?.group.parent?.remove(window.__showcase.group);
      const car = (window.__showcase = g.debugShowcaseCar(id, '#c0152a', 'civil', 0));
      const cx = car.position.x, cz = car.position.z;
      const r = 7.5;
      // yaw 0 = car faces +Z; orbit the camera around it.
      g.debugCameraPose(cx + Math.sin(ang) * r, 1.9, cz + Math.cos(ang) * r, cx, 0.7, cz);
      g.simulate(0.1);
      g.player.group.visible = false;
    }, id, ang);
    await wait(600);
    const out = join(shotDir, `car-${id}-${tag}.png`);
    await page.screenshot({ path: out });
    console.log('→', out);
  }
}
await browser.close();
server.close();
