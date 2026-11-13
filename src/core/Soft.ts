import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import softModel from '../assets/models/soft.json';
import pistolModel from '../assets/models/pistol.json';
import smgModel from '../assets/models/smg.json';
import shotgunModel from '../assets/models/shotgun.json';

/**
 * Rounded body-part shapes authored in SolidCraft (see scripts/models). Each is a unit shape that
 * every character part shares and scales non-uniformly, replacing hard-edged BoxGeometry.
 */
export type SoftKind = 'box' | 'round' | 'limb';

interface Part { name: string; pos: number[]; idx: number[] }

const NAMES: Record<SoftKind, string> = { box: 'SoftBox', round: 'SoftRound', limb: 'SoftLimb' };
const cache = new Map<SoftKind, THREE.BufferGeometry>();

function geometryFor(kind: SoftKind): THREE.BufferGeometry {
  let geo = cache.get(kind);
  if (geo) return geo;
  const part = (softModel as { parts: Part[] }).parts.find((p) => p.name === NAMES[kind])!;
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(part.pos, (v) => v / 1000), 3));
  g.setIndex(part.idx);
  g = toCreasedNormals(g, 0.7);
  geo = mergeGeometries([g], false)!;
  cache.set(kind, geo);
  return geo;
}

/** A shaded, rounded stand-in for `new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)`. */
export function softMesh(w: number, h: number, d: number, material: THREE.Material, kind: SoftKind = 'box'): THREE.Mesh {
  const mesh = new THREE.Mesh(geometryFor(kind), material);
  mesh.scale.set(w, h, d);
  mesh.castShadow = true;
  // The geometry is shared by every character: owners must not dispose it.
  mesh.userData.sharedGeometry = true;
  return mesh;
}

/** Tall thin parts read better as capsules than as filleted boxes. */
export function kindForSize(w: number, h: number, d: number): SoftKind {
  return h >= 1.6 * Math.max(w, d) ? 'limb' : 'box';
}

interface GunPart { name: string; color: number[]; metal: number; rough: number; pos: number[]; idx: number[] }

/** A gun built from a SolidCraft model: one mesh per part, each with its own metal/rough material. */
function gunGroup(model: { parts: GunPart[] }): THREE.Group {
  const g = new THREE.Group();
  for (const part of model.parts) {
    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(part.pos, (v) => v / 1000), 3));
    geo.setIndex(part.idx);
    geo = toCreasedNormals(geo, 0.7);
    const mat = new THREE.MeshStandardMaterial({ roughness: part.rough, metalness: part.metal });
    mat.color.setRGB(part.color[0], part.color[1], part.color[2]); // baked values are already linear
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    g.add(mesh);
  }
  return g;
}

export const buildPistol = (): THREE.Group => gunGroup(pistolModel as { parts: GunPart[] });
export const buildSmg = (): THREE.Group => gunGroup(smgModel as { parts: GunPart[] });
export const buildShotgun = (): THREE.Group => gunGroup(shotgunModel as { parts: GunPart[] });
