# Implementation documentation

This directory is the engineering documentation for **VICE CITY 6 — Neon Coast**.

| Document | What it covers |
| --- | --- |
| [architecture.md](architecture.md) | Module map, the game loop, data flow, ownership rules, extension points |
| [world.md](world.md) | City generation: grid, districts, buildings, facades, props, road network |
| [gameplay.md](gameplay.md) | Vehicles, traffic, pedestrians, police, combat, wanted system, missions |
| [algorithms.md](algorithms.md) | The non-obvious maths: arcade physics, lane following, collisions, hitscan, day/night |
| [interface.md](interface.md) | HUD, radar, world map, menus, audio, settings |
| [testing.md](testing.md) | The two headless suites, what they assert, how to extend them |
| [development.md](development.md) | Toolchain, commands, conventions, debugging techniques |

Start with [architecture.md](architecture.md) if you are new to the codebase, or
[testing.md](testing.md) if you are about to change behaviour.

Related documents outside this directory:

- [`../README.md`](../README.md) — what the game is, how to run and play it
- [`../AGENTS.md`](../AGENTS.md) — rules for agents (and humans) working in this repo

## Conventions used in these docs

- **World axes** — X and Z are the ground plane, Y is up. A car's heading `yaw`
  is measured such that `forward = (sin yaw, cos yaw)`; a yaw of `0` points at
  `+Z`, a yaw of `π/2` points at `+X`.
- **Right-hand rule** — `right = (-dz, dx)` for a forward vector `(dx, dz)` in
  the XZ plane. Used for lane offsets, lateral velocity and strafing.
- **Units** — metres, seconds, radians. Speeds in the HUD are km/h (m/s × 3.6).
- **Seeded randomness** — `rngFrom(seed)` (mulberry32) is used for anything that
  must be reproducible. `Math.random()` is only used for cosmetic variation
  (particle jitter, weapon spread).
