import * as THREE from 'three';

export interface ColliderBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
}

export interface CircleHit {
  hit: boolean;
  /** Push vector that separates the circle from the box. */
  px: number;
  pz: number;
  /** Surface normal of the box that was hit (unit length). */
  nx: number;
  nz: number;
  depth: number;
}

export interface RayHit {
  hit: boolean;
  /** Distance along the ray (0..1 fraction is in `t`). */
  t: number;
  x: number;
  z: number;
  nx: number;
  nz: number;
  height: number;
}

const EMPTY_CIRCLE: CircleHit = { hit: false, px: 0, pz: 0, nx: 0, nz: 0, depth: 0 };
const EMPTY_RAY: RayHit = { hit: false, t: 1, x: 0, z: 0, nx: 0, nz: 0, height: 0 };

/**
 * Uniform-grid broadphase over axis-aligned building boxes.
 * Everything solid in the world (buildings, walls, props) lives here.
 */
export class CollisionWorld {
  readonly boxes: ColliderBox[] = [];
  private readonly cellSize = 40;
  private readonly hash = new Map<number, number[]>();

  constructor(boxes: ColliderBox[] = []) {
    this.boxes = boxes;
    this.rebuild();
  }

  add(box: ColliderBox): void {
    this.boxes.push(box);
    this.index(this.boxes.length - 1, box);
  }

  rebuild(): void {
    this.hash.clear();
    for (let i = 0; i < this.boxes.length; i++) this.index(i, this.boxes[i]);
  }

  private key(cx: number, cz: number): number {
    // Pack two signed 16-bit cell coords into one number key.
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  private index(index: number, box: ColliderBox): void {
    const c0 = Math.floor(box.minX / this.cellSize);
    const c1 = Math.floor(box.maxX / this.cellSize);
    const r0 = Math.floor(box.minZ / this.cellSize);
    const r1 = Math.floor(box.maxZ / this.cellSize);
    for (let cx = c0; cx <= c1; cx++) {
      for (let cz = r0; cz <= r1; cz++) {
        const k = this.key(cx, cz);
        let list = this.hash.get(k);
        if (!list) {
          list = [];
          this.hash.set(k, list);
        }
        list.push(index);
      }
    }
  }

  /** Collect candidate box indices overlapping the given XZ rectangle. */
  query(minX: number, minZ: number, maxX: number, maxZ: number): number[] {
    const c0 = Math.floor(minX / this.cellSize);
    const c1 = Math.floor(maxX / this.cellSize);
    const r0 = Math.floor(minZ / this.cellSize);
    const r1 = Math.floor(maxZ / this.cellSize);
    const out: number[] = [];
    const seen = new Set<number>();
    for (let cx = c0; cx <= c1; cx++) {
      for (let cz = r0; cz <= r1; cz++) {
        const list = this.hash.get(this.key(cx, cz));
        if (!list) continue;
        for (const i of list) {
          if (seen.has(i)) continue;
          seen.add(i);
          out.push(i);
        }
      }
    }
    return out;
  }

  /** Push a circle out of every box it overlaps. Returns the total separation. */
  resolveCircle(x: number, z: number, radius: number): CircleHit {
    let px = 0;
    let pz = 0;
    let nx = 0;
    let nz = 0;
    let depth = 0;

    for (let pass = 0; pass < 3; pass++) {
      const cx = x + px;
      const cz = z + pz;
      const ids = this.query(cx - radius, cz - radius, cx + radius, cz + radius);
      let moved = false;
      for (const i of ids) {
        const b = this.boxes[i];
        const qx = Math.max(b.minX, Math.min(cx, b.maxX));
        const qz = Math.max(b.minZ, Math.min(cz, b.maxZ));
        let dx = cx - qx;
        let dz = cz - qz;
        let d = Math.hypot(dx, dz);
        if (d > radius) continue;

        if (d < 1e-5) {
          // Centre is inside the box: escape along the shallowest axis.
          const toLeft = cx - b.minX;
          const toRight = b.maxX - cx;
          const toBack = cz - b.minZ;
          const toFront = b.maxZ - cz;
          const m = Math.min(toLeft, toRight, toBack, toFront);
          dx = m === toLeft ? -1 : m === toRight ? 1 : 0;
          dz = m === toBack ? -1 : m === toFront ? 1 : 0;
          d = 1;
        }
        const inv = 1 / d;
        const push = radius - d;
        px += dx * inv * push;
        pz += dz * inv * push;
        nx += dx * inv;
        nz += dz * inv;
        depth = Math.max(depth, push);
        moved = true;
      }
      if (!moved) break;
    }

    if (depth <= 0) return EMPTY_CIRCLE;
    const len = Math.hypot(nx, nz) || 1;
    return { hit: true, px, pz, nx: nx / len, nz: nz / len, depth };
  }

  /** True when a circle overlaps any solid box. */
  overlaps(x: number, z: number, radius: number): boolean {
    const ids = this.query(x - radius, z - radius, x + radius, z + radius);
    for (const i of ids) {
      const b = this.boxes[i];
      const qx = Math.max(b.minX, Math.min(x, b.maxX));
      const qz = Math.max(b.minZ, Math.min(z, b.maxZ));
      if (Math.hypot(x - qx, z - qz) < radius) return true;
    }
    return false;
  }

  /**
   * March a horizontal segment and report the first solid box hit.
   * `minHeight` ignores obstacles that are lower than the projectile.
   */
  raycast(x0: number, z0: number, x1: number, z1: number, minHeight = 0): RayHit {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-4) return EMPTY_RAY;
    const steps = Math.max(2, Math.ceil(dist / 1.4));
    const step = 1 / steps;

    for (let s = 1; s <= steps; s++) {
      const t = s * step;
      const px = x0 + dx * t;
      const pz = z0 + dz * t;
      const ids = this.query(px - 0.3, pz - 0.3, px + 0.3, pz + 0.3);
      for (const i of ids) {
        const b = this.boxes[i];
        if (b.height < minHeight) continue;
        if (px > b.minX && px < b.maxX && pz > b.minZ && pz < b.maxZ) {
          // Determine which face was crossed.
          const fx = (px - b.minX) / Math.max(1e-5, b.maxX - b.minX);
          const fz = (pz - b.minZ) / Math.max(1e-5, b.maxZ - b.minZ);
          let nx = 0;
          let nz = 0;
          if (fx <= fz && fx <= 1 - fz) nx = -1;
          else if (fx >= 1 - fz) nx = 1;
          else if (fz <= 1 - fx) nz = -1;
          else nz = 1;
          return { hit: true, t, x: px, z: pz, nx, nz, height: b.height };
        }
      }
    }
    return EMPTY_RAY;
  }

  /** Distance along a segment before it hits a solid box (for camera pull-in). */
  rayDistance(x0: number, z0: number, x1: number, z1: number): number {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-4) return dist;
    const steps = Math.max(2, Math.ceil(dist / 1.2));
    const step = 1 / steps;
    for (let s = 1; s <= steps; s++) {
      const t = s * step;
      const px = x0 + dx * t;
      const pz = z0 + dz * t;
      const ids = this.query(px - 0.25, pz - 0.25, px + 0.25, pz + 0.25);
      for (const i of ids) {
        const b = this.boxes[i];
        if (px > b.minX && px < b.maxX && pz > b.minZ && pz < b.maxZ) {
          return Math.max(0, dist * (t - step));
        }
      }
    }
    return dist;
  }
}

/** Shared scratch vector to avoid allocations in hot paths. */
export const scratchVec = new THREE.Vector3();
