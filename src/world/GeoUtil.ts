import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Geometry helpers used to build the merged static world meshes. */

/**
 * A flat quad laid on the XZ plane between two points, `width` units wide.
 * UV: u spans the width (0..1), v runs along the length at `vPerUnit` tiles
 * per world unit — that is how road dashes get their repeat.
 */
export function makeStripXZ(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  width: number,
  y: number,
  vPerUnit: number,
): THREE.BufferGeometry {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  const nx = -uz;
  const nz = ux;
  const hw = width / 2;

  const p0x = ax + nx * hw;
  const p0z = az + nz * hw;
  const p1x = ax - nx * hw;
  const p1z = az - nz * hw;
  const p2x = bx - nx * hw;
  const p2z = bz - nz * hw;
  const p3x = bx + nx * hw;
  const p3z = bz + nz * hw;

  const vLen = len * vPerUnit;
  const positions = new Float32Array([
    p0x, y, p0z,
    p1x, y, p1z,
    p2x, y, p2z,
    p3x, y, p3z,
  ]);
  const normals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, vLen, 0, vLen]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  return geo;
}

/** Axis aligned flat rectangle on the XZ plane centred at (cx, cz). */
export function makeRectXZ(
  cx: number,
  cz: number,
  w: number,
  d: number,
  y: number,
  uRepeat = 1,
  vRepeat = 1,
): THREE.BufferGeometry {
  const hw = w / 2;
  const hd = d / 2;
  // Counter-clockwise when seen from above so the face points up (+Y).
  const positions = new Float32Array([
    cx - hw, y, cz - hd,
    cx - hw, y, cz + hd,
    cx + hw, y, cz + hd,
    cx + hw, y, cz - hd,
  ]);
  const normals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
  const uvs = new Float32Array([0, 0, 0, vRepeat, uRepeat, vRepeat, uRepeat, 0]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  return geo;
}

/** Box with a per-vertex colour so many buildings can share one material. */
export function makeColoredBox(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: THREE.Color,
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(x, y, z);
  applyColor(geo, color);
  return geo;
}

export function applyColor(geo: THREE.BufferGeometry, color: THREE.Color): void {
  const count = geo.getAttribute('position').count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

/**
 * Remap box UVs so vertical faces tile in world space.
 * `tile` = world units covered by one texture tile, `uOffset` shifts the
 * pattern so neighbouring buildings do not line up perfectly.
 * Roof/bottom faces sample a flat patch in the corner of the texture.
 */
export function remapBoxUVs(geo: THREE.BufferGeometry, tile: number, uOffset = 0): void {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    if (ny > 0.5) {
      uv.setXY(i, 0.02, 0.02);
    } else {
      const u = (nx > 0.5 ? pz : px) / tile + uOffset;
      const v = py / tile;
      uv.setXY(i, u, v);
    }
  }
  uv.needsUpdate = true;
}

/** Merge a bucket of geometries into one buffer. Attributes must match. */
export function mergeAll(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  const usable = geometries.filter((g) => g && g.getAttribute('position'));
  if (usable.length === 0) return null;
  const withColor = usable.every((g) => !!g.getAttribute('color'));
  if (withColor) {
    for (const g of usable) if (!g.getAttribute('color')) applyColor(g, new THREE.Color(1, 1, 1));
  }
  const merged = mergeGeometries(usable, false);
  for (const g of usable) g.dispose();
  return merged;
}
