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
          const push = radius + m;
          px += dx * push;
          pz += dz * push;
          nx += dx;
          nz += dz;
          depth = Math.max(depth, push);
          moved = true;
          continue;
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

  /** Intersect a segment with collider slabs so even thin walls block sight. */
  raycast(x0: number, z0: number, x1: number, z1: number, minHeight = 0): RayHit {
    const dx = x1 - x0;
    const dz = z1 - z0;
    let result = EMPTY_RAY;
    let nearest = Infinity;
    const ids = this.query(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1));
    for (const id of ids) {
      const box = this.boxes[id];
      if (box.height < minHeight) continue;
      let enter = 0;
      let leave = 1;
      let nx = 0;
      let nz = 0;
      for (const axis of [0, 1]) {
        const origin = axis === 0 ? x0 : z0;
        const delta = axis === 0 ? dx : dz;
        const min = axis === 0 ? box.minX : box.minZ;
        const max = axis === 0 ? box.maxX : box.maxZ;
        if (Math.abs(delta) < 1e-10) {
          if (origin < min || origin > max) leave = -1;
          continue;
        }
        const t0 = (min - origin) / delta;
        const t1 = (max - origin) / delta;
        const near = Math.min(t0, t1);
        if (near > enter) {
          enter = near;
          nx = axis === 0 ? -Math.sign(delta) : 0;
          nz = axis === 1 ? -Math.sign(delta) : 0;
        }
        leave = Math.min(leave, Math.max(t0, t1));
      }
      if (enter > leave || enter >= nearest) continue;
      nearest = enter;
      result = { hit: true, t: enter, x: x0 + dx * enter, z: z0 + dz * enter, nx, nz, height: box.height };
    }
    return result;
  }

  /** Distance to the first obstacle, shared with gameplay line-of-sight queries. */
  rayDistance(x0: number, z0: number, x1: number, z1: number): number {
    return Math.hypot(x1 - x0, z1 - z0) * this.raycast(x0, z0, x1, z1).t;
  }

}

/** Shared scratch vector to avoid allocations in hot paths. */
export const scratchVec = new THREE.Vector3();
