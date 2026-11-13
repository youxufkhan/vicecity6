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
    const grip = this.handbrake ? 2.4 : spec.grip;
    lateral *= Math.exp(-grip * dt);
    const resistance = (rolling ? drag : 0) + (this.handbrake ? 11 + Math.abs(lateral) * 0.32 : 0);
    forwardSpeed = Math.sign(forwardSpeed) * Math.max(0, Math.abs(forwardSpeed) - resistance * dt);

    // ── steering ──
    const speedFactor = clamp01(Math.abs(forwardSpeed) / 5.5);
    const highSpeedFactor = clamp(1 - Math.abs(forwardSpeed) / (spec.topSpeed * 1.6), 0.45, 1);
    const dir = forwardSpeed >= 0 ? 1 : -1;
    let yawRate = -this.steer * spec.steering * speedFactor * highSpeedFactor * dir;

    // Drifting adds rotation from the lateral slip.
    const slip = clamp(lateral / 9, -1, 1);
    if (Math.abs(lateral) > 1.2) yawRate += -slip * 0.55 * dir;

    this.yaw += yawRate * dt;
    this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));

    // Rebuild the velocity in the new frame.
    const nfx = Math.sin(this.yaw);
    const nfz = Math.cos(this.yaw);
    this.velocity.set(nfx * forwardSpeed + -nfz * lateral, 0, nfz * forwardSpeed + nfx * lateral);

    // ── integrate ──
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.position.x = clamp(this.position.x, WORLD_LIMITS.minX, WORLD_LIMITS.maxX);
    this.position.z = clamp(this.position.z, WORLD_LIMITS.minZ, WORLD_LIMITS.maxZ);

    this.collide(world);

    // ── visuals ──
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
          this.applyDamage(impact * 1.5);
          this.lastImpactSpeed = impact;
        }
      }
    }
  }

  lastImpactSpeed = 0;

  private updateVisual(dt: number, forwardSpeed: number): void {
    this.group.position.set(this.position.x, 0, this.position.z);
    this.group.rotation.y = this.yaw;

    // Body attitude from acceleration and cornering load.
    const accel = (forwardSpeed - this.lastSpeed) / Math.max(dt, 0.0001);
    const targetPitch = clamp(-accel * 0.006, -0.06, 0.06);
    const targetRoll = clamp(this.lateralSpeed * 0.012, -0.09, 0.09);
    this.pitch = damp(this.pitch, targetPitch, 6, dt);
    this.roll = damp(this.roll, targetRoll, 6, dt);
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
      if (mesh.geometry) mesh.geometry.dispose();
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
        a.lastImpactSpeed = Math.max(a.lastImpactSpeed, impact);
        b.lastImpactSpeed = Math.max(b.lastImpactSpeed, impact);
      }
    }
  }
}
