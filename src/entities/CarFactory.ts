import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applyColor } from '../world/GeoUtil';

export type Livery = 'civil' | 'police' | 'taxi' | 'sport';

export interface CarSpec {
  id: string;
  label: string;
  length: number;
  width: number;
  bodyBottom: number;
  bodyHeight: number;
  cabinHeight: number;
  cabinLength: number;
  cabinWidth: number;
  cabinZ: number;
  wheelBase: number;
  track: number;
  wheelRadius: number;
  mass: number;
  power: number;
  topSpeed: number;
  grip: number;
  steering: number;
}

export const CAR_SPECS: Record<string, CarSpec> = {
  sedan: {
    id: 'sedan',
    label: 'SEDAN',
    length: 4.5,
    width: 1.86,
    bodyBottom: 0.34,
    bodyHeight: 0.72,
    cabinHeight: 0.62,
    cabinLength: 2.1,
    cabinWidth: 1.66,
    cabinZ: -0.1,
    wheelBase: 2.8,
    track: 1.56,
    wheelRadius: 0.35,
    mass: 1300,
    power: 12,
    topSpeed: 43,
    grip: 11,
    steering: 1.75,
  },
  coupe: {
    id: 'coupe',
    label: 'COUPE',
    length: 4.35,
    width: 1.82,
    bodyBottom: 0.3,
    bodyHeight: 0.62,
    cabinHeight: 0.56,
    cabinLength: 1.9,
    cabinWidth: 1.62,
    cabinZ: -0.24,
    wheelBase: 2.6,
    track: 1.54,
    wheelRadius: 0.34,
    mass: 1180,
    power: 15,
    topSpeed: 50,
    grip: 11.5,
    steering: 1.95,
  },
  suv: {
    id: 'suv',
    label: 'SUV',
    length: 4.9,
    width: 2.02,
    bodyBottom: 0.46,
    bodyHeight: 0.86,
    cabinHeight: 0.74,
    cabinLength: 2.7,
    cabinWidth: 1.86,
    cabinZ: -0.05,
    wheelBase: 3.0,
    track: 1.7,
    wheelRadius: 0.42,
    mass: 1750,
    power: 10.5,
    topSpeed: 38,
    grip: 9.5,
    steering: 1.5,
  },
  van: {
    id: 'van',
    label: 'VAN',
    length: 5.3,
    width: 2.06,
    bodyBottom: 0.44,
    bodyHeight: 1.2,
    cabinHeight: 0.6,
    cabinLength: 1.7,
    cabinWidth: 1.9,
    cabinZ: 1.35,
    wheelBase: 3.2,
    track: 1.72,
    wheelRadius: 0.4,
    mass: 1900,
    power: 8.5,
    topSpeed: 34,
    grip: 8.5,
    steering: 1.35,
  },
  pickup: {
    id: 'pickup',
    label: 'PICKUP',
    length: 5.2,
    width: 2.0,
    bodyBottom: 0.5,
    bodyHeight: 0.82,
    cabinHeight: 0.78,
    cabinLength: 1.8,
    cabinWidth: 1.8,
    cabinZ: 0.65,
    wheelBase: 3.1,
    track: 1.68,
    wheelRadius: 0.44,
    mass: 1650,
    power: 9.5,
    topSpeed: 36,
    grip: 8.8,
    steering: 1.45,
  },
  sports: {
    id: 'sports',
    label: 'SPORTS',
    length: 4.3,
    width: 1.94,
    bodyBottom: 0.26,
    bodyHeight: 0.5,
    cabinHeight: 0.44,
    cabinLength: 1.7,
    cabinWidth: 1.64,
    cabinZ: -0.3,
    wheelBase: 2.55,
    track: 1.64,
    wheelRadius: 0.34,
    mass: 1050,
    power: 19,
    topSpeed: 58,
    grip: 12.5,
    steering: 2.05,
  },
};

export const CIVIL_PAINT: string[] = [
  '#e23b3b',
  '#2f6fd0',
  '#e8e2d4',
  '#1e2126',
  '#f0a63c',
  '#3fae6a',
  '#8f4fd0',
  '#b9c0c7',
  '#d94f9a',
  '#2fb3c9',
  '#6a6f76',
  '#c7b299',
];

export const bodyMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.34,
  metalness: 0.55,
});

export const glassMaterial = new THREE.MeshStandardMaterial({
  color: 0x10161f,
  roughness: 0.12,
  metalness: 0.85,
  transparent: true,
  opacity: 0.82,
});

export const headlightMaterial = new THREE.MeshStandardMaterial({
  color: 0xfff4d0,
  emissive: 0xfff0c4,
  emissiveIntensity: 0.85,
  roughness: 0.3,
  toneMapped: false,
});

export const tailMaterial = new THREE.MeshStandardMaterial({
  color: 0xff2a35,
  emissive: 0xff1122,
  emissiveIntensity: 0.5,
  roughness: 0.4,
  toneMapped: false,
});

export const wheelMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.85,
  metalness: 0.15,
});

function boxGeo(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return merged;
}

/** Geometry shared by every car of a given spec (cloned per car). */
const baseCache = new Map<string, { body: THREE.BufferGeometry; glass: THREE.BufferGeometry; head: THREE.BufferGeometry; tail: THREE.BufferGeometry; wheel: THREE.BufferGeometry }>();

function baseFor(spec: CarSpec) {
  let cached = baseCache.get(spec.id);
  if (cached) return cached;

  const w = spec.width;
  const l = spec.length;
  const bodyY = spec.bodyBottom + spec.bodyHeight / 2;

  // Painted shell: lower body, hood, boot, cabin roof.
  const shell = mergeParts([
    boxGeo(w, spec.bodyHeight, l, 0, bodyY, 0),
    boxGeo(w * 0.97, spec.bodyHeight * 0.5, l * 0.3, 0, spec.bodyBottom + spec.bodyHeight * 0.82, l * 0.31),
    boxGeo(w * 0.97, spec.bodyHeight * 0.42, l * 0.24, 0, spec.bodyBottom + spec.bodyHeight * 0.76, -l * 0.35),
    boxGeo(spec.cabinWidth, spec.cabinHeight * 0.34, spec.cabinLength, 0, spec.bodyBottom + spec.bodyHeight + spec.cabinHeight * 0.33, spec.cabinZ),
  ]);

  // Glass band.
  const glass = mergeParts([
    boxGeo(
      spec.cabinWidth * 0.95,
      spec.cabinHeight * 0.72,
      spec.cabinLength * 0.94,
      0,
      spec.bodyBottom + spec.bodyHeight + spec.cabinHeight * 0.22,
      spec.cabinZ,
    ),
  ]);

  // Head lights.
  const head = mergeParts([
    boxGeo(0.42, 0.2, 0.12, w * 0.3, spec.bodyBottom + spec.bodyHeight * 0.66, l / 2 - 0.04),
    boxGeo(0.42, 0.2, 0.12, -w * 0.3, spec.bodyBottom + spec.bodyHeight * 0.66, l / 2 - 0.04),
  ]);

  // Tail lights.
  const tail = mergeParts([
    boxGeo(0.4, 0.18, 0.1, w * 0.31, spec.bodyBottom + spec.bodyHeight * 0.66, -l / 2 + 0.03),
    boxGeo(0.4, 0.18, 0.1, -w * 0.31, spec.bodyBottom + spec.bodyHeight * 0.66, -l / 2 + 0.03),
  ]);

  // Wheel: tyre + rim.
  const tyre = new THREE.CylinderGeometry(spec.wheelRadius, spec.wheelRadius, 0.26, 14);
  tyre.rotateZ(Math.PI / 2);
  applyColor(tyre, new THREE.Color('#141619'));
  const rim = new THREE.CylinderGeometry(spec.wheelRadius * 0.52, spec.wheelRadius * 0.52, 0.28, 12);
  rim.rotateZ(Math.PI / 2);
  applyColor(rim, new THREE.Color('#b9bfc6'));
  const wheel = mergeParts([tyre, rim]);

  cached = { body: shell, glass, head, tail, wheel };
  baseCache.set(spec.id, cached);
  return cached;
}

/** Per-livery paint for the shell. */
function paintShell(spec: CarSpec, paint: string, livery: Livery): THREE.BufferGeometry {
  const geo = baseFor(spec).body.clone();
  const color = new THREE.Color(paint);
  const count = geo.getAttribute('position').count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));

  if (livery === 'police') {
    // Dark side panels for a black-and-white cruiser look.
    const stripe = mergeParts([
      boxGeo(spec.width * 1.01, spec.bodyHeight * 0.34, spec.length * 0.42, 0, spec.bodyBottom + spec.bodyHeight * 0.52, 0.1),
    ]);
    applyColor(stripe, new THREE.Color('#1a1f27'));
    const merged = mergeGeometries([geo, stripe], false)!;
    geo.dispose();
    stripe.dispose();
    return merged;
  }
  if (livery === 'taxi') {
    const checker = mergeParts([
      boxGeo(spec.width * 1.01, spec.bodyHeight * 0.16, spec.length * 0.62, 0, spec.bodyBottom + spec.bodyHeight * 0.3, 0),
    ]);
    applyColor(checker, new THREE.Color('#16181d'));
    const merged = mergeGeometries([geo, checker], false)!;
    geo.dispose();
    checker.dispose();
    return merged;
  }
  return geo;
}

export interface CarVisual {
  group: THREE.Group;
  wheels: THREE.Mesh[];
  bodyMesh: THREE.Mesh;
  tailMaterial: THREE.MeshStandardMaterial;
}

/** Build a ready-to-use car group. The model faces +Z. */
export function createCarVisual(spec: CarSpec, paint: string, livery: Livery = 'civil'): CarVisual {
  const group = new THREE.Group();
  const base = baseFor(spec);

  const bodyMesh = new THREE.Mesh(paintShell(spec, paint, livery), bodyMaterial);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  group.add(bodyMesh);

  const glassMesh = new THREE.Mesh(base.glass.clone(), glassMaterial);
  glassMesh.castShadow = false;
  group.add(glassMesh);

  const headMesh = new THREE.Mesh(base.head.clone(), headlightMaterial);
  group.add(headMesh);

  const tailMesh = new THREE.Mesh(base.tail.clone(), tailMaterial.clone());
  group.add(tailMesh);

  const wheels: THREE.Mesh[] = [];
  const wheelPositions: [number, number][] = [
    [spec.track / 2, spec.wheelBase / 2],
    [-spec.track / 2, spec.wheelBase / 2],
    [spec.track / 2, -spec.wheelBase / 2],
    [-spec.track / 2, -spec.wheelBase / 2],
  ];
  for (const [x, z] of wheelPositions) {
    const wheel = new THREE.Mesh(base.wheel.clone(), wheelMaterial);
    wheel.position.set(x, spec.wheelRadius, z);
    wheel.castShadow = true;
    group.add(wheel);
    wheels.push(wheel);
  }

  // Body shadow blob keeps the car grounded even with shadows disabled.
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(spec.length * 0.42, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  blob.renderOrder = -1;
  group.add(blob);

  return { group, wheels, bodyMesh, tailMaterial: tailMesh.material as THREE.MeshStandardMaterial };
}

export function disposeCarGeometry(): void {
  for (const entry of baseCache.values()) {
    entry.body.dispose();
    entry.glass.dispose();
    entry.head.dispose();
    entry.tail.dispose();
    entry.wheel.dispose();
  }
  baseCache.clear();
}
