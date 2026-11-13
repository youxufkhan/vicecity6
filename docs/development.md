# Development guide

## Toolchain

| Tool | Version | Purpose |
| --- | --- | --- |
| Node | 20+ (developed on 24) | Build and test runner |
| TypeScript | 5.6 | Strict type checking, `noEmit` |
| Vite | 5.4 | Dev server and production bundling |
| three | 0.169 | Renderer, scene graph, maths |
| puppeteer-core | 23.6 | Headless Chrome for the test suites |

No runtime dependencies beyond three. Binary assets limited to `.glb` models, no network calls at
runtime, no build step for content.

## Commands

```bash
npm install

npm run dev          # dev server on http://127.0.0.1:5173
npm run build        # tsc --noEmit && vite build  →  dist/
npm run preview      # serve dist/ on :4173
npm run typecheck    # types only

npm test             # build + smoke suite + behaviour suite
npm run test:smoke   # build + smoke suite
npm run test:behaviour
npm run tour         # capture review screenshots into shots/
```

`npm run dev` uses the Vite dev server with HMR; the module graph is served
straight from `src/`, so edits are picked up without a rebuild. The test
suites always run against `dist/` — a production build, not the dev server —
because that is what users get.

## TypeScript configuration

`tsconfig.json` is strict on purpose:

- `strict`, `noUnusedLocals`, `noUnusedParameters` — dead code is a build error
- `noImplicitOverride`, `noFallthroughCasesInSwitch`
- `noEmit` — Vite does the transpiling, `tsc` only type-checks
- `isolatedModules` — required by Vite's ESM output

`exactOptionalPropertyTypes` is deliberately **off**: three.js option bags
(`MeshStandardMaterial`, `Object3D`, …) are full of optional properties where
`undefined` and "absent" differ, and enabling it fights the library.

## Conventions

**Naming.** Files are PascalCase for classes and modules (`Vehicle.ts`,
`City.ts`) and camelCase for scripts (`smoke.mjs`). Types and interfaces are
PascalCase; variables and functions are camelCase; constants are SCREAMING_SNAKE.

**Comments.** Comment the *why*, not the *what*. The code should read as
plain English for the mechanics and as a short note wherever a constant or a
sign convention would otherwise be mysterious.

**Coordinate conventions.** X/Z ground plane, Y up. `forward = (sin yaw, cos yaw)`,
`right = (-dz, dx)`. These are used consistently in the player, the vehicles,
the traffic AI and the camera. Changing one means changing all of them.

**Seeded randomness.** Use `rngFrom(seed)` for anything that must be
reproducible (city layout, spawn placement). `Math.random()` is acceptable for
purely cosmetic jitter (particle noise, weapon spread).

**Assets.** Textures are drawn on a canvas in `core/Textures.ts`; sounds are
synthesised. Vehicles, characters and weapons may be `.glb` models authored in
SolidCraft (recipes in `scripts/models/`, output in `src/assets/models/`), always
with a procedural fallback. Simple props are still built from primitives and merged.

**Performance.** Repeated objects are `InstancedMesh`. Static geometry is
merged per material. Check `renderer.info.render.calls` after a change — the
city should stay in the low hundreds.

## Where things live

| Task | File |
| --- | --- |
| New rule, crime, punishment | `Game.ts` (the `onX` handlers and `updateWanted`) |
| New UI element | `index.html` + `styles.css` + `HUD.ts` |
| New screen or setting | `Menus.ts` (and `Settings` in the same file) |
| New sound | `systems/Audio.ts` (`play()` switch) |
| Building entrances and curb strips | `world/City.ts` (merged geometry) |
| New street furniture | `world/Props.ts` (instanced) |
| New building shape or district | `world/City.ts` + `world/Layout.ts` |
| New traffic behaviour | `entities/Traffic.ts` |
| New physics behaviour | `entities/Vehicle.ts` |
| New car model | `scripts/models/gen_cars.py` (recipe) → SolidCraft export → `scripts/models/build.sh` → `entities/CarFactory.ts` (`CAR_MODELS`) |
| New character part | `core/Soft.ts` shapes (`softMesh`) used by `Player.ts`, `Pedestrian.ts`, `FootCop.ts` |
| New mission | `systems/Missions.ts` |

## Debugging techniques used while building this

**Headless probes.** Most bugs were found by writing a small script that
boots the game and prints a measurement, rather than by reading code. The
useful trick is to expose a `debugX()` method that returns numbers, then assert
on them. Three of these became permanent tests (`debugTraffic`,
`debugTrafficFollow`, `debugBlockTraffic`).

**Render vs simulate counters.** When something is invisible, compare what the
simulation thinks exists with what is in the scene graph. That difference
found the "entities never added to the scene" bug.

**Sampling screenshots.** `scripts/png.mjs` decodes a PNG without any
dependency, so a test can assert that a region of the screen is not black.
This is how the "the whole street was rendering as the ocean" bug was
diagnosed — the road pixels were (18, 28, 50) instead of a grey.

**Check the sign conventions.** Most of the remaining subtle bugs were sign
errors: an inverted movement axis, a reversed steering sign, a flipped winding
order. When something moves the wrong way, verify the convention in
[algorithms.md](algorithms.md) before changing anything else.

**Fix the cause, not the symptom.** Several of the worst bugs here — invisible
traffic, inverted walking, an ocean-coloured street, a car that could not be
driven — all looked like local problems but had their cause somewhere else.
When a fix feels like a special case, that is usually a signal the model is
wrong somewhere else.

## Adding a feature, end to end

1. **Model** it in the right module (see the table above).
2. **Wire** it into `Game.updatePlaying` at the right point in the order —
   input first, then simulation, then presentation.
3. **Expose** it through `debugState` if it is observable.
4. **Assert** it in `scripts/smoke.mjs` or `scripts/behaviour.mjs`.
5. **Look** at it: add a shot to `scripts/tour.mjs` and check the PNG.
6. **Document** it in `docs/gameplay.md` and, if it changes a convention or an
   invariant, in `docs/architecture.md`.
7. Run `npm test`.

## Known limitations

- There is no interior geometry — every building is a solid volume.
- Car models are fixed-shape wedges (no damage deformation); wheels are one shared model scaled per car. Pedestrians still animate as rigid parts, not a skinned mesh.
- The game is keyboard-and-mouse first; touch supports movement, camera, driving, and firing.

## 3D models (SolidCraft)

Vehicles, the wheel and the rounded character shapes are authored in SolidCraft
through its MCP server. `scripts/models/gen_cars.py` writes one batch recipe per
car (side profile → symmetric extrude → arches → fillets, plus glass, trim and
light bodies named `Body`/`Glass`/`Trim*`/`Head*`/`Tail*`). Each is run through
the SolidCraft `batch` tool and exported as `.glb` into `scripts/models/src/`.
`scripts/models/build.sh` then decimates and compacts every export into
`src/assets/models/*.json` (a few KB each; positions in mm, baked colours). Paint
is applied at runtime to the `Body`/`Roof` group, so every car still gets random
colours and liveries. `npm run`-free preview: `node scripts/carshot.mjs sedan coupe …`
writes angle shots into `shots/`.

### Resolved limitations
- **Visible 3D weapon models & player overhaul** — real-time 3D models for sidearms and long guns (pistol with two-tone slide, micro SMG with shroud, shotgun) attached to the character's right hand; overhauled player character with tropical open-collar button-up shirt, aviator sunglasses, gold watch, and retro sneakers.
- **Next-gen procedural 3D automotive models** — overhauled vehicle visuals with aerodynamic front grilles, chin splitters, rear diffusers, dual chrome exhaust tips, side view mirrors, flared wheel arches, raked glass greenhouses, and 5-spoke alloy wheels with metallic brake disc rotors and red calipers.
- **Police and pedestrian visual upgrades** — foot police officers equipped with tactical dark-navy body armor vests, reflective POLICE lettering, gold badges, shoulder radios, utility duty belts, peaked service caps, and combat boots; civilians feature varied 80s hairstyles, diverse skin tones, sunglasses, and retro sneakers.
- **Wanted system rebalance** — tuned weapon shot and public disturbance heat, reduced sightless cooldown wait from 9.0s to 4.5s, and increased heat dissipation rate to 0.45/s for responsive, thrilling police evasion gameplay.
- **Pedestrian traffic awareness** — pedestrians detect approaching vehicles (>4.0 m/s within 3.8 m) and flee to avoid being run over.
- **Foot police combat & hitboxes** — officers on foot have full cylinder hitboxes, take bullet damage, can be eliminated or run over, and drop cash bounties when eliminated.
- **Dynamic traffic light cycles** — signal durations dynamically scale from 17 s in the dense downtown core to 11 s along outer districts.
- **Resilient audio resume** — AudioContext automatically initializes or resumes across keydown, pointerdown, and touchstart gestures, preventing silent audio context lockouts.
