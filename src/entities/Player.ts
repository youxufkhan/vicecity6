import * as THREE from 'three';
import type { CollisionWorld } from '../systems/Collision';
import { clamp, clamp01, damp } from '../core/MathUtil';
import type { Vehicle } from './Vehicle';

const SKIN = '#c98d63';
const SHIRT = '#1fb6a6';
const JEANS = '#2b3b62';
const SHOES = '#1b1d22';

function limb(w: number, h: number, d: number, color: string): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.82, metalness: 0.03 }),
  );
  mesh.castShadow = true;
  return mesh;
}

/** Third-person player character with a hand-animated walk cycle. */
export class Player {
  readonly group = new THREE.Group();
  readonly position = new THREE.Vector3();

  yaw = 0;
  velocity = new THREE.Vector3();
  health = 100;
  maxHealth = 100;
  armor = 0;
  money = 0;
  onFoot = true;
  vehicle: Vehicle | null = null;
  dead = false;
  invulnerable = 0;

  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private phase = 0;
  private bob = 0;
  private aimBlend = 0;
  private onGround = true;

  constructor() {
    const body = limb(0.46, 0.56, 0.27, SHIRT);
    body.position.y = 0.28;
    this.torso.add(body);
    this.torso.position.y = 1.0;
    this.hips.add(this.torso);

    const head = limb(0.26, 0.28, 0.26, SKIN);
    head.position.y = 0.7;
    this.torso.add(head);
    const hair = limb(0.29, 0.11, 0.29, '#241c18');
    hair.position.y = 0.83;
    this.torso.add(hair);

    const armGeo = limb(0.13, 0.54, 0.15, SKIN);
    armGeo.position.y = -0.27;
    this.armL.add(armGeo);
    this.armL.position.set(0.32, 0.5, 0);
    this.torso.add(this.armL);

    const armRGeo = limb(0.13, 0.54, 0.15, SKIN);
    armRGeo.position.y = -0.27;
    this.armR.add(armRGeo);
    this.armR.position.set(-0.32, 0.5, 0);
    this.torso.add(this.armR);

    const legGeo = limb(0.17, 0.86, 0.2, JEANS);
    legGeo.position.y = -0.43;
    this.legL.add(legGeo);
    this.legL.position.set(0.11, 0.88, 0);
    this.hips.add(this.legL);

    const legRGeo = limb(0.17, 0.86, 0.2, JEANS);
    legRGeo.position.y = -0.43;
    this.legR.add(legRGeo);
    this.legR.position.set(-0.11, 0.88, 0);
    this.hips.add(this.legR);

    const shoeGeo = limb(0.19, 0.12, 0.3, SHOES);
    shoeGeo.position.set(0, -0.86, 0.04);
    this.legL.add(shoeGeo);
    const shoeGeo2 = limb(0.19, 0.12, 0.3, SHOES);
    shoeGeo2.position.set(0, -0.86, 0.04);
    this.legR.add(shoeGeo2);

    this.group.add(this.hips);
    this.group.name = 'player';
  }

  get isDriving(): boolean {
    return this.vehicle !== null;
  }

  damage(amount: number): boolean {
    if (this.dead || this.invulnerable > 0) return false;
    let left = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, left * 0.65);
      this.armor -= absorbed;
      left -= absorbed;
    }
    this.health = Math.max(0, this.health - left);
    if (this.health <= 0) {
      this.dead = true;
      return true;
    }
    return false;
  }

  heal(amount: number): void {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  addArmor(amount: number): void {
    this.armor = Math.min(100, this.armor + amount);
  }

  /**
   * Move on foot. `moveX` / `moveY` are the local input axes,
   * `camYaw` is the camera heading used to rotate them.
   */
  updateOnFoot(dt: number, moveX: number, moveY: number, camYaw: number, running: boolean, world: CollisionWorld): void {
    const magnitude = Math.min(1, Math.hypot(moveX, moveY));
    const speed = running ? 6.6 : 3.1;

    let dirX = 0;
    let dirZ = 0;
    if (magnitude > 0.01) {
      // Rotate the local input into world space using the camera heading.
      // Forward is the direction the camera looks (away from the camera).
      const sin = Math.sin(camYaw);
      const cos = Math.cos(camYaw);
      dirX = moveX * cos - moveY * sin;
      dirZ = -moveX * sin - moveY * cos;
      const len = Math.hypot(dirX, dirZ) || 1;
      dirX /= len;
      dirZ /= len;
    }

    const targetX = dirX * speed * magnitude;
    const targetZ = dirZ * speed * magnitude;
    this.velocity.x = damp(this.velocity.x, targetX, 14, dt);
    this.velocity.z = damp(this.velocity.z, targetZ, 14, dt);

    // Jump / gravity.
    this.velocity.y -= 22 * dt;
    this.position.y += this.velocity.y * dt;
    if (this.position.y <= 0) {
      this.position.y = 0;
      this.velocity.y = 0;
      this.onGround = true;
    }

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    const hit = world.resolveCircle(this.position.x, this.position.z, 0.42);
    if (hit.hit) {
      this.position.x += hit.px;
      this.position.z += hit.pz;
      // Slide along the wall.
      const dot = this.velocity.x * hit.nx + this.velocity.z * hit.nz;
      if (dot < 0) {
        this.velocity.x -= hit.nx * dot;
        this.velocity.z -= hit.nz * dot;
      }
    }

    if (magnitude > 0.05) {
      const targetYaw = Math.atan2(dirX, dirZ);
      const delta = Math.atan2(Math.sin(targetYaw - this.yaw), Math.cos(targetYaw - this.yaw));
      this.yaw += delta * Math.min(1, dt * 13);
    }

    this.animate(dt, Math.hypot(this.velocity.x, this.velocity.z), running);
  }

  jump(): void {
    if (this.onGround && this.onFoot) {
      this.velocity.y = 7.2;
      this.onGround = false;
    }
  }

  updateInVehicle(dt: number, vehicle: Vehicle): void {
    this.position.set(vehicle.position.x, 0, vehicle.position.z);
    this.yaw = vehicle.yaw;
    this.animate(dt, 0, false);
  }

  setAiming(aiming: boolean, dt: number): void {
    this.aimBlend = damp(this.aimBlend, aiming ? 1 : 0, 12, dt);
  }

  private animate(dt: number, speed: number, running: boolean): void {
    const normalized = clamp01(speed / (running ? 6.6 : 3.1));
    this.phase += dt * (4.4 + normalized * 5.6) * (normalized > 0.02 ? 1 : 0.18);

    const swing = Math.sin(this.phase) * 0.62 * normalized;
    const armSwing = Math.sin(this.phase) * 0.48 * normalized;

    this.legL.rotation.x = damp(this.legL.rotation.x, swing, 18, dt);
    this.legR.rotation.x = damp(this.legR.rotation.x, -swing, 18, dt);

    const aim = this.aimBlend;
    this.armL.rotation.x = damp(this.armL.rotation.x, -armSwing * (1 - aim) - aim * 1.35, 16, dt);
    this.armR.rotation.x = damp(this.armR.rotation.x, armSwing * (1 - aim) - aim * 1.35, 16, dt);
    this.armL.rotation.z = damp(this.armL.rotation.z, -aim * 0.22, 14, dt);
    this.armR.rotation.z = damp(this.armR.rotation.z, aim * 0.22, 14, dt);

    const bobTarget = Math.abs(Math.sin(this.phase)) * 0.045 * normalized;
    this.bob = damp(this.bob, bobTarget, 14, dt);

    this.hips.position.y = this.bob;
    this.hips.rotation.y = Math.sin(this.phase) * 0.05 * normalized;
    this.torso.rotation.y = -Math.sin(this.phase) * 0.09 * normalized;

    this.group.position.set(this.position.x, this.position.y, this.position.z);
    this.group.rotation.y = this.yaw;
    this.group.visible = !this.isDriving;
  }

  /** Place the player next to a vehicle when they get in or out. */
  placeBeside(vehicle: Vehicle, side: number): void {
    const fx = Math.sin(vehicle.yaw);
    const fz = Math.cos(vehicle.yaw);
    const rx = -fz;
    const rz = fx;
    const offset = vehicle.spec.width * 0.5 + 0.75;
    this.position.x = vehicle.position.x + rx * side * offset;
    this.position.z = vehicle.position.z + rz * side * offset;
    this.position.y = 0;
    this.velocity.set(0, 0, 0);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  get eyeHeight(): number {
    return 1.6;
  }

  get radius(): number {
    return 0.42;
  }

  clampHealth(): void {
    this.health = clamp(this.health, 0, this.maxHealth);
  }
}
