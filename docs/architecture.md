# Architecture

## Shape of the game

VICE CITY 6 is a single-page browser game: one `HTMLCanvasElement`, one
`THREE.WebGLRenderer`, one `THREE.Scene`, and a simulation that advances in
fixed 60 Hz steps. There is no server, no persistence beyond `localStorage`
for settings, and no binary assets beyond SolidCraft-authored `.glb` models — every
texture and sound is generated at runtime.

```
src/
├── main.ts                 bootstrap, fatal error surface
├── Game.ts                 orchestration: state machine, loop, game rules
├── core/
│   ├── Input.ts            keyboard / mouse / touch, pointer lock
│   ├── MathUtil.ts         vectors, angles, seeded RNG, formatting
│   └── Textures.ts         every texture, drawn on a 2D canvas
├── world/
│   ├── Layout.ts           city grid, road network, traffic-light phases
│   ├── City.ts             static geometry: roads, sidewalks, lots, buildings
│   ├── GeoUtil.ts          geometry helpers (strips, quads, UV remapping)
│   ├── Props.ts            instanced street furniture, traffic signals
│   └── Sky.ts              sky shader, sun, day/night lighting rig
├── entities/
│   ├── CarFactory.ts       procedural car meshes and liveries
│   ├── Vehicle.ts          arcade vehicle physics and collisions
│   ├── Traffic.ts          traffic AI, police AI, spawn/despawn managers
│   ├── Player.ts           third-person character rig and controller
│   ├── Pedestrian.ts       civilians, sidewalk paths, crowd manager
│   └── FootCop.ts          officers on foot
├── systems/
│   ├── Collision.ts        uniform-grid broadphase + circle/ray queries
│   ├── CameraRig.ts        third-person camera, auto-align, occlusion pull-in
│   ├── Weapons.ts          aiming, hitscan, weapons, reload
│   ├── Missions.ts         mission definitions and objective state machine
│   ├── Wanted.ts           five-star heat model
│   ├── Effects.ts          particles, tracers, skid marks, explosions
│   └── Audio.ts            synthesised sound and music
└── ui/
    ├── HUD.ts              radar, speedometer, mission banner, toasts, world map
    └── Menus.ts            screens, settings persistence
```

## The game loop

`Game.start()` installs a `requestAnimationFrame` loop:

```
frame(now):
  dt       = min((now - lastTime) / 1000, 0.1)     // never simulate a huge step
  acc     += dt
  while (acc >= STEP && steps < 5):                // STEP = 1/60
    update(STEP)
    input.endStep()
    acc -= STEP
  render()
```

Why it is built this way:

- **Fixed step** — physics, AI and mission logic advance in equal 1/60 s slices,
  so behaviour does not change with frame rate. A 144 Hz machine and a 30 Hz
  machine simulate the same world.
- **Step cap** — at most 5 steps per frame. If the renderer stalls (tab in the
  background, a slow GPU) the simulation slows down instead of spiralling or
  tunnelling cars through walls. `acc` is reset when the cap is hit.
- **`endStep()`** clears key edges, button edges, and accumulated look input
  after a simulation step. Input survives renders with no simulation step and
  is consumed once during catch-up frames.

`Game.simulate(seconds)` uses the same step wrapper as the live loop so tests
can drive the game deterministically without depending on wall-clock time.

## Game state machine

`Game.state` is one of:

| State | Meaning | Simulation |
| --- | --- | --- |
| `title` | Main menu over a slow orbit of the city | Traffic updates, camera orbits |
| `playing` | Live gameplay | Everything |
| `paused` | Pause menu (also entered when the pointer lock is lost) | Simulation frozen |
| `wasted` | Player died / was busted | World breathes, no input |
| `clear` | Mission passed | World breathes, no input |

`update()` dispatches to `updateTitle`, `updatePlaying` or `updateIdle`; the
effects, props and signal updates freeze in the pause menu and while the map
is open. Other menu states retain their background animation.

## Order of operations inside `updatePlaying`

The order matters — it is the implicit contract between systems:

```
 1. camera look            mouse delta → camera yaw/pitch
 2. world map              M toggles the map; freezes the action
 3. player / vehicle       foot movement or vehicle throttle/steer
 4. aiming and shooting    aim point → weapon update → fire
 5. vehicles               AI drives the AI cars; every car integrates physics
 6. traffic                spawn and recycle AI traffic
 7. pedestrians            walk, flee, despawn
 8. wanted                 heat decay, dispatch, busting
 9. missions               objective progress
10. pickups                cash, health, armour, weapons
11. camera                 third-person follow with occlusion
12. world                  sky, water scroll, night lighting
13. audio                  engine tone, siren
14. hud                    radar, speedometer, blips, markers
```

Step 5 begins by rebuilding the AI context from the complete vehicle list,
including a starter car that the player parked and walked away from. Each AI
writes input once before its vehicle integrates. After pair collisions,
the driver's position is synchronized to the car before the remaining systems
read it.

## Ownership rules

These are the invariants that keep the systems honest. Breaking one usually
produces an entity that simulates perfectly but never appears on screen.

| Rule | Where it is enforced |
| --- | --- |
| A renderable entity is added to the scene graph when it is created and removed when it is destroyed | `TrafficManager.addToScene/removeFromScene`, `PedManager.addToScene/removeFromScene` |
| Entities are tagged `userData.kind` (`vehicle`, `ped`, `cop`) so the smoke test can compare rendered vs simulated counts | `TrafficManager`, `PedManager`, `FootCopManager` |
| The AI context is rebuilt every frame from *all* vehicles, never cached | `TrafficManager.prepareContext` |
| Physics runs for every vehicle, including the player's | `Game.updatePlaying` step 5 |
| AI input is written **before** the vehicle integrates, exactly once per frame | `Game.updatePlaying` step 5 |
| The camera follows the player, the aim ray follows the camera | `Game.updateAim` |
| Heat is only added by the player's own actions | `Game.handlePedCollisions`, `Game.onPedHit` |

## Data flow for a single frame

```
Input  ──►  Game.updatePlaying
              ├──► Player / Vehicle   (input → throttle, steer, movement)
              ├──► WeaponSystem       (aim origin + direction → hitscan → damage)
              ├──► TrafficAI/PoliceAI (vehicle + context → throttle, steer)
              ├──► Pedestrian/FootCop (position, state → walk, shoot)
              ├──► MissionSystem      (player position, wanted level → objective)
              └──► HUD                (state → DOM + radar canvas)
                                   │
                                   ▼
                            THREE.Scene ──► WebGLRenderer ──► canvas
```

## Extension points

| To add… | Do this |
| --- | --- |
| A new vehicle type | Add a `CarSpec` to `CAR_SPECS` in `CarFactory.ts`. The mesh, physics, AI and HUD all read from the spec. |
| A new weapon | Add an entry to `WEAPONS` in `Weapons.ts`, then place it as a pickup in `Game.spawnPickups`. |
| A new mission | Add a `Mission` to `buildMissionList()` in `Missions.ts`. The step kinds (`goto`, `steal`, `deliver`, `collect`, `escape`, `destroy`) already exist. |
| A new street prop | Add a merged geometry + `THREE.InstancedMesh` in `Props.ts`. Keep it instanced — per-prop meshes do not scale. |
| A new district | Extend `districtOf()` in `Layout.ts`, then add a palette and facade list in `City.ts`. |
| A new AI behaviour | Implement `VehicleAI` (`update(vehicle, dt)`) and assign it to `car.ai`. |
| A new UI element | Add markup to `index.html`, style it in `styles.css`, drive it from `HUD.ts`. Keep DOM writes conditional — `HUD.update` compares against cached values to avoid layout thrash. |

## Rendering and performance

- The static world is merged: one buffer per material (roads, asphalt,
  sidewalks, lot pads, markings, one per facade kind, roof clutter). The whole
  city is a handful of draw calls.
- Repeated props (lamps, traffic signals, palms, trees, benches, hydrants,
  bins, light pools) are `THREE.InstancedMesh`.
- Cars are merged meshes with per-car vertex colours for the paint, so all
  cars of a body type share one material.
- The sky is a single `ShaderMaterial` sphere with `BackSide` and
  `depthWrite: false`, rendered first (`renderOrder = -1000`).
- A populated city (≈40 vehicles, ≈26 pedestrians, officers, props) renders in
  roughly **250 draw calls / 65 k triangles**, measured with
  `renderer.info` in the smoke test.
