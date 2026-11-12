import * as THREE from 'three';
import type { CollisionWorld } from '../systems/Collision';
import type { Vehicle } from './Vehicle';
import { dist2D, rngFrom, type Rng } from '../core/MathUtil';

type PedState = 'walk' | 'flee' | 'stunned' | 'dead';

const SKIN_TONES = ['#f0c9a3', '#d9a273', '#b57a4d', '#8a5a34', '#5f3b21'];
const SHIRT_TONES = ['#e2e6ea', '#2b6fb5', '#d94f6d', '#f0a63c', '#48a97a', '#8f5fd0', '#1f2430'];
const PANTS_TONES = ['#2b3b62', '#333a44', '#4a4034', '#1e2a22'];

interface PedRig {
  group: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  torso: THREE.Group;
  hips: THREE.Group;
}

/** A rectangle the pedestrian walks around, on the sidewalk. */
export interface WalkPath {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Point at distance `s` along the perimeter of a rectangle. */
export function perimeterPoint(path: WalkPath, s: number, out: { x: number; z: number }): void {
  const w = path.x1 - path.x0;
  const h = path.z1 - path.z0;
  const total = 2 * (w + h);
  let d = s % total;
  if (d < 0) d += total;
  if (d < w) {
    out.x = path.x0 + d;
    out.z = path.z0;
  } else if (d < w + h) {
    out.x = path.x1;
    out.z = path.z0 + (d - w);
  } else if (d < 2 * w + h) {
    out.x = path.x1 - (d - w - h);
    out.z = path.z1;
  } else {
    out.x = path.x0;
    out.z = path.z1 - (d - 2 * w - h);
  }
}

/** A civilian walking the streets. */
export class Pedestrian {
  readonly group = new THREE.Group();
  readonly position = new THREE.Vector3();
  yaw = 0;
  health = 100;
  state: PedState = 'walk';
  speed = 1.35;
  phase = 0;
  deadTimer = 0;
  hitFlash = 0;
  private rig: PedRig;
  private target = new THREE.Vector3();
  private hasTarget = false;
  /** Sidewalk loop the pedestrian sticks to (null = free roam). */
  private path: WalkPath | null = null;
  private pathDistance = 0;
  private pathDir = 1;
  private readonly scratch = { x: 0, z: 0 };
  private readonly scratch2 = { x: 0, z: 0 };

  constructor(x: number, z: number, rng: Rng) {
    this.position.set(x, 0, z);
    this.rig = buildRig(rng);
    this.group.add(this.rig.group);
    this.group.position.set(x, 0, z);
    this.speed = rng.range(1.05, 1.75);
  }

  get alive(): boolean {
    return this.state !== 'dead';
  }

  kill(): void {
    if (this.state === 'dead') return;
    this.state = 'dead';
    this.deadTimer = 0;
    this.health = 0;
  }

  stun(): void {
    if (this.state !== 'dead') this.state = 'stunned';
  }

  damage(amount: number): boolean {
    if (this.state === 'dead') return false;
    this.health -= amount;
    this.hitFlash = 0.25;
    if (this.health <= 0) {
      this.kill();
      return true;
    }
    this.state = 'flee';
    return false;
  }

  fleeFrom(x: number, z: number): void {
    if (this.state === 'dead') return;
    this.state = 'flee';
    this.path = null;
    const dx = this.position.x - x;
    const dz = this.position.z - z;
    const len = Math.hypot(dx, dz) || 1;
    this.target.set(this.position.x + (dx / len) * 16, 0, this.position.z + (dz / len) * 16);
    this.hasTarget = true;
  }

  setTarget(x: number, z: number): void {
    this.target.set(x, 0, z);
    this.hasTarget = true;
  }

  /** Keep the pedestrian on the sidewalk loop of its block. */
  setPath(path: WalkPath, offset = 0): void {
    this.path = path;
    this.pathDistance = offset;
    this.pathDir = Math.random() < 0.5 ? 1 : -1;
  }

  get onPath(): boolean {
    return this.path !== null;
  }

  update(dt: number, world: CollisionWorld, blockCenters: { x: number; z: number }[], rng: Rng): void {
    if (this.state === 'dead') {
      this.deadTimer += dt;
      // Collapse.
      const t = Math.min(1, this.deadTimer * 3.4);
      this.rig.hips.rotation.x = t * (Math.PI / 2) * 0.92;
      this.rig.group.position.y = -t * 0.35;
      this.rig.torso.rotation.x = t * 0.25;
      this.group.position.set(this.position.x, 0, this.position.z);
      this.hitFlash = Math.max(0, this.hitFlash - dt);
      return;
    }

    if (this.state === 'stunned') {
      this.hitFlash = Math.max(0, this.hitFlash - dt);
      this.group.position.set(this.position.x, 0, this.position.z);
      return;
    }

    const running = this.state === 'flee';
    const speed = running ? 4.4 : this.speed;

    if (this.path && !running) {
      // Walk the sidewalk loop of the block.
      this.pathDistance += this.pathDir * speed * dt;
      perimeterPoint(this.path, this.pathDistance, this.scratch);
      perimeterPoint(this.path, this.pathDistance + this.pathDir * 0.6, this.scratch2);
      this.position.x = this.scratch.x;
      this.position.z = this.scratch.z;
      const targetYaw = Math.atan2(this.scratch2.x - this.scratch.x, this.scratch2.z - this.scratch.z);
      const delta = Math.atan2(Math.sin(targetYaw - this.yaw), Math.cos(targetYaw - this.yaw));
      this.yaw += delta * Math.min(1, dt * 9);
    } else {
      if (!this.hasTarget || dist2D(this.position.x, this.position.z, this.target.x, this.target.z) < 1.6) {
        this.pickTarget(blockCenters, rng);
      }

      const dx = this.target.x - this.position.x;
      const dz = this.target.z - this.position.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.001) {
        const nx = dx / len;
        const nz = dz / len;
        const step = speed * dt;
        const px = this.position.x + nx * step;
        const pz = this.position.z + nz * step;
        if (!world.overlaps(px, pz, 0.45)) {
          this.position.x = px;
          this.position.z = pz;
        } else {
          this.hasTarget = false;
        }
        const targetYaw = Math.atan2(nx, nz);
        const delta = Math.atan2(Math.sin(targetYaw - this.yaw), Math.cos(targetYaw - this.yaw));
        this.yaw += delta * Math.min(1, dt * 9);
      }
    }

    this.phase += dt * (running ? 11 : 6.2);
    const swing = Math.sin(this.phase) * (running ? 0.85 : 0.55);
    this.rig.legL.rotation.x = swing;
    this.rig.legR.rotation.x = -swing;
    this.rig.armL.rotation.x = -swing * 0.8;
    this.rig.armR.rotation.x = swing * 0.8;
    this.rig.hips.position.y = Math.abs(Math.sin(this.phase)) * (running ? 0.07 : 0.035);

    this.hitFlash = Math.max(0, this.hitFlash - dt);
    const tint = this.hitFlash > 0 ? 1 : 0;
    this.rig.torso.children.forEach((child) => {
      const mesh = child as THREE.Mesh;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat && mat.color) mat.emissive.setRGB(tint * 0.9, tint * 0.05, tint * 0.05);
    });

    this.group.position.set(this.position.x, 0, this.position.z);
    this.group.rotation.y = this.yaw;
  }

  private pickTarget(blockCenters: { x: number; z: number }[], rng: Rng): void {
    if (blockCenters.length === 0) {
      this.target.set(this.position.x + rng.range(-10, 10), 0, this.position.z + rng.range(-10, 10));
      this.hasTarget = true;
      return;
    }
    const center = blockCenters[rng.int(0, blockCenters.length - 1)];
    const radius = rng.range(26, 38);
    const angle = rng.range(0, Math.PI * 2);
    this.target.set(center.x + Math.cos(angle) * radius, 0, center.z + Math.sin(angle) * radius);
    this.hasTarget = true;
  }

  dispose(): void {
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        const mat = mesh.material as THREE.Material;
        mat.dispose();
      }
    });
  }
}

function buildRig(rng: Rng): PedRig {
  const group = new THREE.Group();
  const hips = new THREE.Group();
  const torso = new THREE.Group();

  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color(rng.pick(SKIN_TONES)), roughness: 0.85 });
  const shirt = new THREE.MeshStandardMaterial({ color: new THREE.Color(rng.pick(SHIRT_TONES)), roughness: 0.85 });
  const pants = new THREE.MeshStandardMaterial({ color: new THREE.Color(rng.pick(PANTS_TONES)), roughness: 0.88 });

  const box = (w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.castShadow = true;
    return mesh;
  };

  const body = box(0.4, 0.5, 0.24, shirt);
  body.position.y = 0.25;
  torso.add(body);
  const head = box(0.23, 0.25, 0.23, skin);
  head.position.y = 0.62;
  torso.add(head);
  const hair = box(0.25, 0.09, 0.25, new THREE.MeshStandardMaterial({ color: new THREE.Color('#241c18'), roughness: 0.9 }));
  hair.position.y = 0.73;
  torso.add(hair);

  torso.position.y = 0.96;
  hips.add(torso);

  const armL = new THREE.Group();
  const armLGeo = box(0.11, 0.48, 0.13, shirt);
  armLGeo.position.y = -0.24;
  armL.add(armLGeo);
  armL.position.set(0.26, 0.46, 0);
  torso.add(armL);

  const armR = new THREE.Group();
  const armRGeo = box(0.11, 0.48, 0.13, skin);
  armRGeo.position.y = -0.24;
  armR.add(armRGeo);
  armR.position.set(-0.26, 0.46, 0);
  torso.add(armR);

  const legL = new THREE.Group();
  const legLGeo = box(0.15, 0.82, 0.18, pants);
  legLGeo.position.y = -0.41;
  legL.add(legLGeo);
  legL.position.set(0.1, 0.84, 0);
  hips.add(legL);

  const legR = new THREE.Group();
  const legRGeo = box(0.15, 0.82, 0.18, pants);
  legRGeo.position.y = -0.41;
  legR.add(legRGeo);
  legR.position.set(-0.1, 0.84, 0);
  hips.add(legR);

  group.add(hips);
  return { group, hips, torso, armL, armR, legL, legR };
}

/** Keeps a population of pedestrians alive near the player. */
export class PedManager {
  readonly peds: Pedestrian[] = [];
  private rng = rngFrom(31337);
  private maxCount = 26;

  constructor(
    private scene: THREE.Scene,
    private spawnPoints: { x: number; z: number }[],
    private blockCenters: { x: number; z: number }[],
    /** Sidewalk loops, one per city block. */
    private paths: WalkPath[] = [],
  ) {}

  setMaxCount(n: number): void {
    this.maxCount = n;
  }

  private addToScene(ped: Pedestrian): void {
    ped.group.userData.kind = 'ped';
    this.scene.add(ped.group);
  }

  private removeFromScene(ped: Pedestrian): void {
    this.scene.remove(ped.group);
    ped.dispose();
  }

  /** Put the pedestrian on the sidewalk loop of the nearest block. */
  private assignPath(ped: Pedestrian): void {
    if (this.paths.length === 0) return;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this.paths.length; i++) {
      const p = this.paths[i];
      const cx = (p.x0 + p.x1) / 2;
      const cz = (p.z0 + p.z1) / 2;
      const d = dist2D(ped.position.x, ped.position.z, cx, cz);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    const path = this.paths[best];
    // Start somewhere along the loop, near the pedestrian.
    perimeterPoint(path, 0, this.scratch);
    let bestOffset = 0;
    let closest = Infinity;
    for (let s = 0; s < 240; s += 4) {
      perimeterPoint(path, s, this.scratch);
      const d = dist2D(ped.position.x, ped.position.z, this.scratch.x, this.scratch.z);
      if (d < closest) {
        closest = d;
        bestOffset = s;
      }
    }
    ped.setPath(path, bestOffset);
  }

  private scratch = { x: 0, z: 0 };

  spawnNear(x: number, z: number): Pedestrian {
    const point = this.spawnPoints[this.rng.int(0, this.spawnPoints.length - 1)];
    const ped = new Pedestrian(point.x, point.z, this.rng);
    ped.setTarget(x + this.rng.range(-20, 20), z + this.rng.range(-20, 20));
    this.addToScene(ped);
    this.peds.push(ped);
    return ped;
  }

  /** Spawn a pedestrian at an exact position. */
  spawnAt(x: number, z: number): Pedestrian {
    const ped = new Pedestrian(x, z, this.rng);
    this.addToScene(ped);
    this.peds.push(ped);
    return ped;
  }

  update(dt: number, world: CollisionWorld, playerX: number, playerZ: number, vehicles?: Vehicle[]): void {
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const ped = this.peds[i];
      const dist = dist2D(ped.position.x, ped.position.z, playerX, playerZ);

      // Despawn far or long-dead pedestrians.
      if (dist > 190 || (ped.state === 'dead' && ped.deadTimer > 22)) {
        this.removeFromScene(ped);
        this.peds.splice(i, 1);
        continue;
      }

      // Flee from gunfire, from the player, and from approaching traffic vehicles.
      if (ped.state !== 'dead' && ped.state !== 'stunned') {
        if (dist < 14) {
          ped.fleeFrom(playerX, playerZ);
        } else if (vehicles) {
          for (let v = 0; v < vehicles.length; v++) {
            const car = vehicles[v];
            if (Math.abs(car.forwardSpeed) < 3.5) continue;
            const carDist = dist2D(ped.position.x, ped.position.z, car.position.x, car.position.z);
            if (carDist < 8.5) {
              ped.fleeFrom(car.position.x, car.position.z);
              break;
            }
          }
        }
      }

      ped.update(dt, world, this.blockCenters, this.rng);
    }

    // Keep the population topped up around the player.
    const desired = this.maxCount;
    if (this.peds.length < desired) {
      const ped = this.spawnNear(playerX, playerZ);
      ped.position.set(
        playerX + this.rng.range(-45, 45),
        0,
        playerZ + this.rng.range(-45, 45),
      );
      // Push it out of any building it landed in.
      if (world.overlaps(ped.position.x, ped.position.z, 0.5)) {
        const point = this.spawnPoints[this.rng.int(0, this.spawnPoints.length - 1)];
        ped.position.set(point.x, 0, point.z);
      }
      this.assignPath(ped);
    }
  }

  clear(): void {
    for (const ped of this.peds) this.removeFromScene(ped);
    this.peds.length = 0;
  }
}
