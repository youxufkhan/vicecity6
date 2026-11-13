# Testing

Two headless suites run the real game in Chrome and assert on real gameplay.
Neither mocks the game: they boot the production build, drive it with synthetic
input and read state back out of the page.

```bash
npm test              # build + smoke suite + behaviour suite
npm run test:smoke    # build + smoke suite only
npm run test:behaviour# behaviour suite only (needs a fresh build)
npm run tour          # capture the review screenshots into shots/
```

Both suites start a small static file server from `dist/` on a random port,
launch `/usr/bin/google-chrome` with the SwiftShader software rasteriser
(headless machines have no GPU), and drive the page through Puppeteer Core.

Set `CHROME_PATH` if Chrome lives somewhere else.

## `scripts/smoke.mjs` — does it run?

| Assertion | Why it matters |
| --- | --- |
| No `console.error`, no `pageerror`, no failed requests | A runtime error must fail the build, not ship |
| The fatal-error overlay is hidden | A failed boot must be loud |
| The state reaches `playing` after Start | The state machine works |
| The player walks at least 1 m | The on-foot controller is wired up |
| The car drives at least 5 m | The vehicle physics and input are wired up |
| The player can enter a vehicle with `E` | The interaction prompt works |
| A mission objective advances at the marker | The mission state machine works |
| Firing at a pedestrian kills them and raises the heat | The hitscan, damage and wanted systems work |
| Police are dispatched when the heat rises | The wanted system responds |
| Traffic and pedestrians populate the world | The spawn managers work |
| `renderedVehicles >= vehicles` and `renderedPeds >= peds` | **Nothing simulates without rendering** |

That last one exists because of a real bug: traffic, police and pedestrians
were created, simulated, shown on the radar and drawn by no one, because their
groups were never added to the scene graph. The suite now counts what is
actually attached to the scene and compares it with what the simulation
believes exists.

The suite also prints the renderer statistics (`drawCalls`, `triangles`) and a
software-rendered frame-rate sample, which is useful as a rough regression
signal.

## `scripts/behaviour.mjs` — does it behave?

| Assertion | Why it matters |
| --- | --- |
| A key press survives a render without a simulation step and fires once on catch-up | Input works across refresh rates |
| Traffic stops behind the painted line and resumes on green | AI and street geometry agree |
| Cruisers spawn on clear roads and AI crashes add no heat | Police spawn and crime attribution work |
| Touch Use enters and exits the car and Fire spends one pistol round | Touch controls are wired through gameplay |
| Traffic stays on the road (≤ 4 of 20 briefly off) | Lane following works |
| Traffic keeps moving (average speed > 1 m/s) | Cars are not permanently stuck |
| Pedestrians stay on the pavement (≤ 8 on the road) | The sidewalk path works |
| The AI car ahead of the player brakes (16 m/s → ~0) and keeps 5 m | Car following works |
| Walking around for 20 s never raises the wanted level | Only the player's crimes count |
| Cruisers *and* officers on foot respond to the wanted level | The police respond |
| Every vehicle is in the scene graph | The render invariant holds |
| The player starts armed with ammunition | The player is not defenceless |

`debugBlockTraffic()` makes the car-following check deterministic: it parks
the player's car 14 m ahead of the fastest AI car and reports the AI car's
speed before and after.

## Debug hooks

All of these live on `Game` and exist only for the tests and the screenshot
tour:

| Hook | Purpose |
| --- | --- |
| `debugState` | JSON snapshot: state, position, vitals, wanted, counts, draw calls |
| `debugEnterNearestVehicle()` | Hop into the closest car |
| `debugExitVehicle()` | Step out |
| `debugTeleport(x, z)` | Move the player (and their car) |
| `debugSpawnTarget()` | Put a pedestrian in front of the player |
| `debugShootTest()` | Aim at a pedestrian, fire five rounds, report the result |
| `debugRaiseWanted(n)` | Force a wanted level |
| `debugSpawnCop(x, z)` | Place an officer at an exact spot |
| `debugCops()` | Officer count and positions |
| `debugTraffic()` | Off-road counts, speeds, pedestrians on the road |
| `debugTrafficFollow()` | Distance and speed of the nearest AI car |
| `debugTrafficAI()` | The AI state of the first few cars |
| `debugBlockTraffic()` | Deterministic car-following scenario |
| `debugCloseCamera(d)` / `debugLookAt(x, z)` | Frame a subject for a close-up |
| `debugSetTime(f)` | Jump to a time of day |
| `debugKillPlayer()` / `debugPause()` | Trigger the death and pause screens |
| `simulate(seconds)` | Advance the simulation deterministically |

## Screenshot tour

`scripts/tour.mjs` captures the title screen, the on-foot view, driving, a
sunset, night, a police chase, the world map, the pause menu, the WASTED
screen, the respawn and the settings panel into `shots/`. It is the fastest way
to see whether a visual change regressed something.

`scripts/png.mjs` is a dependency-free PNG decoder used to sample pixel
values out of those screenshots (for example to assert that the street is not
rendering black).

## Manual test script

Worth running by hand after a change to the feel of the game:

1. Start the game — you should be standing beside a red coupe with a pistol.
2. Walk into the street — pedestrians should scatter, and no car should run
   you over without slowing.
3. Press `E` — get in. Drive down the street: oncoming traffic should keep to
   its side, and cars ahead should queue.
4. Stop at a red light — the traffic beside you should also stop.
5. Press `M` — the map should show the grid, the mission marker and the police.
6. Fire the pistol — a tracer should appear, the shot should raise a star, and
   a cruiser should arrive within a few seconds.
7. Get out of the car with officers around — they should close in on foot and
   bust you if they get close.
8. Press `Esc` — the game should pause and release the pointer.
