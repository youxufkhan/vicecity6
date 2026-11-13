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

function buildPistol(): THREE.Group {
  const g = new THREE.Group();
  // Slide & barrel (two-tone steel)
  const slide = limb(0.065, 0.08, 0.28, '#1f242d');
  slide.position.set(0, 0.04, -0.09);
  g.add(slide);
  // Barrel bore
  const barrel = limb(0.045, 0.045, 0.06, '#0f1115');
  barrel.position.set(0, 0.04, -0.24);
  g.add(barrel);
  // Textured grip
  const grip = limb(0.055, 0.16, 0.09, '#4a3325');
  grip.position.set(0, -0.06, 0.01);
  grip.rotation.x = 0.22;
  g.add(grip);
  // Trigger guard
  const guard = limb(0.035, 0.06, 0.08, '#1f242d');
  guard.position.set(0, -0.02, -0.05);
  g.add(guard);
  // Sights
  const frontSight = limb(0.02, 0.025, 0.03, '#ffffff');
  frontSight.position.set(0, 0.085, -0.20);
  g.add(frontSight);
  return g;
}

function buildSmg(): THREE.Group {
  const g = new THREE.Group();
  // Receiver
  const receiver = limb(0.08, 0.11, 0.36, '#181b22');
  receiver.position.set(0, 0.04, -0.08);
  g.add(receiver);
  // Barrel & shroud
  const barrel = limb(0.05, 0.05, 0.14, '#0f1216');
  barrel.position.set(0, 0.04, -0.28);
  g.add(barrel);
  // Extended magazine
  const mag = limb(0.045, 0.22, 0.065, '#262a33');
  mag.position.set(0, -0.10, 0.02);
  mag.rotation.x = 0.15;
  g.add(mag);
  // Grip
  const grip = limb(0.06, 0.15, 0.09, '#181b22');
  grip.position.set(0, -0.06, 0.01);
  grip.rotation.x = 0.22;
  g.add(grip);
  // Stock
  const stock = limb(0.07, 0.08, 0.16, '#333a44');
  stock.position.set(0, 0.03, 0.16);
  g.add(stock);
  return g;
}

function buildShotgun(): THREE.Group {
  const g = new THREE.Group();
  // Long blued steel barrel
  const barrel = limb(0.06, 0.06, 0.65, '#1e232a');
  barrel.position.set(0, 0.05, -0.24);
  g.add(barrel);
  // Under-barrel magazine tube
  const magTube = limb(0.055, 0.055, 0.52, '#252b34');
  magTube.position.set(0, 0.0, -0.18);
  g.add(magTube);
  // Pump slide
  const pump = limb(0.075, 0.08, 0.18, '#5c3924');
  pump.position.set(0, 0.01, -0.26);
  g.add(pump);
  // Receiver
  const receiver = limb(0.075, 0.11, 0.22, '#181b22');
  receiver.position.set(0, 0.03, 0.1);
  g.add(receiver);
  // Stock
  const stock = limb(0.065, 0.13, 0.32, '#5c3924');
  stock.position.set(0, -0.04, 0.34);
  stock.rotation.x = -0.12;
  g.add(stock);
  return g;
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

  private pistolMesh: THREE.Group;
  private smgMesh: THREE.Group;
  private shotgunMesh: THREE.Group;

  constructor() {
    // Torso: tropical button-up shirt with open collar & undershirt
    const body = limb(0.48, 0.54, 0.28, SHIRT);
    body.position.y = 0.29;
    this.torso.add(body);

    // V-neck open collar flaps
    const collarL = limb(0.08, 0.22, 0.03, '#179686');
    collarL.position.set(0.11, 0.44, -0.145);
    collarL.rotation.z = 0.18;
    this.torso.add(collarL);

    const collarR = limb(0.08, 0.22, 0.03, '#179686');
    collarR.position.set(-0.11, 0.44, -0.145);
    collarR.rotation.z = -0.18;
    this.torso.add(collarR);

    // White undershirt & chest inset
    const undershirt = limb(0.14, 0.18, 0.02, '#f1f5f9');
    undershirt.position.set(0, 0.42, -0.14);
    this.torso.add(undershirt);

    const chestSkin = limb(0.10, 0.13, 0.02, SKIN);
    chestSkin.position.set(0, 0.47, -0.142);
    this.torso.add(chestSkin);

    // Leather belt with gold buckle
    const belt = limb(0.49, 0.08, 0.29, '#3a271c');
    belt.position.set(0, 0.04, 0);
    this.torso.add(belt);

    const buckle = limb(0.11, 0.09, 0.04, '#d4af37');
    buckle.position.set(0, 0.04, -0.15);
    this.torso.add(buckle);

    this.torso.position.y = 1.0;
    this.hips.add(this.torso);

    // Head
    const head = limb(0.25, 0.27, 0.25, SKIN);
    head.position.y = 0.7;
    this.torso.add(head);

    // Aviator sunglasses
    const shades = limb(0.24, 0.08, 0.05, '#0e121a');
    shades.position.set(0, 0.72, -0.13);
    this.torso.add(shades);

    const browBar = limb(0.25, 0.02, 0.04, '#eab308');
    browBar.position.set(0, 0.76, -0.13);
    this.torso.add(browBar);

    // Layered 80s hairstyle
    const hair = limb(0.28, 0.12, 0.28, '#241c18');
    hair.position.set(0, 0.84, -0.01);
    this.torso.add(hair);

    const sideburnL = limb(0.04, 0.16, 0.14, '#241c18');
    sideburnL.position.set(0.135, 0.73, 0.02);
    this.torso.add(sideburnL);

    const sideburnR = limb(0.04, 0.16, 0.14, '#241c18');
    sideburnR.position.set(-0.135, 0.73, 0.02);
    this.torso.add(sideburnR);

    // Arms
    // Left arm: sleeve + forearm + wristwatch + hand
    const sleeveL = limb(0.14, 0.18, 0.16, SHIRT);
    sleeveL.position.y = -0.09;
    this.armL.add(sleeveL);

    const armLGeo = limb(0.12, 0.34, 0.13, SKIN);
    armLGeo.position.y = -0.32;
    this.armL.add(armLGeo);

    const watch = limb(0.135, 0.045, 0.145, '#d4af37');
    watch.position.set(0, -0.45, 0);
    this.armL.add(watch);

    const handL = limb(0.10, 0.10, 0.12, SKIN);
    handL.position.set(0, -0.52, 0);
    this.armL.add(handL);

    this.armL.position.set(0.32, 0.5, 0);
    this.torso.add(this.armL);

    // Right arm: sleeve + forearm + hand + visible weapon mount
    const sleeveR = limb(0.14, 0.18, 0.16, SHIRT);
    sleeveR.position.y = -0.09;
    this.armR.add(sleeveR);

    const armRGeo = limb(0.12, 0.34, 0.13, SKIN);
    armRGeo.position.y = -0.32;
    this.armR.add(armRGeo);

    const handR = limb(0.10, 0.10, 0.12, SKIN);
    handR.position.set(0, -0.52, 0);
    this.armR.add(handR);

    // Weapons attached to right hand
    this.pistolMesh = buildPistol();
    this.pistolMesh.position.set(0, -0.52, -0.08);
    this.armR.add(this.pistolMesh);

    this.smgMesh = buildSmg();
    this.smgMesh.position.set(0, -0.52, -0.08);
    this.smgMesh.visible = false;
    this.armR.add(this.smgMesh);

    this.shotgunMesh = buildShotgun();
    this.shotgunMesh.position.set(0, -0.52, -0.08);
    this.shotgunMesh.visible = false;
    this.armR.add(this.shotgunMesh);

    this.armR.position.set(-0.32, 0.5, 0);
    this.torso.add(this.armR);

    // Legs
    const legGeo = limb(0.17, 0.84, 0.20, JEANS);
    legGeo.position.y = -0.42;
    this.legL.add(legGeo);
    this.legL.position.set(0.11, 0.88, 0);
    this.hips.add(this.legL);

    const legRGeo = limb(0.17, 0.84, 0.20, JEANS);
    legRGeo.position.y = -0.42;
    this.legR.add(legRGeo);
    this.legR.position.set(-0.11, 0.88, 0);
    this.hips.add(this.legR);

    // Retro sneakers with white outsoles
    const soleL = limb(0.19, 0.05, 0.30, '#f8fafc');
    soleL.position.set(0, -0.87, 0.04);
    this.legL.add(soleL);

    const shoeL = limb(0.18, 0.10, 0.28, SHOES);
    shoeL.position.set(0, -0.80, 0.04);
    this.legL.add(shoeL);

    const soleR = limb(0.19, 0.05, 0.30, '#f8fafc');
    soleR.position.set(0, -0.87, 0.04);
    this.legR.add(soleR);

    const shoeR = limb(0.18, 0.10, 0.28, SHOES);
    shoeR.position.set(0, -0.80, 0.04);
    this.legR.add(shoeR);

    this.group.add(this.hips);
    this.group.name = 'player';
  }

  setWeapon(weapon: string): void {
    this.pistolMesh.visible = weapon === 'pistol';
    this.smgMesh.visible = weapon === 'smg';
    this.shotgunMesh.visible = weapon === 'shotgun';
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
