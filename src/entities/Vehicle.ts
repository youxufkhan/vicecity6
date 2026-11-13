import * as THREE from 'three';
import type { CollisionWorld } from '../systems/Collision';
import { clamp, clamp01, damp } from '../core/MathUtil';
import { createCarVisual, type CarSpec, type CarVisual, type Livery } from './CarFactory';

export interface VehicleInput {
  /** -1 (reverse/brake) .. 1 (accelerate) */
  throttle: number;
  /** -1 (left) .. 1 (right) */
  steer: number;
  handbrake: boolean;
}

export type VehicleDriver = 'none' | 'player' | 'ai' | 'police';

const WORLD_LIMITS = { minX: -318, maxX: 318, minZ: -318, maxZ: 368 };

export class Vehicle {
  readonly spec: CarSpec;
  readonly visual: CarVisual;
  readonly group: THREE.Group;

  position = new THREE.Vector3();
  yaw = 0;
  /** World-space velocity on the XZ plane. */
  readonly velocity = new THREE.Vector3();

  steer = 0;
  throttle = 0;
  handbrake = false;

  health = 100;
  wrecked = false;
  /** Set once the wreck effect has played so it does not repeat. */
  destroyed = false;
  driver: VehicleDriver = 'none';

  /** Controller that steers this vehicle when the player is not driving. */
  ai: VehicleAI | null = null;

  /** Set while the AI is driving, so traffic yields to the player. */
  horn = 0;

  /** 0..1 dent amount per side of the body, from where it has been hit. */
  readonly damage = { front: 0, rear: 0, left: 0, right: 0 };
  /** 0..1 engine speed within the current gear (for the audio engine note). */
  rpm = 0;
  gear = 1;
  private accelLong = 0;
  private pitchVel = 0;
  private rollVel = 0;
  private dentDirty = false;
  private bodyRest: { pos: Float32Array; col: Float32Array } | null = null;

  private wheelSpin = 0;
  private steerAngle = 0;
  private pitch = 0;
  private roll = 0;
  private lastSpeed = 0;
  private radius: number;
  private halfBase: number;
  private brakeGlow = 0;

  constructor(spec: CarSpec, paint: string, livery: Livery = 'civil') {
    this.spec = spec;
    this.visual = createCarVisual(spec, paint, livery);
    this.group = this.visual.group;
    this.radius = spec.width * 0.56;
    this.halfBase = spec.wheelBase * 0.42;
  }

  overlapsCircle(x: number, z: number, radius: number): boolean {
    const dx = x - this.position.x;
    const dz = z - this.position.z;
    const along = dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw);
    const across = -dx * Math.cos(this.yaw) + dz * Math.sin(this.yaw);
    const outsideLength = Math.max(0, Math.abs(along) - this.spec.length / 2);
    const outsideWidth = Math.max(0, Math.abs(across) - this.spec.width / 2);
    return Math.hypot(outsideLength, outsideWidth) < radius;
  }

  get speed(): number {
    return this.velocity.length();
  }

  get forwardSpeed(): number {
    return this.velocity.x * Math.sin(this.yaw) + this.velocity.z * Math.cos(this.yaw);
  }

  get lateralSpeed(): number {
    return this.velocity.x * -Math.cos(this.yaw) + this.velocity.z * Math.sin(this.yaw);
  }

  get forward(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  setInput(input: VehicleInput): void {
    this.throttle = clamp(input.throttle, -1, 1);
    this.steer = clamp(input.steer, -1, 1);
    this.handbrake = input.handbrake;
  }

  applyDamage(amount: number): void {
    if (this.wrecked) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) this.wrecked = true;
  }

  get speedKph(): number {
    return Math.abs(this.forwardSpeed) * 3.6;
  }

  update(dt: number, world: CollisionWorld): void {
    const spec = this.spec;
    const power = this.wrecked ? 0 : spec.power * (0.55 + 0.45 * clamp01(this.health / 100));

    // ── decompose velocity into the car frame ──
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    let forwardSpeed = this.velocity.x * fx + this.velocity.z * fz;
    let lateral = this.velocity.x * -fz + this.velocity.z * fx;

    // ── engine / brakes ──
    if (this.throttle > 0.001) {
      const headroom = clamp01(1 - forwardSpeed / spec.topSpeed);
      forwardSpeed += power * this.throttle * (0.35 + 0.65 * headroom) * dt;
    } else if (this.throttle < -0.001) {
      if (forwardSpeed > 0.4) {
        forwardSpeed -= 26 * -this.throttle * dt;
      } else {
        forwardSpeed -= power * 0.55 * -this.throttle * dt;
        forwardSpeed = Math.max(forwardSpeed, -spec.topSpeed * 0.34);
      }
    }

    // Rolling resistance and drag.
    const drag = 0.6 + 0.0022 * forwardSpeed * forwardSpeed;
    const rolling = this.throttle === 0 || Math.sign(forwardSpeed) !== Math.sign(this.throttle);
    // Slip-based grip: once the tyres are sliding (lateral speed vs forward speed) they lose
    // hold, so a hard turn at speed drifts instead of staying glued. Braking/accelerating
    // shifts load off the tyres and costs a little more grip.
    const slipRatio = Math.abs(lateral) / Math.max(Math.abs(forwardSpeed), 4);
    const slipGrip = 1 - clamp((slipRatio - 0.22) / 0.5, 0, 1) * 0.55;
    const loadGrip = 1 - 0.18 * clamp(Math.abs(this.accelLong) / 9, 0, 1);
    const grip = this.handbrake ? 2.4 : spec.grip * slipGrip * loadGrip;
    lateral *= Math.exp(-grip * dt);
    const resistance = (rolling ? drag : 0) + (this.handbrake ? 11 + Math.abs(lateral) * 0.32 : 0);
    forwardSpeed = Math.sign(forwardSpeed) * Math.max(0, Math.abs(forwardSpeed) - resistance * dt);

    // ── steering ──
    const speedFactor = clamp01(Math.abs(forwardSpeed) / 5.5);
    const highSpeedFactor = clamp(1 - Math.abs(forwardSpeed) / (spec.topSpeed * 1.6), 0.45, 1);
    const dir = forwardSpeed >= 0 ? 1 : -1;
    let yawRate = -this.steer * spec.steering * speedFactor * highSpeedFactor * dir;

    // Locked rear wheels let the tail swing round: the handbrake turns much harder.
    if (this.handbrake) yawRate *= 1.7;

    // Drifting adds rotation from the lateral slip.
    const slip = clamp(lateral / 9, -1, 1);
    if (Math.abs(lateral) > 1.2) yawRate += -slip * 0.55 * dir;

    this.yaw += yawRate * dt;
    this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));

    // Inertia: the car turns but its momentum does not, so the velocity keeps its world
    // direction and the new heading sees the difference as sideways slip (decayed by the
    // tyres next frame). That is what lets a fast turn or the handbrake break the tail loose.
    const vx = fx * forwardSpeed + -fz * lateral;
    const vz = fz * forwardSpeed + fx * lateral;
    this.velocity.set(vx, 0, vz);
    forwardSpeed = vx * Math.sin(this.yaw) + vz * Math.cos(this.yaw);

    // ── integrate ──
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.position.x = clamp(this.position.x, WORLD_LIMITS.minX, WORLD_LIMITS.maxX);
    this.position.z = clamp(this.position.z, WORLD_LIMITS.minZ, WORLD_LIMITS.maxZ);

    this.collide(world);

    // ── engine speed: five gears across the speed range ──
    const sFrac = clamp01(Math.abs(forwardSpeed) / spec.topSpeed);
    this.gear = Math.min(5, 1 + Math.floor(sFrac * 5));
    const inGear = sFrac * 5 - (this.gear - 1);
    this.rpm = clamp01(0.3 + 0.7 * clamp01(inGear) + Math.abs(this.throttle) * 0.08);

    // ── visuals ──
    this.accelLong = (forwardSpeed - this.lastSpeed) / Math.max(dt, 0.0001);
    this.updateVisual(dt, forwardSpeed);
    this.lastSpeed = forwardSpeed;
  }

  private collide(world: CollisionWorld): void {
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const offsets = [this.halfBase, -this.halfBase];
    for (const off of offsets) {
      const cx = this.position.x + fx * off;
      const cz = this.position.z + fz * off;
      const hit = world.resolveCircle(cx, cz, this.radius);
      if (!hit.hit) continue;
      this.position.x += hit.px;
      this.position.z += hit.pz;
      const vn = this.velocity.x * hit.nx + this.velocity.z * hit.nz;
      if (vn < 0) {
        const impact = -vn;
        const restitution = 0.22;
        this.velocity.x -= (1 + restitution) * vn * hit.nx;
        this.velocity.z -= (1 + restitution) * vn * hit.nz;
        // Torque from the offset of the contact point.
        const torque = fx * hit.nz - fz * hit.nx;
        this.yaw += torque * impact * 0.012 * Math.sign(off || 1);
        if (impact > 3) {
          this.registerHit(-hit.nx, -hit.nz, impact);
          this.applyDamage(impact * 1.5);
          this.lastImpactSpeed = impact;
        }
      }
    }
  }

  lastImpactSpeed = 0;

  /** Record a hit from a world direction (car centre -> contact) so the matching side dents. */
  registerHit(dirX: number, dirZ: number, impact: number): void {
    const len = Math.hypot(dirX, dirZ) || 1;
    const ux = dirX / len;
    const uz = dirZ / len;
    const along = ux * Math.sin(this.yaw) + uz * Math.cos(this.yaw);
    const side = ux * -Math.cos(this.yaw) + uz * Math.sin(this.yaw); // + = right
    const amount = clamp01(impact / 28);
    if (along > 0.5) this.damage.front = clamp01(this.damage.front + amount);
    else if (along < -0.5) this.damage.rear = clamp01(this.damage.rear + amount);
    else if (side > 0) this.damage.right = clamp01(this.damage.right + amount);
    else this.damage.left = clamp01(this.damage.left + amount);
    this.dentDirty = true;
  }

  /** Push body vertices in on the damaged sides and dull the paint there. Cloned geometry only. */
  private applyDents(): void {
    this.dentDirty = false;
    const geo = this.visual.bodyMesh.geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const col = geo.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!this.bodyRest) {
      this.bodyRest = { pos: Float32Array.from(pos.array), col: col ? Float32Array.from(col.array) : new Float32Array(0) };
    }
    const rest = this.bodyRest;
    const L = this.spec.length;
    const W = this.spec.width;
    const d = this.damage;
    for (let i = 0; i < pos.count; i++) {
      const x = rest.pos[i * 3];
      const y = rest.pos[i * 3 + 1];
      const z = rest.pos[i * 3 + 2];
      // Same wobble for vertices at the same place, so the surface stays closed.
      const wobble = 0.55 + 0.45 * Math.sin(x * 7 + y * 5 + z * 9);
      const f = d.front * clamp01((z - L * 0.2) / (L * 0.3));
      const r = d.rear * clamp01((-z - L * 0.2) / (L * 0.3));
      const lft = d.left * clamp01((x - W * 0.2) / (W * 0.3));
      const rgt = d.right * clamp01((-x - W * 0.2) / (W * 0.3));
      pos.setXYZ(
        i,
        x - Math.sign(x) * 0.22 * (lft + rgt) * wobble,
        y - 0.08 * (f + r) * wobble,
        z - Math.sign(z) * 0.4 * (f + r) * wobble,
      );
      if (col && rest.col.length) {
        const dark = 1 - 0.4 * clamp01(f + r + lft + rgt);
        col.setXYZ(i, rest.col[i * 3] * dark, rest.col[i * 3 + 1] * dark, rest.col[i * 3 + 2] * dark);
      }
    }
    pos.needsUpdate = true;
    if (col) col.needsUpdate = true;
    // Crumpled panels are faceted: recompute normals so the dents catch the light.
    geo.computeVertexNormals();
  }

  private updateVisual(dt: number, forwardSpeed: number): void {
    this.group.position.set(this.position.x, 0, this.position.z);
    this.group.rotation.y = this.yaw;

    // Body attitude from acceleration and cornering load.
    const accel = (forwardSpeed - this.lastSpeed) / Math.max(dt, 0.0001);
    const targetPitch = clamp(-accel * 0.006, -0.06, 0.06);
    const targetRoll = clamp(this.lateralSpeed * 0.012, -0.09, 0.09);
    // Spring-damper (not a plain lerp) so the body overshoots and settles: it dives under
    // braking, squats on launch and rocks when the steering flips.
    this.pitchVel += (70 * (targetPitch - this.pitch) - 9 * this.pitchVel) * dt;
    this.rollVel += (70 * (targetRoll - this.roll) - 9 * this.rollVel) * dt;
    this.pitch += this.pitchVel * dt;
    this.roll += this.rollVel * dt;
    if (this.dentDirty) this.applyDents();
    this.visual.bodyMesh.rotation.x = this.pitch;
    this.visual.bodyMesh.rotation.z = this.roll;

    // Wheels.
    this.wheelSpin += (forwardSpeed / this.spec.wheelRadius) * dt;
    // Lock shrinks with speed like a real rack; rate-limited so wheels don't snap.
    const lock = 0.62 - 0.38 * clamp01(Math.abs(forwardSpeed) / this.spec.topSpeed);
    this.steerAngle = damp(this.steerAngle, this.steer * lock, 9, dt);
    const wheels = this.visual.wheels;
    if (wheels.length === 4) {
      // Ackermann: the inside wheel turns more than the outside one.
      const inner = Math.atan(Math.tan(this.steerAngle) / Math.max(0.4, 1 - Math.abs(Math.tan(this.steerAngle)) * (this.spec.track / this.spec.wheelBase) * 0.5));
      const left = this.steerAngle >= 0 ? this.steerAngle : inner;
      const right = this.steerAngle >= 0 ? inner : this.steerAngle;
      // Positive steer = right = yaw decreases, so the wheel's Y angle is negated.
      wheels[0].rotation.set(this.wheelSpin, -left, 0);
      wheels[1].rotation.set(this.wheelSpin, -right, 0);
      wheels[2].rotation.set(this.wheelSpin, 0, 0);
      wheels[3].rotation.set(this.wheelSpin, 0, 0);
    }

    // Brake lights.
    const braking = this.throttle < -0.05 && forwardSpeed > 0.4;
    this.brakeGlow = damp(this.brakeGlow, braking ? 1 : 0, 14, dt);
    this.visual.tailMaterial.emissiveIntensity = 0.35 + this.brakeGlow * 2.6;
  }

  setLightsOn(on: boolean): void {
    this.lightsOn = on;
  }

  lightsOn = false;

  dispose(): void {
    this.visual.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry && !mesh.userData.sharedGeometry) mesh.geometry.dispose();
    });
  }
}

/** Interface implemented by AI controllers (traffic + police). */
export interface VehicleAI {
  update(vehicle: Vehicle, dt: number): void;
}

/** Resolve collisions between vehicles using oriented rectangles and the separating axis theorem. */
export function resolveVehiclePairs(
  vehicles: Vehicle[],
  onImpact?: (a: Vehicle, b: Vehicle, speed: number) => void,
): void {
  for (let i = 0; i < vehicles.length; i++) {
    const a = vehicles[i];
    for (let j = i + 1; j < vehicles.length; j++) {
      const b = vehicles[j];
      const dx = b.position.x - a.position.x;
      const dz = b.position.z - a.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > (Math.hypot(a.spec.length, a.spec.width) + Math.hypot(b.spec.length, b.spec.width)) / 2) continue;
      const afx = Math.sin(a.yaw);
      const afz = Math.cos(a.yaw);
      const bfx = Math.sin(b.yaw);
      const bfz = Math.cos(b.yaw);
      const axes = [[afx, afz], [-afz, afx], [bfx, bfz], [-bfz, bfx]];
      let overlap = Infinity;
      let nx = 0;
      let nz = 0;
      for (const [ax, az] of axes) {
        const aRadius = Math.abs(ax * afx + az * afz) * a.spec.length / 2 +
          Math.abs(-ax * afz + az * afx) * a.spec.width / 2;
        const bRadius = Math.abs(ax * bfx + az * bfz) * b.spec.length / 2 +
          Math.abs(-ax * bfz + az * bfx) * b.spec.width / 2;
        const projected = dx * ax + dz * az;
        const depth = aRadius + bRadius - Math.abs(projected);
        if (depth <= 0) {
          overlap = 0;
          break;
        }
        if (depth < overlap) {
          overlap = depth;
          const sign = projected < 0 ? -1 : 1;
          nx = ax * sign;
          nz = az * sign;
        }
      }
      if (overlap <= 0) continue;

      const ma = a.spec.mass;
      const mb = b.spec.mass;
      const total = ma + mb;
      a.position.x -= nx * overlap * (mb / total);
      a.position.z -= nz * overlap * (mb / total);
      b.position.x += nx * overlap * (ma / total);
      b.position.z += nz * overlap * (ma / total);

      const rvx = b.velocity.x - a.velocity.x;
      const rvz = b.velocity.z - a.velocity.z;
      const vn = rvx * nx + rvz * nz;
      if (vn > 0) continue;

      const restitution = 0.18;
      const impulse = (-(1 + restitution) * vn) / (1 / ma + 1 / mb);
      a.velocity.x -= (impulse / ma) * nx;
      a.velocity.z -= (impulse / ma) * nz;
      b.velocity.x += (impulse / mb) * nx;
      b.velocity.z += (impulse / mb) * nz;

      const impact = Math.abs(vn);
      if (impact > 4) {
        onImpact?.(a, b, impact);
        a.applyDamage(impact * 0.55);
        b.applyDamage(impact * 0.55);
        a.registerHit(nx, nz, impact);
        b.registerHit(-nx, -nz, impact);
        a.lastImpactSpeed = Math.max(a.lastImpactSpeed, impact);
        b.lastImpactSpeed = Math.max(b.lastImpactSpeed, impact);
      }
    }
  }
}
