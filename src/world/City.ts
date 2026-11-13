import * as THREE from 'three';
import { CollisionWorld, type ColliderBox } from '../systems/Collision';
import { rngFrom, type Rng } from '../core/MathUtil';
import {
  asphaltTexture,
  facadeTextures,
  lotTexture,
  roadTexture,
  sidewalkTexture,
  waterTexture,
  type FacadeKind,
  type LotKind,
} from '../core/Textures';
import {
  HALF_X,
  HALF_Z,
  BEACH_DEPTH,
  ROAD_WIDTH,
  LANE_OFFSET,
  STOP_LINE_OFFSET,
  SIDEWALK_WIDTH,
  buildBlocks,
  roadCenterX,
  roadCenterZ,
  RoadNetwork,
  type Block,
  type District,
} from './Layout';
import { applyColor, makeColoredBox, makeRectXZ, makeStripXZ, mergeAll, remapBoxUVs } from './GeoUtil';

export interface CitySpawn {
  x: number;
  z: number;
  yaw: number;
}

export interface City {
  group: THREE.Group;
  collision: CollisionWorld;
  blocks: Block[];
  roads: RoadNetwork;
  carSpawns: CitySpawn[];
  pedSpawns: CitySpawn[];
  facadeMaterials: THREE.MeshStandardMaterial[];
  /** Road and intersection materials: Game wets them at night. */
  roadMaterials: THREE.MeshStandardMaterial[];
  neonMaterials: THREE.MeshStandardMaterial[];
  water: THREE.Mesh;
  waterTexture: THREE.Texture;
  parkSpots: THREE.Vector3[];
}

interface BuildingSpec {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  podium: number;
  facade: FacadeKind;
  color: THREE.Color;
  district: District;
}

const DISTRICT_COLORS: Record<District, string[]> = {
  downtown: ['#dfe7f2', '#9fc4e0', '#f0d7c4', '#7fa3c4', '#c8d2dc', '#e8d9c6', '#b9a7d6'],
  uptown: ['#e8d3b0', '#d6bd9c', '#f0e0bd', '#c9b79a', '#dcc8dc', '#e3c4a8'],
  industrial: ['#a55f4c', '#8c7a6a', '#a89b8a', '#7f7a72', '#b5735a'],
  suburb: ['#f0e4c8', '#e8d2b0', '#d6e6d8', '#f6ead0', '#eed4c6', '#cfe0e4'],
  beach: ['#ffb0cc', '#ffdfb0', '#9deade', '#fff3cc', '#c6dcff', '#ffb9a0'],
};

const DISTRICT_FACADE: Record<District, FacadeKind[]> = {
  downtown: ['glass', 'glass', 'concrete', 'stucco'],
  uptown: ['concrete', 'stucco', 'brick'],
  industrial: ['brick', 'concrete'],
  suburb: ['stucco', 'stucco', 'concrete'],
  beach: ['stucco', 'concrete', 'glass'],
};

const FACADE_TILE = 10; // world units covered by one facade texture tile
const DISTRICT_LOT: Record<District, LotKind> = {
  downtown: 'concrete',
  uptown: 'concrete',
  industrial: 'gravel',
  suburb: 'grass',
  beach: 'sand',
};

/** Blocks that are special: parks and hand-placed landmarks. */
const PARK_BLOCKS = new Set(['2,1', '4,3']);
const LANDMARKS = new Set(['3,2']);

interface Slot {
  x: number;
  z: number;
  w: number;
  d: number;
}

function subdivide(block: Block, cols: number, rows: number, margin: number): Slot[] {
  const slots: Slot[] = [];
  const w = (block.lotMaxX - block.lotMinX) / cols;
  const d = (block.lotMaxZ - block.lotMinZ) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = block.lotMinX + w * (c + 0.5);
      const z = block.lotMinZ + d * (r + 0.5);
      slots.push({ x, z, w: Math.max(6, w - margin * 2), d: Math.max(6, d - margin * 2) });
    }
  }
  return slots;
}

function buildingsForBlock(block: Block, rng: Rng): BuildingSpec[] {
  const key = `${block.col},${block.row}`;
  if (PARK_BLOCKS.has(key)) return [];

  const colors = DISTRICT_COLORS[block.district];
  const facades = DISTRICT_FACADE[block.district];
  const pickFacade = (): FacadeKind => facades[rng.int(0, facades.length - 1)];
  const pickColor = (): THREE.Color => new THREE.Color(colors[rng.int(0, colors.length - 1)]);
  const specs: BuildingSpec[] = [];

  if (LANDMARKS.has(key)) {
    // The landmark tower: a single supertall with a podium.
    specs.push({
      x: block.cx,
      z: block.cz,
      w: 30,
      d: 30,
      h: 132,
      podium: 14,
      facade: 'glass',
      color: new THREE.Color('#8fb6d8'),
      district: block.district,
    });
    return specs;
  }

  switch (block.district) {
    case 'downtown': {
      const slots = subdivide(block, rng.chance(0.35) ? 2 : 1, 1, 5);
      for (const slot of slots) {
        if (slots.length > 1 && rng.chance(0.25)) continue;
        const scale = rng.range(0.72, 0.96);
        specs.push({
          x: slot.x,
          z: slot.z,
          w: slot.w * scale,
          d: slot.d * scale,
          h: rng.range(34, 88),
          podium: rng.chance(0.55) ? rng.range(6, 14) : 0,
          facade: pickFacade(),
          color: pickColor(),
          district: block.district,
        });
      }
      break;
    }
    case 'uptown': {
      const slots = subdivide(block, 2, 2, 4);
      const keep = rng.int(2, 3);
      const order = slots.slice().sort(() => rng() - 0.5);
      for (let i = 0; i < keep; i++) {
        const slot = order[i];
        const scale = rng.range(0.7, 0.95);
        specs.push({
          x: slot.x,
          z: slot.z,
          w: slot.w * scale,
          d: slot.d * scale,
          h: rng.range(14, 36),
          podium: rng.chance(0.3) ? rng.range(3, 7) : 0,
          facade: pickFacade(),
          color: pickColor(),
          district: block.district,
        });
      }
      break;
    }
    case 'industrial': {
      const slots = subdivide(block, 1, 1, 8);
      const slot = slots[0];
      specs.push({
        x: slot.x,
        z: slot.z,
        w: slot.w * rng.range(0.8, 0.98),
        d: slot.d * rng.range(0.7, 0.95),
        h: rng.range(8, 16),
        podium: 0,
        facade: pickFacade(),
        color: pickColor(),
        district: block.district,
      });
      break;
    }
    case 'suburb': {
      const slots = subdivide(block, 2, 2, 6);
      for (const slot of slots) {
        if (rng.chance(0.12)) continue;
        const scale = rng.range(0.6, 0.85);
        specs.push({
          x: slot.x,
          z: slot.z,
          w: slot.w * scale,
          d: slot.d * scale,
          h: rng.range(5, 9),
          podium: 0,
          facade: pickFacade(),
          color: pickColor(),
          district: block.district,
        });
      }
      break;
    }
    case 'beach': {
      const slots = subdivide(block, rng.chance(0.5) ? 2 : 1, 1, 7);
      for (const slot of slots) {
        if (slots.length > 1 && rng.chance(0.3)) continue;
        const scale = rng.range(0.7, 0.95);
        specs.push({
          x: slot.x,
          z: slot.z,
          w: slot.w * scale,
          d: slot.d * scale,
          h: rng.range(7, 17),
          podium: rng.chance(0.35) ? rng.range(3, 5) : 0,
          facade: pickFacade(),
          color: pickColor(),
          district: block.district,
        });
      }
      break;
    }
  }

  return specs;
}

export function buildCity(seed = 20261113): City {
  const rng = rngFrom(seed);
  const group = new THREE.Group();
  group.name = 'city';

  const blocks = buildBlocks();
  const colliders: ColliderBox[] = [];
  const specs: BuildingSpec[] = [];
  const containerBoxes: { x: number; z: number; w: number; d: number; h: number; color: THREE.Color }[] = [];

  for (const block of blocks) {
    for (const spec of buildingsForBlock(block, rng)) specs.push(spec);

    // Industrial yards get stacked shipping containers (solid obstacles).
    if (block.district === 'industrial' && rng.chance(0.8)) {
      const count = rng.int(2, 5);
      for (let i = 0; i < count; i++) {
        const w = rng.chance(0.5) ? 12.2 : 6.1;
        const d = rng.chance(0.5) ? 2.9 : 6.1;
        const x = rng.range(block.lotMinX + 4, block.lotMaxX - 4);
        const z = rng.range(block.lotMinZ + 4, block.lotMaxZ - 4);
        const h = rng.chance(0.4) ? 5.2 : 2.6;
        const palette = ['#c2453b', '#3f7fbf', '#d9a441', '#4f9a5a', '#8e4f9e'];
        containerBoxes.push({ x, z, w, d, h, color: new THREE.Color(palette[rng.int(0, palette.length - 1)]) });
      }
    }
  }

  /* ─────────────── ground planes ─────────────── */

  const landMinX = -HALF_X - 46;
  const landMaxX = HALF_X + 46;
  const landMinZ = -HALF_Z - 46;
  const landMaxZ = HALF_Z + ROAD_WIDTH / 2 + BEACH_DEPTH;

  const groundTex = lotTexture('concrete', 71);
  groundTex.repeat.set((landMaxX - landMinX) / 22, (landMaxZ - landMinZ) / 22);
  const ground = new THREE.Mesh(
    makeRectXZ((landMinX + landMaxX) / 2, (landMinZ + landMaxZ) / 2, landMaxX - landMinX, landMaxZ - landMinZ, 0),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95, metalness: 0 }),
  );
  ground.receiveShadow = true;
  group.add(ground);

  // Beach strip to the south.
  const beachDepth = landMaxZ - (HALF_Z + ROAD_WIDTH / 2);
  const beachTex = lotTexture('sand', 83);
  beachTex.repeat.set((landMaxX - landMinX) / 26, beachDepth / 26);
  const beach = new THREE.Mesh(
    makeRectXZ((landMinX + landMaxX) / 2, HALF_Z + ROAD_WIDTH / 2 + beachDepth / 2, landMaxX - landMinX, beachDepth, 0.01),
    new THREE.MeshStandardMaterial({ map: beachTex, roughness: 1, metalness: 0 }),
  );
  beach.receiveShadow = true;
  group.add(beach);

  // Shore edges on the other three sides.
  const shore = lotTexture('sand', 97);
  shore.repeat.set(20, 4);
  const shoreW = 26;
  const shoreGeos = [
    makeRectXZ((landMinX + landMaxX) / 2, landMinZ + shoreW / 2, landMaxX - landMinX, shoreW, 0.01),
    makeRectXZ(landMinX + shoreW / 2, (landMinZ + HALF_Z) / 2, shoreW, HALF_Z - landMinZ, 0.01),
    makeRectXZ(landMaxX - shoreW / 2, (landMinZ + HALF_Z) / 2, shoreW, HALF_Z - landMinZ, 0.01),
  ];
  const shoreMesh = new THREE.Mesh(
    mergeAll(shoreGeos)!,
    new THREE.MeshStandardMaterial({ map: shore, roughness: 1, metalness: 0 }),
  );
  shoreMesh.receiveShadow = true;
  group.add(shoreMesh);

  /* ─────────────── roads ─────────────── */

  const roadTex = roadTexture();
  const asphaltTex = asphaltTexture();
  const roadGeos: THREE.BufferGeometry[] = [];
  const asphaltGeos: THREE.BufferGeometry[] = [];

  const spanX = HALF_X * 2 + ROAD_WIDTH;

  // Horizontal roads run edge to edge; vertical roads are cut between
  // intersections so the two never overlap (no z-fighting).
  for (let row = 0; row < 7; row++) {
    const z = roadCenterZ(row);
    roadGeos.push(makeStripXZ(-spanX / 2, z, spanX / 2, z, ROAD_WIDTH, 0.02, 1 / 16));
  }
  for (let col = 0; col < 7; col++) {
    const x = roadCenterX(col);
    for (let row = 0; row < 6; row++) {
      const z0 = roadCenterZ(row) + ROAD_WIDTH / 2;
      const z1 = roadCenterZ(row + 1) - ROAD_WIDTH / 2;
      roadGeos.push(makeStripXZ(x, z0, x, z1, ROAD_WIDTH, 0.02, 1 / 16));
    }
  }

  // Intersection patches.
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 7; col++) {
      asphaltGeos.push(
        makeRectXZ(roadCenterX(col), roadCenterZ(row), ROAD_WIDTH, ROAD_WIDTH, 0.035, 1, 1),
      );
    }
  }

  const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.88, metalness: 0.02 });
  const roadMesh = new THREE.Mesh(mergeAll(roadGeos)!, roadMat);
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  const asphaltMat = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.9, metalness: 0.02 });
  const asphaltMesh = new THREE.Mesh(mergeAll(asphaltGeos)!, asphaltMat);
  asphaltMesh.receiveShadow = true;
  group.add(asphaltMesh);

  /* ─────────────── sidewalks and lots ─────────────── */

  const walkTex = sidewalkTexture();
  const walkGeos: THREE.BufferGeometry[] = [];
  const curbGeos: THREE.BufferGeometry[] = [];
  const curbColor = new THREE.Color('#b7afa0');
  const lotGeos = new Map<LotKind, THREE.BufferGeometry[]>();
  for (const block of blocks) {
    walkGeos.push(
      makeRectXZ(block.cx, block.cz, block.maxX - block.minX, block.maxZ - block.minZ, 0.025, 16, 16),
    );
    // Leave the intersection corners clear for pedestrian crossings.
    for (const side of [-1, 1]) {
      curbGeos.push(makeColoredBox(block.maxX - block.minX - 10, 0.12, 0.22,
        block.cx, 0.06, block.cz + side * (block.maxZ - block.minZ) / 2, curbColor));
      curbGeos.push(makeColoredBox(0.22, 0.12, block.maxZ - block.minZ - 10,
        block.cx + side * (block.maxX - block.minX) / 2, 0.06, block.cz, curbColor));
    }
    const kind = DISTRICT_LOT[block.district];
    if (!lotGeos.has(kind)) lotGeos.set(kind, []);
    lotGeos.get(kind)!.push(
      makeRectXZ(
        block.cx,
        block.cz,
        block.lotMaxX - block.lotMinX,
        block.lotMaxZ - block.lotMinZ,
        0.04,
        12,
        12,
      ),
    );
  }

  const walkMat = new THREE.MeshStandardMaterial({ map: walkTex, roughness: 0.94, metalness: 0 });
  const walkMesh = new THREE.Mesh(mergeAll(walkGeos)!, walkMat);
  walkMesh.receiveShadow = true;
  group.add(walkMesh);
  const curbs = new THREE.Mesh(mergeAll(curbGeos)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  curbs.receiveShadow = true;
  group.add(curbs);

  for (const [kind, geos] of lotGeos) {
    const tex = lotTexture(kind, kind.length * 13);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.98, metalness: 0 });
    const mesh = new THREE.Mesh(mergeAll(geos)!, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  /* ─────────────── road markings ─────────────── */

  const markGeos: THREE.BufferGeometry[] = [];
  const white = new THREE.Color('#cfccc0');
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 7; col++) {
      const x = roadCenterX(col);
      const z = roadCenterZ(row);
      const crossing = ROAD_WIDTH / 2 + 4;
      for (const side of [-1, 1]) {
        // Stripes run in the direction of travel, repeated across the carriageway.
        for (let stripe = -5; stripe <= 5; stripe++) {
          const across = stripe * 1.25;
          markGeos.push(makeRectXZ(x + side * crossing, z + across, 3.2, 0.65, 0.05));
          markGeos.push(makeRectXZ(x + across, z + side * crossing, 0.65, 3.2, 0.05));
        }
        markGeos.push(makeRectXZ(x + side * STOP_LINE_OFFSET, z - side * LANE_OFFSET, 0.42, 6.8, 0.05));
        markGeos.push(makeRectXZ(x + side * LANE_OFFSET, z + side * STOP_LINE_OFFSET, 6.8, 0.42, 0.05));
      }
    }
  }
  const markMesh = new THREE.Mesh(
    mergeAll(markGeos)!,
    new THREE.MeshStandardMaterial({ color: white, roughness: 0.7, metalness: 0 }),
  );
  markMesh.receiveShadow = true;
  group.add(markMesh);

  /* ─────────────── buildings ─────────────── */

  const facadeBuckets = new Map<FacadeKind, THREE.BufferGeometry[]>();
  const roofPropGeos: THREE.BufferGeometry[] = [];
  let entranceCount = 0;
  const roofPropColor = new THREE.Color('#8b8f95');

  for (const spec of specs) {
    const podiumH = spec.podium;
    const towerH = spec.h - podiumH;

    if (podiumH > 0) {
      const podium = new THREE.BoxGeometry(spec.w, podiumH, spec.d);
      podium.translate(spec.x, podiumH / 2, spec.z);
      remapBoxUVs(podium, FACADE_TILE, rng.range(0, 0.5));
      applyColor(podium, spec.color);
      pushBucket(facadeBuckets, spec.facade, podium);

      const tower = new THREE.BoxGeometry(spec.w * 0.72, towerH, spec.d * 0.72);
      tower.translate(spec.x, podiumH + towerH / 2, spec.z);
      remapBoxUVs(tower, FACADE_TILE, rng.range(0, 0.5));
      applyColor(tower, spec.color.clone().multiplyScalar(1.04));
      pushBucket(facadeBuckets, spec.facade, tower);

      colliders.push({
        minX: spec.x - spec.w / 2,
        maxX: spec.x + spec.w / 2,
        minZ: spec.z - spec.d / 2,
        maxZ: spec.z + spec.d / 2,
        height: spec.h,
      });
    } else {
      const box = new THREE.BoxGeometry(spec.w, spec.h, spec.d);
      box.translate(spec.x, spec.h / 2, spec.z);
      remapBoxUVs(box, FACADE_TILE, rng.range(0, 0.5));
      applyColor(box, spec.color);
      pushBucket(facadeBuckets, spec.facade, box);

      colliders.push({
        minX: spec.x - spec.w / 2,
        maxX: spec.x + spec.w / 2,
        minZ: spec.z - spec.d / 2,
        maxZ: spec.z + spec.d / 2,
        height: spec.h,
      });
    }

    // Ground-floor doors and canopies give the facade a human scale.
    const frontZ = spec.z + spec.d / 2;
    const doorWidth = spec.district === 'industrial' ? 4.2 : 1.8;
    const doorHeight = spec.district === 'industrial' ? 3.5 : 2.6;
    const trim = new THREE.Color('#d5c8ad');
    const glass = new THREE.Color('#22343e');
    roofPropGeos.push(makeColoredBox(doorWidth + 0.4, doorHeight + 0.25, 0.14,
      spec.x, (doorHeight + 0.25) / 2, frontZ + 0.03, trim));
    roofPropGeos.push(makeColoredBox(doorWidth, doorHeight, 0.16,
      spec.x, doorHeight / 2, frontZ + 0.07, glass));
    roofPropGeos.push(makeColoredBox(0.06, doorHeight, 0.18,
      spec.x, doorHeight / 2, frontZ + 0.09, trim));
    roofPropGeos.push(makeColoredBox(doorWidth + 1.2, 0.18, 1.1,
      spec.x, doorHeight + 0.45, frontZ + 0.45, spec.color.clone().multiplyScalar(0.65)));
    entranceCount++;

    // Roof clutter.
    if (spec.h > 12 && rng.chance(0.75)) {
      const n = rng.int(1, 3);
      for (let i = 0; i < n; i++) {
        const w = rng.range(2.5, 6);
        const d = rng.range(2.5, 6);
        const h = rng.range(1.4, 3.2);
        const px = spec.x + rng.range(-spec.w * 0.28, spec.w * 0.28);
        const pz = spec.z + rng.range(-spec.d * 0.28, spec.d * 0.28);
        roofPropGeos.push(makeColoredBox(w, h, d, px, spec.h + h / 2, pz, roofPropColor));
      }
    }
    // Antenna on the landmark tower.
    if (spec.h > 120) {
      roofPropGeos.push(makeColoredBox(1.2, 34, 1.2, spec.x, spec.h + 17, spec.z, new THREE.Color('#d0d4d8')));
      roofPropGeos.push(
        makeColoredBox(9, 1.1, 9, spec.x, spec.h + 0.55, spec.z, new THREE.Color('#c2c6ca')),
      );
    }
  }

  // Shipping containers as obstacles.
  for (const c of containerBoxes) {
    const stack = c.h > 4 ? 2 : 1;
    for (let s = 0; s < stack; s++) {
      const geo = makeColoredBox(c.w, c.h / stack, c.d, c.x, (c.h / stack) * (s + 0.5), c.z, c.color);
      roofPropGeos.push(geo);
    }
    colliders.push({
      minX: c.x - c.w / 2,
      maxX: c.x + c.w / 2,
      minZ: c.z - c.d / 2,
      maxZ: c.z + c.d / 2,
      height: c.h,
    });
  }

  const facadeMaterials: THREE.MeshStandardMaterial[] = [];
  for (const [kind, geos] of facadeBuckets) {
    const { map, emissiveMap } = facadeTextures(kind);
    const mat = new THREE.MeshStandardMaterial({
      map,
      emissiveMap,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0,
      vertexColors: true,
      roughness: 0.72,
      metalness: kind === 'glass' ? 0.32 : 0.06,
    });
    const mesh = new THREE.Mesh(mergeAll(geos)!, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    facadeMaterials.push(mat);
  }

  if (roofPropGeos.length > 0) {
    const roofMesh = new THREE.Mesh(
      mergeAll(roofPropGeos)!,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.08 }),
    );
    roofMesh.castShadow = true;
    roofMesh.receiveShadow = true;
    roofMesh.userData.entrances = entranceCount;
    group.add(roofMesh);
  }

  /* ─────────────── neon signs ─────────────── */

  const neonMaterials: THREE.MeshStandardMaterial[] = [];
  const NEON_PALETTE = ['#ff2e88', '#35e0ff', '#ffd45e', '#58f5b5', '#c77dff'];

  for (const spec of specs) {
    if (spec.district !== 'downtown' && spec.district !== 'uptown' && spec.district !== 'beach') {
      continue;
    }
    // Place 1-2 neon signs on facade walls for ~50% of buildings in downtown, uptown, and beach.
    if (!rng.chance(0.5)) continue;

    const signCount = rng.int(1, 2);
    const wall1 = rng.int(0, 3);
    const wall2 = (wall1 + rng.int(1, 3)) % 4;
    const chosenWalls = signCount === 1 ? [wall1] : [wall1, wall2];

    for (let i = 0; i < chosenWalls.length; i++) {
      const wall = chosenWalls[i];
      let signY: number;
      if (spec.district === 'beach') {
        signY = i === 0
          ? rng.range(3.2, Math.max(3.5, spec.h * 0.48))
          : rng.range(Math.max(3.6, spec.h * 0.5), Math.max(3.8, spec.h - 1.5));
      } else if (spec.district === 'uptown') {
        signY = rng.range(3.5, Math.min(16, spec.h - 2.5));
      } else {
        // downtown
        signY = rng.range(4.5, Math.min(26, spec.h - 4.0));
      }

      const isUpper = spec.podium > 0 && signY > spec.podium;
      const halfW = isUpper ? (spec.w * 0.72) / 2 : spec.w / 2;
      const halfD = isUpper ? (spec.d * 0.72) / 2 : spec.d / 2;

      const spanHalf = (wall === 0 || wall === 1) ? halfW : halfD;
      const maxSpan = spanHalf * 2;
      const signW = Math.max(2.0, Math.min(4.5, maxSpan * 0.8));
      const signH = 1.4;

      const colorHex = NEON_PALETTE[rng.int(0, NEON_PALETTE.length - 1)];
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(colorHex),
        emissive: new THREE.Color(colorHex),
        emissiveIntensity: 2.0,
        roughness: 0.25,
        metalness: 0.1,
        side: THREE.DoubleSide,
      });
      neonMaterials.push(mat);

      const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(signW, signH), mat);
      const maxShift = Math.max(0, (spanHalf - signW / 2) * 0.7);
      const shift = rng.range(-maxShift, maxShift);
      const eps = 0.08;

      if (wall === 0) {
        // South (+Z)
        signMesh.position.set(spec.x + shift, signY, spec.z + halfD + eps);
        signMesh.rotation.y = 0;
      } else if (wall === 1) {
        // North (-Z)
        signMesh.position.set(spec.x + shift, signY, spec.z - halfD - eps);
        signMesh.rotation.y = Math.PI;
      } else if (wall === 2) {
        // East (+X)
        signMesh.position.set(spec.x + halfW + eps, signY, spec.z + shift);
        signMesh.rotation.y = Math.PI / 2;
      } else {
        // West (-X)
        signMesh.position.set(spec.x - halfW - eps, signY, spec.z + shift);
        signMesh.rotation.y = -Math.PI / 2;
      }

      signMesh.receiveShadow = false;
      signMesh.castShadow = false;
      group.add(signMesh);
    }
  }

  /* ─────────────── ocean ─────────────── */

  const wTex = waterTexture();
  wTex.repeat.set(60, 60);
  const waterMat = new THREE.MeshStandardMaterial({
    map: wTex,
    color: new THREE.Color(0x006e90),
    emissive: new THREE.Color(0x001f35),
    emissiveIntensity: 0.35,
    roughness: 0.18,
    metalness: 0.55,
    transparent: true,
    opacity: 0.92,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(4200, 4200), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.6;
  water.receiveShadow = false;
  group.add(water);

  /* ─────────────── collision world ─────────────── */

  const collision = new CollisionWorld(colliders);

  /* ─────────────── spawn points ─────────────── */

  const carSpawns: CitySpawn[] = [];
  const pedSpawns: CitySpawn[] = [];

  for (let row = 0; row < 7; row++) {
    const z = roadCenterZ(row);
    for (let x = -HALF_X + 24; x < HALF_X - 24; x += 13) {
      let nearIntersection = false;
      for (let col = 0; col < 7; col++) {
        if (Math.abs(x - roadCenterX(col)) < 16) nearIntersection = true;
      }
      if (nearIntersection) continue;
      const side = ((x / 13) | 0) % 2 === 0 ? 1 : -1;
      carSpawns.push({ x, z: z + side * 5.7, yaw: side > 0 ? 0 : Math.PI });
    }
  }
  for (let col = 0; col < 7; col++) {
    const x = roadCenterX(col);
    for (let z = -HALF_Z + 24; z < HALF_Z - 24; z += 13) {
      let nearIntersection = false;
      for (let row = 0; row < 7; row++) {
        if (Math.abs(z - roadCenterZ(row)) < 16) nearIntersection = true;
      }
      if (nearIntersection) continue;
      const side = ((z / 13) | 0) % 2 === 0 ? 1 : -1;
      carSpawns.push({ x: x + side * 5.7, z, yaw: side > 0 ? Math.PI / 2 : -Math.PI / 2 });
    }
  }

  for (const block of blocks) {
    const perim: CitySpawn[] = [];
    const stepX = (block.maxX - block.minX) / 5;
    const stepZ = (block.maxZ - block.minZ) / 5;
    const inset = SIDEWALK_WIDTH / 2;
    for (let i = 0; i < 5; i++) {
      const px = block.minX + inset + stepX * (i + 0.5);
      perim.push({ x: px, z: block.minZ + inset, yaw: 0 });
      perim.push({ x: px, z: block.maxZ - inset, yaw: Math.PI });
      const pz = block.minZ + inset + stepZ * (i + 0.5);
      perim.push({ x: block.minX + inset, z: pz, yaw: Math.PI / 2 });
      perim.push({ x: block.maxX - inset, z: pz, yaw: -Math.PI / 2 });
    }
    pedSpawns.push(...perim);
  }

  const parkSpots: THREE.Vector3[] = [];
  for (const block of blocks) {
    if (block.district === 'suburb') {
      parkSpots.push(new THREE.Vector3(block.cx, 0, block.cz));
    }
  }

  return {
    group,
    collision,
    blocks,
    roads: new RoadNetwork(),
    carSpawns,
    pedSpawns,
    facadeMaterials,
    roadMaterials: [roadMat, asphaltMat],
    neonMaterials,
    water,
    waterTexture: wTex,
    parkSpots,
  };
}

function pushBucket(map: Map<FacadeKind, THREE.BufferGeometry[]>, kind: FacadeKind, geo: THREE.BufferGeometry): void {
  let list = map.get(kind);
  if (!list) {
    list = [];
    map.set(kind, list);
  }
  list.push(geo);
}
