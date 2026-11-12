import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rngFrom } from '../core/MathUtil';
import { billboardTexture, radialSprite } from '../core/Textures';
import { HALF_X, HALF_Z, ROAD_WIDTH, roadCenterX, roadCenterZ } from './Layout';
import type { City } from './City';
import { applyColor, makeColoredBox, mergeAll } from './GeoUtil';

const COLS = 7;
const ROWS = 7;

/**
 * Street furniture. Everything repeated is drawn with instanced meshes so the
 * whole city fits in a handful of draw calls.
 */
export interface Props {
  group: THREE.Group;
  /** Update the traffic light colours; call with the current time. */
  updateSignals(time: number): void;
  /** Fade the street lighting in and out with the time of day. */
  setNight(night: number): void;
  dispose(): void;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, color: string): THREE.BufferGeometry {
  return makeColoredBox(w, h, d, x, y, z, new THREE.Color(color));
}

function cylinder(rt: number, rb: number, h: number, seg: number, x: number, y: number, z: number, color: string): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(rt, rb, h, seg);
  geo.translate(x, y, z);
  applyColor(geo, new THREE.Color(color));
  return geo;
}

function makeStreetLamp(): THREE.BufferGeometry {
  const parts = [
    cylinder(0.12, 0.16, 7.2, 8, 0, 3.6, 0, '#4a4f57'),
    box(0.16, 0.16, 2.3, 0, 7.1, 1.15, '#4a4f57'),
    box(0.7, 0.22, 1.0, 0, 6.95, 2.2, '#5b6169'),
  ];
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return merged;
}

function makePalm(): THREE.BufferGeometry {
  const parts = [
    cylinder(0.22, 0.34, 8.4, 7, 0, 4.2, 0, '#8a6a45'),
    cylinder(0.16, 0.22, 1.6, 6, 0, 8.6, 0, '#7d5f3d'),
  ];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const frond = new THREE.ConeGeometry(0.55, 4.2, 4);
    frond.rotateZ(Math.PI / 2 - 0.55);
    frond.translate(1.9, 9.1, 0);
    frond.rotateY(a);
    applyColor(frond, new THREE.Color('#3f7a3c'));
    parts.push(frond);
  }
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return merged;
}

function makeTree(): THREE.BufferGeometry {
  const canopy = new THREE.SphereGeometry(2.3, 8, 6);
  canopy.translate(0, 5.1, 0);
  applyColor(canopy, new THREE.Color('#3f6b39'));
  const parts = [
    cylinder(0.28, 0.38, 3.4, 7, 0, 1.7, 0, '#6b4c33'),
    canopy,
  ];
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return merged;
}

function makeTrafficPole(): THREE.BufferGeometry {
  const parts = [
    cylinder(0.14, 0.18, 6.2, 8, 0, 3.1, 0, '#33383f'),
    box(0.5, 1.5, 0.5, 0, 5.9, 0, '#22262b'),
    box(0.16, 0.16, 2.4, 0, 6.4, -1.2, '#33383f'),
    box(0.42, 1.05, 0.42, 0, 5.95, -2.3, '#22262b'),
  ];
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return merged;
}

function makeBench(): THREE.BufferGeometry {
  const parts = [
    box(1.9, 0.12, 0.55, 0, 0.5, 0, '#9a6b3f'),
    box(1.9, 0.55, 0.1, 0, 0.85, -0.24, '#9a6b3f'),
    box(0.12, 0.5, 0.5, -0.8, 0.25, 0, '#3b4048'),
    box(0.12, 0.5, 0.5, 0.8, 0.25, 0, '#3b4048'),
  ];
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return merged;
}

function makeHydrant(): THREE.BufferGeometry {
  const parts = [
    cylinder(0.18, 0.2, 0.85, 8, 0, 0.45, 0, '#c8342b'),
    cylinder(0.1, 0.1, 0.5, 6, 0, 0.62, 0, '#c8342b'),
    box(0.5, 0.12, 0.12, 0, 0.55, 0, '#a92a22'),
  ];
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return merged;
}

function makeBin(): THREE.BufferGeometry {
  const parts = [
    cylinder(0.42, 0.36, 1.1, 10, 0, 0.55, 0, '#3d5a45'),
    cylinder(0.46, 0.46, 0.1, 10, 0, 1.15, 0, '#2c4233'),
  ];
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return merged;
}

export function buildProps(city: City, seed = 5150): Props {
  const group = new THREE.Group();
  group.name = 'props';
  const rng = rngFrom(seed);
  const disposables: THREE.BufferGeometry[] = [];

  const propMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.1 });

  /* ─────────────── street lamps ─────────────── */

  const lampPositions: THREE.Vector3[] = [];
  const lampGeo = makeStreetLamp();
  disposables.push(lampGeo);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x = roadCenterX(col);
      const z = roadCenterZ(row);
      const corners: [number, number][] = [
        [x + ROAD_WIDTH / 2 + 1.6, z + ROAD_WIDTH / 2 + 1.6],
        [x - ROAD_WIDTH / 2 - 1.6, z + ROAD_WIDTH / 2 + 1.6],
        [x + ROAD_WIDTH / 2 + 1.6, z - ROAD_WIDTH / 2 - 1.6],
        [x - ROAD_WIDTH / 2 - 1.6, z - ROAD_WIDTH / 2 - 1.6],
      ];
      const c = corners[(row + col) % 4];
      lampPositions.push(new THREE.Vector3(c[0], 0, c[1]));
    }
  }
  const lamps = new THREE.InstancedMesh(lampGeo, propMaterial, lampPositions.length);
  lamps.castShadow = false;
  lamps.receiveShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(1, 1, 1);
  lampPositions.forEach((p, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ((i % 4) * Math.PI) / 2 + Math.PI * 0.25);
    m.compose(p, q, s);
    lamps.setMatrixAt(i, m);
  });
  lamps.instanceMatrix.needsUpdate = true;
  group.add(lamps);

  // Lamp glow (emissive heads) that switches on at night.
  const glowGeo = new THREE.SphereGeometry(0.3, 8, 6);
  glowGeo.translate(0, 6.9, 2.2);
  disposables.push(glowGeo);
  const glowMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#ffe9b0'),
    emissive: new THREE.Color('#ffd489'),
    emissiveIntensity: 0,
    roughness: 0.4,
  });
  const glows = new THREE.InstancedMesh(glowGeo, glowMat, lampPositions.length);
  lampPositions.forEach((p, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ((i % 4) * Math.PI) / 2 + Math.PI * 0.25);
    m.compose(p, q, s);
    glows.setMatrixAt(i, m);
  });
  glows.instanceMatrix.needsUpdate = true;
  group.add(glows);

  // Pools of light on the ground under each lamp.
  const poolGeo = new THREE.CircleGeometry(4.6, 16);
  poolGeo.rotateX(-Math.PI / 2);
  poolGeo.translate(0, 0.06, 2.1);
  disposables.push(poolGeo);
  const poolMat = new THREE.MeshBasicMaterial({
    map: radialSprite('rgba(255,224,160,1)', 'rgba(255,190,90,0)'),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pools = new THREE.InstancedMesh(poolGeo, poolMat, lampPositions.length);
  lampPositions.forEach((p, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ((i % 4) * Math.PI) / 2 + Math.PI * 0.25);
    m.compose(p, q, s);
    pools.setMatrixAt(i, m);
  });
  pools.instanceMatrix.needsUpdate = true;
  pools.renderOrder = 2;
  group.add(pools);

  /* ─────────────── traffic lights ─────────────── */

  const poleGeo = makeTrafficPole();
  disposables.push(poleGeo);
  const signalSpots: { pos: THREE.Vector3; yaw: number; node: number }[] = [];
  const nodeIndex = (col: number, row: number) => row * COLS + col;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x = roadCenterX(col);
      const z = roadCenterZ(row);
      const yaw = ((row + col) % 2 === 0 ? 0 : Math.PI) + Math.PI;
      signalSpots.push({ pos: new THREE.Vector3(x + ROAD_WIDTH / 2 + 1.9, 0, z + ROAD_WIDTH / 2 + 1.9), yaw, node: nodeIndex(col, row) });
    }
  }
  const poles = new THREE.InstancedMesh(poleGeo, propMaterial, signalSpots.length);
  const unitScale = new THREE.Vector3(1, 1, 1);
  signalSpots.forEach((s, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
    m.compose(s.pos, q, unitScale);
    poles.setMatrixAt(i, m);
  });
  poles.instanceMatrix.needsUpdate = true;
  group.add(poles);

  // Three lamp bulbs per signal head, coloured per state.
  const bulbGeo = new THREE.SphereGeometry(0.17, 8, 6);
  disposables.push(bulbGeo);
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, signalSpots.length * 3);
  const bulbColor = new THREE.Color();
  signalSpots.forEach((s, i) => {
    for (let k = 0; k < 3; k++) {
      const local = new THREE.Vector3(0, 6.25 - k * 0.32, -2.42);
      local.applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
      const p = s.pos.clone().add(local);
      q.identity();
      m.compose(p, q, unitScale);
      bulbs.setMatrixAt(i * 3 + k, m);
      bulbs.setColorAt(i * 3 + k, bulbColor.setRGB(0.05, 0.05, 0.05));
    }
  });
  bulbs.instanceMatrix.needsUpdate = true;
  if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true;
  group.add(bulbs);

  /* ─────────────── vegetation ─────────────── */

  const palms: THREE.Vector3[] = [];
  const trees: THREE.Vector3[] = [];
  for (const block of city.blocks) {
    if (block.district === 'beach') {
      const count = 6;
      for (let i = 0; i < count; i++) {
        palms.push(
          new THREE.Vector3(
            block.minX + 3 + rng() * (block.maxX - block.minX - 6),
            0,
            block.minZ + 3 + rng() * (block.maxZ - block.minZ - 6),
          ),
        );
      }
    }
    if (block.district === 'suburb' || block.district === 'uptown') {
      const count = block.district === 'suburb' ? 7 : 3;
      for (let i = 0; i < count; i++) {
        trees.push(
          new THREE.Vector3(
            block.minX + 3 + rng() * (block.maxX - block.minX - 6),
            0,
            block.minZ + 3 + rng() * (block.maxZ - block.minZ - 6),
          ),
        );
      }
    }
  }
  // Palm avenue along the beachfront road.
  for (let x = -HALF_X + 10; x < HALF_X; x += 22) {
    palms.push(new THREE.Vector3(x, 0, roadCenterZ(ROWS - 1) + ROAD_WIDTH / 2 + 3.2));
  }
  // Boulevard trees on the central avenue.
  for (let z = -HALF_Z + 16; z < HALF_Z; z += 18) {
    trees.push(new THREE.Vector3(roadCenterX(3) + ROAD_WIDTH / 2 + 3.4, 0, z));
    trees.push(new THREE.Vector3(roadCenterX(3) - ROAD_WIDTH / 2 - 3.4, 0, z));
  }

  const palmGeo = makePalm();
  disposables.push(palmGeo);
  const palmMesh = new THREE.InstancedMesh(palmGeo, propMaterial, Math.max(1, palms.length));
  palms.forEach((p, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
    const sc = 0.8 + rng() * 0.5;
    m.compose(p, q, new THREE.Vector3(sc, sc, sc));
    palmMesh.setMatrixAt(i, m);
  });
  palmMesh.instanceMatrix.needsUpdate = true;
  palmMesh.castShadow = true;
  palmMesh.count = palms.length;
  group.add(palmMesh);

  const treeGeo = makeTree();
  disposables.push(treeGeo);
  const treeMesh = new THREE.InstancedMesh(treeGeo, propMaterial, Math.max(1, trees.length));
  trees.forEach((p, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
    const sc = 0.75 + rng() * 0.6;
    m.compose(p, q, new THREE.Vector3(sc, sc, sc));
    treeMesh.setMatrixAt(i, m);
  });
  treeMesh.instanceMatrix.needsUpdate = true;
  treeMesh.castShadow = true;
  treeMesh.count = trees.length;
  group.add(treeMesh);

  /* ─────────────── small furniture ─────────────── */

  const benches: THREE.Vector3[] = [];
  const hydrants: THREE.Vector3[] = [];
  const bins: THREE.Vector3[] = [];
  for (const block of city.blocks) {
    const edge = 2.6;
    for (let i = 0; i < 3; i++) {
      benches.push(
        new THREE.Vector3(
          block.minX + edge + rng() * (block.maxX - block.minX - edge * 2),
          0,
          block.minZ + edge,
        ),
      );
    }
    if (rng.chance(0.7)) {
      hydrants.push(
        new THREE.Vector3(
          block.maxX - edge,
          0,
          block.minZ + 6 + rng() * (block.maxZ - block.minZ - 12),
        ),
      );
    }
    if (rng.chance(0.6)) {
      bins.push(
        new THREE.Vector3(
          block.minX + edge,
          0,
          block.maxZ - edge - rng() * 6,
        ),
      );
    }
  }

  const benchGeo = makeBench();
  disposables.push(benchGeo);
  const benchMesh = new THREE.InstancedMesh(benchGeo, propMaterial, Math.max(1, benches.length));
  benches.forEach((p, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
    m.compose(p, q, s);
    benchMesh.setMatrixAt(i, m);
  });
  benchMesh.instanceMatrix.needsUpdate = true;
  benchMesh.count = benches.length;
  group.add(benchMesh);

  const hydrantGeo = makeHydrant();
  disposables.push(hydrantGeo);
  const hydrantMesh = new THREE.InstancedMesh(hydrantGeo, propMaterial, Math.max(1, hydrants.length));
  hydrants.forEach((p, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
    m.compose(p, q, s);
    hydrantMesh.setMatrixAt(i, m);
  });
  hydrantMesh.instanceMatrix.needsUpdate = true;
  hydrantMesh.count = hydrants.length;
  group.add(hydrantMesh);

  const binGeo = makeBin();
  disposables.push(binGeo);
  const binMesh = new THREE.InstancedMesh(binGeo, propMaterial, Math.max(1, bins.length));
  bins.forEach((p, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
    m.compose(p, q, s);
    binMesh.setMatrixAt(i, m);
  });
  binMesh.instanceMatrix.needsUpdate = true;
  binMesh.count = bins.length;
  group.add(binMesh);

  /* ─────────────── billboards ─────────────── */

  const billboardTex = billboardTexture();
  const billboardMat = new THREE.MeshStandardMaterial({
    map: billboardTex,
    emissiveMap: billboardTex,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0.25,
    roughness: 0.9,
  });
  const billboardPosts = mergeAll([
    box(0.5, 9, 0.5, -5.2, 4.5, 0, '#3b4048'),
    box(0.5, 9, 0.5, 5.2, 4.5, 0, '#3b4048'),
  ]);
  if (billboardPosts) disposables.push(billboardPosts);
  const billboardPanel = new THREE.PlaneGeometry(12, 6);
  disposables.push(billboardPanel);

  const billboardSpots: { x: number; z: number; yaw: number }[] = [];
  for (let i = 0; i < 14; i++) {
    const col = rng.int(0, COLS - 1);
    const row = rng.int(0, ROWS - 1);
    const x = roadCenterX(col) + (rng.chance(0.5) ? 1 : -1) * (ROAD_WIDTH / 2 + 9);
    const z = roadCenterZ(row) + rng.range(-30, 30);
    billboardSpots.push({ x, z, yaw: x > roadCenterX(col) ? -Math.PI / 2 : Math.PI / 2 });
  }
  for (const spot of billboardSpots) {
    const holder = new THREE.Group();
    holder.position.set(spot.x, 0, spot.z);
    holder.rotation.y = spot.yaw;
    const panel = new THREE.Mesh(billboardPanel, billboardMat);
    panel.position.set(0, 9.6, 0);
    holder.add(panel);
    const posts = new THREE.Mesh(billboardPosts!, propMaterial);
    holder.add(posts);
    group.add(holder);
  }

  /* ─────────────── signal state ─────────────── */

  const OFF = { r: 0.05, g: 0.05, b: 0.05 };
  const RED = { r: 1, g: 0.12, b: 0.12 };
  const YELLOW = { r: 1, g: 0.72, b: 0.08 };
  const GREEN = { r: 0.18, g: 1, b: 0.35 };

  const updateSignals = (time: number): void => {
    for (let i = 0; i < signalSpots.length; i++) {
      const spot = signalSpots[i];
      // Bulb 0 = red, 1 = amber, 2 = green. The head faces the x-axis approach.
      const state = city.roads.signalState(spot.node, 'x', time);
      const write = (k: number, c: { r: number; g: number; b: number }) => {
        bulbs.setColorAt(i * 3 + k, bulbColor.setRGB(c.r, c.g, c.b));
      };
      write(0, state === 'red' ? RED : OFF);
      write(1, state === 'yellow' ? YELLOW : OFF);
      write(2, state === 'green' ? GREEN : OFF);
    }
    if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true;
  };

  updateSignals(0);

  const setNight = (night: number): void => {
    glowMat.emissiveIntensity = night * 2.4;
    glowMat.opacity = 0.25 + night * 0.75;
    poolMat.opacity = night * 0.4;
    billboardMat.emissiveIntensity = 0.25 + night * 0.85;
  };

  return {
    group,
    updateSignals,
    setNight,
    dispose(): void {
      for (const g of disposables) g.dispose();
    },
  };
}
