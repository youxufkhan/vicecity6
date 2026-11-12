/**
 * Headless smoke test: boots the built game in Chrome, plays it for a few
 * seconds, and fails on any console error or uncaught exception.
 *
 *   node scripts/smoke.mjs [--url http://127.0.0.1:4173] [--shots out/]
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = join(__dirname, '..', 'dist');

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serve(directory) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost');
        let path = normalize(decodeURIComponent(url.pathname));
        if (path.endsWith('/')) path += 'index.html';
        const file = join(directory, path);
        if (!existsSync(file)) {
          res.writeHead(404);
          res.end('not found');
          return;
        }
        const data = await readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
        res.end(data);
      } catch (err) {
        res.writeHead(500);
        res.end(String(err));
      }
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) if (existsSync(candidate)) return candidate;
  throw new Error(`No Chrome binary found. Tried: ${CHROME_CANDIDATES.join(', ')}`);
}

const failures = [];
const warnings = [];

async function main() {
  const shotDir = argValue('--shots', join(root, '..', 'shots'));
  await mkdir(shotDir, { recursive: true });

  const { server, port } = await serve(root);
  const baseUrl = argValue('--url', `http://127.0.0.1:${port}`);

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
      '--window-size=1280,760',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 680, deviceScaleFactor: 1 });

  page.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error') {
      // Ignore benign browser noise.
      if (/favicon|Download the React/i.test(text)) return;
      failures.push(`console.error: ${text}`);
    } else if (type === 'warning') {
      if (/WebGL|SwiftShader|deprecated/i.test(text)) return;
      warnings.push(`console.warn: ${text}`);
    }
  });
  page.on('pageerror', (err) => failures.push(`pageerror: ${err.message}`));
  page.on('requestfailed', (req) => failures.push(`requestfailed: ${req.url()} ${req.failure()?.errorText ?? ''}`));

  console.log(`→ loading ${baseUrl}`);
  await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 60000 });

  // Wait for the game object.
  await page.waitForFunction('window.__game !== undefined', { timeout: 30000 });

  const fatalVisible = await page.evaluate(() => {
    const el = document.getElementById('fatal');
    return el ? !el.hidden : false;
  });
  if (fatalVisible) {
    const text = await page.evaluate(() => document.getElementById('fatal').textContent);
    failures.push(`fatal overlay shown: ${text}`);
  }

  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: join(shotDir, '01-title.png') });

  // Start the game.
  await page.evaluate(() => {
    const button = document.querySelector('[data-action="start"]');
    if (button) button.click();
  });
  await new Promise((r) => setTimeout(r, 1500));

  // Dismiss the click-to-play overlay so the screenshots show the game.
  await page.evaluate(() => {
    const overlay = document.getElementById('click-to-play');
    if (overlay) overlay.click();
  });
  await new Promise((r) => setTimeout(r, 600));

  let state = await page.evaluate(() => window.__game.debugState);
  console.log('state after start:', JSON.stringify(state));
  if (state.state !== 'playing') failures.push(`expected state "playing", got "${state.state}"`);

  await page.screenshot({ path: join(shotDir, '02-street.png') });

  // Walk forward for a moment (deterministic simulation, not wall clock).
  const before = await page.evaluate(() => window.__game.debugState.position);
  await page.keyboard.down('KeyW');
  await page.evaluate(() => window.__game.simulate(1.5));
  await page.keyboard.up('KeyW');
  const after = await page.evaluate(() => window.__game.debugState.position);
  const walked = Math.hypot(after[0] - before[0], after[2] - before[2]);
  console.log(`→ walked ${walked.toFixed(2)}m`);
  if (walked < 1) failures.push(`player did not move on foot (${walked.toFixed(2)}m)`);

  // Enter the nearest vehicle with E and drive.
  await page.keyboard.press('KeyE');
  await page.evaluate(() => window.__game.simulate(0.2));
  let entered = await page.evaluate(() => window.__game.debugState.inVehicle);
  if (!entered) {
    await page.evaluate(() => window.__game.debugEnterNearestVehicle());
    await page.evaluate(() => window.__game.simulate(0.2));
    entered = await page.evaluate(() => window.__game.debugState.inVehicle);
  }
  if (!entered) failures.push('could not enter a vehicle');

  const carBefore = await page.evaluate(() => window.__game.debugState.position);
  await page.keyboard.down('KeyW');
  await page.evaluate(() => window.__game.simulate(3));
  await page.keyboard.up('KeyW');
  const carAfter = await page.evaluate(() => window.__game.debugState.position);
  const drove = Math.hypot(carAfter[0] - carBefore[0], carAfter[2] - carBefore[2]);
  console.log(`→ drove ${drove.toFixed(2)}m`);
  if (drove < 5) failures.push(`car did not drive (${drove.toFixed(2)}m)`);

  state = await page.evaluate(() => window.__game.debugState);
  console.log('state after driving:', JSON.stringify(state));
  if (!state.inVehicle && !state.position) failures.push('player state missing');

  await page.screenshot({ path: join(shotDir, '03-driving.png') });

  // Fire a weapon and check the wanted system reacts.
  await page.mouse.move(640, 380);
  await page.mouse.down({ button: 'right' });
  await new Promise((r) => setTimeout(r, 200));
  await page.mouse.down({ button: 'left' });
  await new Promise((r) => setTimeout(r, 600));
  await page.mouse.up({ button: 'left' });
  await page.mouse.up({ button: 'right' });

  state = await page.evaluate(() => window.__game.debugState);
  console.log('state after shooting:', JSON.stringify(state));

  // ── mission flow ──
  const missionStart = await page.evaluate(() => ({
    title: window.__game.debugState.mission,
    objective: window.__game.debugState.objective,
  }));
  if (!missionStart.title) failures.push('no mission started');
  console.log('mission:', JSON.stringify(missionStart));

  // Teleport onto the mission marker so the objective can complete.
  const marker = await page.evaluate(() => {
    const m = window.__game.debugMissionMarker();
    return m ? { x: m.x, z: m.z } : null;
  });
  if (!marker) {
    failures.push('mission marker missing');
  } else {
    await page.evaluate(() => window.__game.debugExitVehicle());
    await page.evaluate((m) => window.__game.debugTeleport(m.x, m.z), marker);
    await page.evaluate(() => window.__game.simulate(1));
    const after = await page.evaluate(() => ({
      objective: window.__game.debugState.objective,
      state: window.__game.debugState.state,
    }));
    console.log('mission after reaching the marker:', JSON.stringify(after));
    if (after.objective === missionStart.objective) {
      failures.push('mission objective did not advance at the marker');
    }
  }

  // ── shooting ──
  const shotResult = await page.evaluate(() => window.__game.debugShootTest());
  console.log('shot result:', JSON.stringify(shotResult));
  if (!shotResult.killed) failures.push('firing at a pedestrian did not register a hit');
  if (shotResult.wanted < 1) failures.push('firing did not raise the wanted level');

  await page.screenshot({ path: join(shotDir, '03b-shooting.png') });

  // ── wanted level ──
  await page.evaluate(() => window.__game.debugRaiseWanted(2));
  await page.evaluate(() => window.__game.simulate(4));
  const wantedState = await page.evaluate(() => window.__game.debugState);
  console.log('after raising the heat:', JSON.stringify(wantedState));
  if (wantedState.wanted < 1) failures.push('wanted level did not rise');
  if (!wantedState.police) failures.push('no police dispatched');
  if (wantedState.renderedVehicles < wantedState.vehicles) {
    failures.push(`police not rendered: ${wantedState.renderedVehicles}/${wantedState.vehicles}`);
  }

  await page.screenshot({ path: join(shotDir, '05-police.png') });

  // Let the simulation run for a while so the AI, traffic and missions tick.
  await new Promise((r) => setTimeout(r, 6000));
  state = await page.evaluate(() => window.__game.debugState);
  console.log('state after 6s:', JSON.stringify(state));
  if (state.state !== 'playing' && state.state !== 'wasted') {
    failures.push(`unexpected state after simulation: ${state.state}`);
  }
  if (state.traffic === 0) failures.push('no traffic spawned');
  if (state.peds === 0) failures.push('no pedestrians spawned');
  // Everything the simulation tracks must also be attached to the scene graph.
  if (state.renderedVehicles < state.vehicles) {
    failures.push(`vehicles not rendered: ${state.renderedVehicles}/${state.vehicles}`);
  }
  if (state.renderedPeds < state.peds) {
    failures.push(`pedestrians not rendered: ${state.renderedPeds}/${state.peds}`);
  }

  await page.screenshot({ path: join(shotDir, '04-play.png') });

  // Frame rate sample.
  const fps = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = () => {
          frames++;
          if (performance.now() - start < 2000) requestAnimationFrame(tick);
          else resolve(Math.round((frames * 1000) / (performance.now() - start)));
        };
        requestAnimationFrame(tick);
      }),
  );
  console.log(`→ ~${fps} fps (software rasteriser)`);

  const errors = await page.evaluate(() => (window.__errors ?? []).length);

  await browser.close();
  server.close();

  console.log('\n─── smoke test summary ───');
  console.log(`screenshots: ${shotDir}`);
  console.log(`warnings: ${warnings.length}`);
  for (const w of warnings.slice(0, 10)) console.log('  ' + w);
  console.log(`failures: ${failures.length}`);
  for (const f of failures) console.log('  ✗ ' + f);
  void errors;

  if (failures.length > 0) {
    process.exitCode = 1;
  } else {
    console.log('✓ no console errors, game booted and ran');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
