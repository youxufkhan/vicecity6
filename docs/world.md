# World generation

Everything about the city is derived from one description — the grid in
`src/world/Layout.ts` — so the road network, the collision boxes, the prop
placement and the traffic routes can never disagree with each other.

## The grid

```
COLS = 7      road lines along X
ROWS = 7      road lines along Z
ROAD_WIDTH    = 16      (two lanes of 8, one each way)
BLOCK_SIZE    = 66      the city block between two road lines
SIDEWALK_WIDTH = 4.5    pavement ring around each block
CELL          = BLOCK_SIZE + ROAD_WIDTH = 82
HALF_X        = 287     (COLS * CELL) / 2
HALF_Z        = 287
BEACH_DEPTH   = 90      sand south of the last road
```

Road line `col` sits at `x = (col - 3) * 82`, so the grid is centred on the
origin. A block between columns `c` and `c+1` spans
`x ∈ [centre(c) + 8, centre(c+1) - 8]`.

The whole city therefore occupies **574 × 574 m** of drivable space, with a
beachfront and an ocean beyond the southern edge.

## Districts

`districtOf(col, row)` assigns each of the 36 blocks:

```
col <= 1                  → industrial   (warehouses, shipping containers)
row >= 5                  → beach        (resorts, sand, palms)
col >= 5                  → suburb       (houses, lawns, trees)
row <= 1                  → uptown       (mid-rise)
otherwise                 → downtown     (towers)
```

Each district changes the building palette, the facade material, the ground
texture and the height range, so the city reads as different neighbourhoods
rather than one repeated block.

## Building generation

For each block, `buildingsForBlock()` subdivides the **lot** rectangle (the
block minus the pavement ring) into slots and places buildings in them:

| District | Slots | Footprint | Height | Extras |
| --- | --- | --- | --- | --- |
| downtown | 1–2 | 72–96 % of slot | 34–88 m | 55 % get a podium (lower wider base + setback tower) |
| uptown | 2×2, keep 2–3 | 70–95 % | 14–36 m | occasional podium |
| industrial | 1 | 80–98 % | 8–16 m | 2–5 stacked shipping containers as obstacles |
| suburb | 2×2 | 60–85 % | 5–9 m | — |
| beach | 1–2 | 70–95 % | 7–17 m | — |

Two blocks are parks (`2,1` and `4,3`) and one is the landmark tower (`3,2`,
a 132 m tower with a 34 m mast).

Every building contributes an axis-aligned box to the collision world, so the
buildings you cannot walk through and the buildings you can see are the same
data.

### Facades

Facades are drawn on a 256×256 canvas as a 4×4 grid of window bays, with the
ground floor rendered as a shopfront. Two textures are produced per facade
kind:

- `map` — the albedo
- `emissiveMap` — only the lit windows and shopfronts, used at night

The facade texture repeats every **10 world units** (`FACADE_TILE`), so one
tile is four floors of 2.5 m and four window bays of 2.5 m. Box UVs are
remapped in `remapBoxUVs()` so that pattern is world-aligned rather than
per-face, and roof faces sample a flat patch in the corner of the texture.

Per-building colour comes from **vertex colours** multiplied over the shared
facade texture, which means every building in a district can have its own
tint while the whole district still renders in one draw call.

### Building geometry

Buildings are `THREE.BoxGeometry` instances, translated, UV-remapped and
colour-tagged, then merged per facade kind with `mergeGeometries`. The result:
the entire skyline of a district is one mesh and one draw call.

Roof clutter (AC units, water tanks, the landmark mast) is merged into a
separate vertex-coloured mesh.

## Ground surfaces

Layers are stacked in Y so nothing z-fights:

| Layer | Y | Texture |
| --- | --- | --- |
| Ocean | −0.6 | animated water |
| Land / base ground | 0 | concrete, tiled every 22 m |
| Roads | 0.02 | asphalt with lane markings |
| Intersection patches | 0.035 | plain asphalt (no markings) |
| Sidewalk pads | 0.025 | concrete slabs |
| Lot pads | 0.04 | district material (concrete / gravel / grass / sand) |
| Road markings | 0.05 | flat white quads |

Horizontal geometry is built by `makeRectXZ()` and `makeStripXZ()` in
`GeoUtil.ts`. **The winding order matters**: the vertices are laid out
counter-clockwise seen from above so the face normal points up. An earlier
version had them clockwise, which back-face culled every road, sidewalk and
ground quad — the city rendered as the ocean plane seen from underneath.

`makeStripXZ()` exists because the road texture needs `u` across the width and
`v` along the length at 16 m per tile (two dash periods of 8 m).

## Road network

`RoadNetwork` is a graph of intersections:

- **nodes** — one per (col, row) intersection, with `signalOffset` so
  neighbouring lights are not in lockstep
- **edges** — the road segments between adjacent nodes, each with a unit
  direction

Right-hand traffic: the lane centre for travel along direction `(dx, dz)` is
the edge midpoint offset by `right * LANE_OFFSET`, where
`right = (-dz, dx)` and `LANE_OFFSET = 4.2 m`.

### Traffic lights

`signalState(node, axis, time)` returns `green | yellow | red`:

- Each axis gets 11–17 seconds depending on district density, including
  a 2.4-second amber phase.
- `signalOffset` staggers lights across the road grid.

The same function drives the AI and the visible signal heads. Stop lines
sit in each inbound lane before the zebra crossing. Their offset is shared
by the road mesh and the AI braking logic.

## Props

`buildProps()` creates instanced meshes for:

- **Street lamps** — pole + arm + head, one per intersection corner (196),
  plus an emissive bulb and a soft additive pool of light on the ground
- **Traffic signals** — pole, arm and housing per intersection (49), with three
  bulbs each whose colours are updated from the signal state
- **Palms and trees** — placed on the beach, in the suburbs, along the
  boulevard and the beachfront avenue
- **Benches, hydrants, bins** — scattered along the pavements
- **Billboards** — 14 roadside panels with generated advertising art
- **Neon signs** — vibrant emissive signage across building facades in downtown, uptown, and the beach strip with dynamic night brightness modulation
- **Ocean surface** — animated UV wave drift with tropical turquoise shading

Everything that repeats is an `InstancedMesh`; a prop that appears N times
costs one draw call, not N.

## Determinism

The city, the props, the pedestrian spawn points and the traffic spawn points
are all generated from fixed seeds:

| Seed | Consumer |
| --- | --- |
| `20261113` | `buildCity()` — blocks, buildings, colours |
| `5150` | `buildProps()` — prop placement |
| `31337` | `PedManager` — pedestrian population |
| `9182736` | `TrafficManager` — traffic and police spawns |
| `4242` | `Game` — pickups and mission target vehicles |

The same build always produces the same city, which is what makes the
screenshot tour and the headless tests reproducible.

## Street-level detail

Buildings have ground-floor door panels, frames, centre mullions and projecting
canopies. Industrial entrances use taller, wider doors. These details share the
existing merged vertex-colour mesh. Low concrete curb strips outline blocks
with gaps at intersection corners and cost one additional draw call.
