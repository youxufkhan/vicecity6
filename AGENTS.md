# AGENTS.md

Operating rules for agents (and humans) working in this repository.

**VICE CITY 6 — Neon Coast** is a browser game: Three.js + TypeScript + Vite,
one canvas, one scene, a fixed 60 Hz simulation. Textures and audio are procedural; 3D models may be
binary `.glb` files authored in SolidCraft.

---

## 1. Before you touch anything

```bash
npm install
npm test            # build + smoke suite + behaviour suite
```

Both suites must be green before you start and green when you finish.

Read the relevant pages of [`docs/`](docs/README.md) first:

| You are changing | Read |
| --- | --- |
| Anything structural | [docs/architecture.md](docs/architecture.md) |
| The city or props | [docs/world.md](docs/world.md) |
| Gameplay rules | [docs/gameplay.md](docs/gameplay.md) |
| Physics, AI, maths | [docs/algorithms.md](docs/algorithms.md) |
| HUD, menus, audio | [docs/interface.md](docs/interface.md) |
| Tests | [docs/testing.md](docs/testing.md) |
| Tooling, conventions | [docs/development.md](docs/development.md) |

## 2. Non-negotiable invariants

These are the rules that keep the game coherent. Each one exists because
breaking it produced a real, shipped bug.

1. **A renderable entity must be in the scene graph.** Create it → add its
   group to the scene. Destroy it → remove the group *and* dispose its
   geometry. Use the helpers in `TrafficManager`, `PedManager` and
   `FootCopManager`. Tag groups with `userData.kind` (`vehicle` / `ped` /
   `cop`). The smoke test compares rendered counts with simulated counts — a
   new entity type that is not counted and not tagged will not be caught, so
   add it to the counters in `Game.debugState` too.

2. **The AI must see the whole world.** Rebuild the AI context every frame
   from *all* vehicles (`TrafficManager.prepareContext`), never from a stale
   list. A car that is not in the context is a car the traffic will drive
   through — including the player's own parked car.

3. **Each AI writes its input exactly once per frame, before the vehicle
   integrates.** AI input → `car.update(dt, world)` → physics. Never run the
   same AI twice in a frame; it advances its own state (which road it is on)
   and will skip junctions.

4. **Physics runs for every vehicle**, including the player's. Do not skip
   `car.update()` for the car the player is driving.

5. **Only the player's actions feed the wanted system.** An AI car hitting a
   pedestrian is not the player's crime. Check `car.driver === 'player'`
   before adding heat.

6. **Sign conventions are fixed.**
   `forward = (sin yaw, cos yaw)`, `right = (-dz, dx)`, positive steer = turn
   right = yaw decreases, camera-relative "forward" = the direction the
   camera looks. If movement goes the wrong way, check the convention in
   [docs/algorithms.md](docs/algorithms.md) before editing anything else.

7. **Horizontal geometry must be wound counter-clockwise seen from above**,
   or it is back-face culled and invisible. Use `makeRectXZ()` /
   `makeStripXZ()` from `world/GeoUtil.ts` rather than building quads by hand.

8. **Every new subsystem must be observable.** Expose a `debugX()` method on
   `Game` that returns numbers, and assert on it in a test. A behaviour that
   cannot be measured will silently regress.

## 3. House style

- Strict TypeScript is on. `noUnusedLocals` and `noUnusedParameters` are
  errors, not warnings. Do not silence them with `_` prefixes — delete the
  dead code.
- Comments explain *why*, not *what*. If a constant or a formula needs a
  note (drag coefficients, lane offsets, sign conventions), write the note.
- Binary model assets are allowed: author vehicles, characters and weapons in
  SolidCraft (MCP), export `.glb` (metres, Y up) to `src/assets/models/`, and
  load them through one loader (imported with Vite `?url`). Keep each model
  under ~300 KB and ~15k triangles; keep the source recipe (batch JSON) in
  `scripts/models/` so models stay reproducible. Textures are still drawn on a
  canvas (`core/Textures.ts`) and sounds are synthesised (`systems/Audio.ts`).
  Always keep a procedural fallback so a failed load never blocks the game.
- Anything that must be reproducible uses `rngFrom(seed)`. `Math.random()` is
  only for cosmetic jitter.
- Repeated objects are `InstancedMesh`; static geometry is merged per
  material. Check `renderer.info.render.calls` after a change.
- Keep `index.html` + `styles.css` + `HUD.ts` / `Menus.ts` in sync when you
  touch the UI. `HUD.update()` only writes to the DOM when a value changed —
  preserve that.

## 4. Definition of done

A change is done when:

1. `npm run typecheck` is clean.
2. `npm test` is green — both suites.
3. New behaviour is asserted in `scripts/smoke.mjs` or
   `scripts/behaviour.mjs`, not just observed.
4. If it is visible, `npm run tour` has been run and the screenshots in
   `shots/` have been looked at.
5. The relevant page in `docs/` has been updated, and `AGENTS.md` /
   `README.md` still describe the project accurately.
6. Nothing in section 2 has been weakened.

## 5. Working rhythm

- Use `npm run dev` for iteration; use the test suites for verification. The
  suites run against `dist/`, not the dev server.
- When a bug is suspected but not understood, **measure before you change
  code**. Write a throwaway probe that boots the game and prints a number
  (`scripts/` already contains examples of this pattern), find out what is
  actually happening, then fix the cause. Guessing produces sign errors and
  inverted logic.
- Prefer fixing the root cause over adding a special case. Several of the
  worst bugs in this codebase (invisible traffic, inverted walking, an
  ocean-coloured street, a car that could not be driven) were all "the symptom
  was in one place and the cause was somewhere else".
- If you add a new entity type, a new AI behaviour, a new mission, a new
  weapon, a new prop or a new district, update the table in
  [docs/development.md](docs/development.md#where-things-live) so the next
  person knows where it goes.

## 6. Current state

Working, tested and playable. Known gaps are listed at the bottom of
[docs/development.md](docs/development.md#known-limitations) — check it before
assuming a feature exists.

Do not "fix" things outside the scope of the task you were given. If you find
an unrelated bug, report it rather than silently refactoring around it.
