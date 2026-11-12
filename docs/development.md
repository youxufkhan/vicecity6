# Development guide

## Toolchain

| Tool | Version | Purpose |
| --- | --- | --- |
| Node | 20+ (developed on 24) | Build and test runner |
| TypeScript | 5.6 | Strict type checking, `noEmit` |
| Vite | 5.4 | Dev server and production bundling |
| three | 0.169 | Renderer, scene graph, maths |
| puppeteer-core | 23.6 | Headless Chrome for the test suites |

No runtime dependencies beyond three. No binary assets, no network calls at
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

**Assets.** No binary assets. If you need a new texture, draw it on a canvas in
`core/Textures.ts`. If you need a new mesh, build it from primitives in the
relevant `entities/` or `world/` file and merge it.

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
| New street furniture | `world/Props.ts` (instanced) |
| New building shape or district | `world/City.ts` + `world/Layout.ts` |
| New traffic behaviour | `entities/Traffic.ts` |
| New physics behaviour | `entities/Vehicle.ts` |
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
- The game is keyboard-and-mouse first; touch support exists but has not been tuned.

### Resolved limitations
- **Pedestrian traffic awareness** — pedestrians detect approaching vehicles (>3.5 m/s within 8.5 m) and flee to avoid being run over.
- **Foot police combat & hitboxes** — officers on foot have full cylinder hitboxes, take bullet damage, can be eliminated or run over, and drop cash bounties when eliminated.
- **Dynamic traffic light cycles** — signal durations dynamically scale from 17 s in the dense downtown core to 11 s along outer districts.
- **Resilient audio resume** — AudioContext automatically initializes or resumes across keydown, pointerdown, and touchstart gestures, preventing silent audio context lockouts.
