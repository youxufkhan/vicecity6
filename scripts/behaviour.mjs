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

console.log('\n── fixed-step input ──');
const inputSteps = await page.evaluate(() => {
  const g = window.__game;
  const originalRaf = window.requestAnimationFrame;
  const originalTime = g.lastTime;
  const originalAccumulator = g.accumulator;
  let frame;
  window.requestAnimationFrame = (callback) => { frame = callback; return 0; };
  try {
    g.start();
    g.accumulator = 0;
    const time = g.lastTime;
    const before = g.debugState.weapon;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyQ' }));
    frame(time + 5);
    const afterShortFrame = g.debugState.weapon;
    frame(time + 40);
    return { before, afterShortFrame, afterCatchUp: g.debugState.weapon };
  } finally {
    window.requestAnimationFrame = originalRaf;
    g.lastTime = originalTime;
    g.accumulator = originalAccumulator;
    if (g.debugState.weapon === 'UNARMED') {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ' }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyQ' }));
      g.simulate(1 / 60);
    }
  }
});
check(inputSteps.afterShortFrame === inputSteps.before, 'a render without a simulation step leaves the weapon alone');
check(inputSteps.afterCatchUp !== inputSteps.before, 'the next simulation step consumes a queued key press exactly once');

console.log('\n── cover, pause and calm pedestrians ──');
const fairness = await page.evaluate(() => {
  const g = window.__game;
  const World = g.city.collision.constructor;
  const wall = new World([{ minX: -20, maxX: 20, minZ: -0.3, maxZ: 0.3, height: 8 }]);
  const cop = g.footCops.spawn(0, -4);
  const target = g.player.position.clone().set(0, 0, 4);
  let throughWallDamage = 0;
  for (let i = 0; i < 600; i++) throughWallDamage += cop.update(1 / 60, wall, target, g.effects);
  g.footCops.clear();
  const car = g.traffic.traffic[0];
  car.velocity.set(8, 0, 0);
  const position = car.position.clone();
  const time = g.elapsed;
  g.pauseGame();
  g.simulate(2);
  const pausedDistance = car.position.distanceTo(position);
  const pausedTime = g.elapsed - time;
  g.resumeGame();
  const ped = g.peds.spawnAt(20, 30);
  g.peds.update(1 / 60, new World(), 20, 31, []);
  const calm = ped.state !== 'flee';
  ped.kill();
  const embedded = wall.resolveCircle(0, 0, 0.42);
  const thin = new World([{ minX: -1, maxX: 1, minZ: 0.11, maxZ: 0.15, height: 8 }]);
  return { throughWallDamage, pausedDistance, pausedTime, calm,
    thinWall: thin.raycast(0, -4, 0, 4).hit,
    entrances: g.debugStreetDetail().entrances,
    escapedWall: !wall.overlaps(embedded.px, embedded.pz, 0.419) };
});
check(fairness.throughWallDamage === 0, 'solid cover blocks officer damage');
check(fairness.pausedDistance === 0 && fairness.pausedTime === 0, 'pause freezes vehicles and simulation time');
check(fairness.calm, 'a nearby peaceful player does not cause panic');
check(fairness.thinWall, 'thin walls block line of sight');
check(fairness.entrances > 30, 'building entrances are present in the scene');
check(fairness.escapedWall, 'collision resolution pushes an embedded circle out of a wall');

console.log('\n── vehicle body collisions ──');
const bodies = await page.evaluate(() => {
  const g = window.__game;
  const sample = g.traffic.traffic[0];
  const a = new sample.constructor(sample.spec, '#ffffff');
  const b = new sample.constructor(sample.spec, '#ffffff');
  a.position.set(0, 0, 82);
  b.position.set(a.spec.width + 0.2, 0, 82);
  const traffic = g.traffic.traffic.splice(0);
  const police = g.traffic.police.splice(0);
  g.traffic.traffic.push(a, b);
  const clearDistance = a.position.distanceTo(b.position);
  g.updateIdle(1 / 60);
  const noPhantomContact = Math.abs(a.position.distanceTo(b.position) - clearDistance) < 1e-6;
  b.position.copy(a.position);
  g.updateIdle(1 / 60);
  const separated = a.position.distanceTo(b.position) > a.spec.width * 0.9;
  a.position.set(0, 0, 82);
  a.yaw = Math.PI / 2;
  const nearMiss = !a.overlapsCircle(0, 82 + a.spec.width / 2 + 0.5, 0.35);
  const frontHit = a.overlapsCircle(a.spec.length / 2 + 0.1, 82, 0.35);
  g.traffic.traffic.splice(0, 2, ...traffic);
  g.traffic.police.push(...police);
  a.dispose(); b.dispose();
  return { noPhantomContact, separated, nearMiss, frontHit };
});
check(bodies.noPhantomContact, 'side-by-side cars with visible clearance do not collide');
check(bodies.separated, 'coincident cars separate without invalid coordinates');
check(bodies.nearMiss && bodies.frontHit, 'pedestrian hitboxes follow the rotated vehicle body');

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

console.log('\n── traffic respects the painted stop line ──');
const signalStop = await page.evaluate(() => {
  const g = window.__game;
  const roads = g.city.roads;
  const node = roads.nodes[24];
  const edge = node.edges.find((id) => roads.edgeDirection(id, node.id).dx === 1);
  const from = roads.otherEnd(edge, node.id);
  const sample = g.traffic.traffic[0];
  const car = new sample.constructor(sample.spec, '#ffffff');
  const ai = new sample.ai.constructor(roads, from, node.id);
  car.position.set(node.x + 30, 0, node.z - 4.2);
  car.yaw = -Math.PI / 2;
  car.velocity.set(-15, 0, 0);
  let time = 0;
  while (roads.signalState(node.id, 'x', time) !== 'red') time++;
  ai.time = time;
  for (let i = 0; i < 300; i++) {
    ai.update(car, 1 / 60);
    car.update(1 / 60, g.city.collision);
  }
  const stopped = { front: car.position.x - node.x - car.spec.length / 2, speed: car.speed };
  while (roads.signalState(node.id, 'x', time) !== 'green') time++;
  ai.time = time;
  for (let i = 0; i < 180; i++) {
    ai.update(car, 1 / 60);
    car.update(1 / 60, g.city.collision);
  }
  const resumed = car.speed;
  car.dispose();
  return { ...stopped, resumed };
});
check(signalStop.front >= 16 && signalStop.front < 19, `front bumper stops at the line (${signalStop.front.toFixed(1)} m from junction)`);
check(signalStop.speed < 0.5, 'traffic holds still at red');
check(signalStop.resumed > 3, 'traffic resumes on green');

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

console.log('\n── vehicle collision attribution ──');
const impacts = await page.evaluate(() => {
  const g = window.__game;
  const civilian = g.traffic.traffic[0];
  const cruiser = g.traffic.spawnPolice(g.player.position.x, g.player.position.z, g.city.collision);
  if (!cruiser) return null;
  const clearRoad = g.city.roads.isOnRoad(cruiser.position.x, cruiser.position.z) &&
    !g.city.collision.overlaps(cruiser.position.x, cruiser.position.z, cruiser.spec.length / 2);
  const before = g.wanted.heat;
  cruiser.lastImpactSpeed = 14;
  civilian.lastImpactSpeed = 14;
  g.handleVehicleImpacts([civilian, cruiser]);
  const afterAI = g.wanted.heat;
  const driver = civilian.driver;
  civilian.driver = 'player';
  g.onVehiclePairImpact(civilian, cruiser, 14);
  civilian.driver = driver;
  g.traffic.removePolice(1);
  const afterPlayer = g.wanted.heat;
  g.wanted.clear();
  return { before, afterAI, afterPlayer, clearRoad };
});
check(impacts?.clearRoad, 'cruisers spawn on a clear road');
check(impacts && impacts.before === impacts.afterAI, 'an AI cruiser crash adds no player heat');
check(impacts && impacts.afterPlayer > impacts.afterAI, 'a player collision with a cruiser adds heat');

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

console.log('\n── weapons: spread, recoil, hit detection ──');
const shooting = await page.evaluate(() => window.__game.debugShooting());
check(shooting.carKind === 'vehicle' && shooting.carDistance < 11.5, `ray hits the car's front face, not its centre (${shooting.carDistance} m)`);
check(shooting.missKind !== 'vehicle', 'ray passing beside a car misses it');
check(shooting.groundKind === 'ground', 'downward ray hits the ground');
check(shooting.hipSpread > shooting.aimSpread, 'hip fire is less accurate than aimed fire');
check(shooting.movingSpread > shooting.hipSpread, 'moving widens the spread');
check(shooting.fired === 1 && shooting.kickPitch > 0, 'a shot kicks the camera upward');

console.log('\n── traffic spawns without pop-in or overlap ──');
const spawn = await page.evaluate(() => window.__game.debugTrafficSpawn(40));
check(spawn.spawned > 0, `traffic keeps spawning (${spawn.spawned})`);
check(spawn.popIns === 0, `no car appears on screen (${spawn.popIns})`);
check(spawn.popOuts === 0, `no car vanishes on screen (${spawn.popOuts})`);
check(spawn.overlaps === 0, `no two traffic cars overlap (${spawn.overlaps} frames)`);

console.log('\n── SolidCraft car models ──');
const models = await page.evaluate(() => window.__game.debugCarModels());
check(models.built === 24, `all 6 car types build in all 4 liveries (${models.built}/24)`);
check(models.failures.length === 0, `no model build failures ${models.failures.join('; ')}`);
check(models.maxTriangles < 7000, `heaviest car stays under 7000 triangles (${models.maxTriangles})`);

console.log('\n── driving: tyre slip, handbrake, gears, damage ──');
const drv = await page.evaluate(() => window.__game.debugDriving());
check(drv.hardSlide > drv.gentleSlide * 2 && drv.hardSlide > 1.5, `a hard turn at speed slides (${drv.hardSlide.toFixed(1)} m/s vs ${drv.gentleSlide.toFixed(1)})`);
check(drv.handbrakeYaw > drv.noHandbrakeYaw * 1.2, `handbrake swings the tail round (${drv.handbrakeYaw.toFixed(2)} vs ${drv.noHandbrakeYaw.toFixed(2)} rad)`);
check(drv.lowGear < drv.highGear && drv.highGear === 5, `gears climb with speed (${drv.lowGear} -> ${drv.highGear})`);
check(drv.dentFront > 0 && drv.dentRear === 0, 'a nose hit dents only the front');
check(drv.normalShift > 0.01, `dented panels get fresh normals (${drv.normalShift.toFixed(2)})`);
check(drv.noseMoved > 0.05, `the nose geometry is pushed in (${drv.noseMoved.toFixed(2)} m)`);

console.log('\n── traffic signal cycles vary by district density ──');
const cycles = await page.evaluate(() => {
  const g = window.__game;
  return g.debugTrafficCycles();
});
check(cycles.downtown > cycles.outer, `downtown cycle (${cycles.downtown}s) longer than perimeter (${cycles.outer}s)`);

console.log('\n── look: reflections and headlight beams ──');
const look = await page.evaluate(() => window.__game.debugLook());
check(look.envBaked, 'car paint and glass have a baked sky reflection');
check(look.poolNight > 0.3 && look.poolDay === 0, `AI headlight pools glow at night only (${look.poolNight.toFixed(2)} / ${look.poolDay})`);
check(look.roadRoughNight < look.roadRoughDay - 0.2, `roads get wetter at night (${look.roadRoughNight.toFixed(2)} < ${look.roadRoughDay.toFixed(2)})`);
check(look.beamNight > 20 && look.beamDay === 0, `headlight beams on at night (${look.beamNight.toFixed(0)}), off by day`);

console.log('\n── touch play ──');
const phone = await browser.newPage();
await phone.setViewport({ width: 390, height: 720, isMobile: true, hasTouch: true });
await phone.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle2' });
await phone.waitForFunction('window.__game !== undefined');
await phone.tap('[data-action="start"]');
const tapUse = async () => {
  await phone.tap('[data-touch="action"]');
  return phone.evaluate(() => {
    window.__game.simulate(0.05);
    return window.__game.debugState.inVehicle;
  });
};
check(await tapUse(), 'touch Use enters the starter car');
check(!(await tapUse()), 'touch Use exits the starter car');
const ammoBeforeTap = await phone.evaluate(() => window.__game.debugState.ammo);
await phone.tap('[data-touch="fire"]');
const ammoAfterTap = await phone.evaluate(() => {
  window.__game.simulate(0.05);
  return window.__game.debugState.ammo;
});
check(ammoAfterTap === ammoBeforeTap - 1, 'touch Fire shoots one pistol round');

await browser.close();
server.close();

console.log(`\nfailures: ${failures.length}`);
for (const f of failures) console.log('  ✗ ' + f);
if (failures.length) process.exitCode = 1;
else console.log('✓ all behaviour checks passed');
