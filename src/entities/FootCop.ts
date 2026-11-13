import * as THREE from 'three';
import type { CollisionWorld } from '../systems/Collision';
import { angleDelta, clamp, dist2D, damp } from '../core/MathUtil';

const UNIFORM = '#1d2b4a';
const UNIFORM_DARK = '#141d33';
const SKIN = '#c98d63';

function box(w: number, h: number, d: number, color: string): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.8 }),
  );
  mesh.castShadow = true;
  return mesh;
}

/**
 * An officer on foot. Officers are what make the heat visible: they hunt the
 * player down on the street, take aim and open fire.
 */
export class FootCop {
  readonly group = new THREE.Group();
  readonly position = new THREE.Vector3();
  yaw = 0;
  health = 100;
  alive = true;
  deadTimer = 0;
  fireTimer = 1.2;
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private phase = 0;
  private aim = 0;

  constructor(x: number, z: number) {
    this.position.set(x, 0, z);
    this.group.position.set(x, 0, z);

    const hips = new THREE.Group();
    this.group.add(hips);

    const torso = box(0.48, 0.62, 0.28, UNIFORM);
    torso.position.y = 1.15;
    hips.add(torso);

    const vest = box(0.50, 0.28, 0.31, UNIFORM_DARK);
    vest.position.y = 1.25;
    hips.add(vest);

    // Reflective white POLICE markings
    const patchFront = box(0.24, 0.06, 0.02, '#f8fafc');
    patchFront.position.set(-0.08, 1.28, -0.16);
    hips.add(patchFront);

    const patchBack = box(0.32, 0.08, 0.02, '#f8fafc');
    patchBack.position.set(0, 1.28, 0.16);
    hips.add(patchBack);

    // Gold police badge
    const badge = box(0.09, 0.11, 0.04, '#ffd45e');
    badge.position.set(0.14, 1.30, -0.165);
    hips.add(badge);

    // Radio mic on shoulder
    const radio = box(0.06, 0.08, 0.06, '#11141a');
    radio.position.set(0.18, 1.44, -0.06);
    hips.add(radio);

    // Tactical duty belt & gear
    const belt = box(0.51, 0.09, 0.31, '#0e1117');
    belt.position.set(0, 0.88, 0);
    hips.add(belt);

    const holster = box(0.08, 0.14, 0.10, '#161a22');
    holster.position.set(-0.25, 0.86, 0.02);
    hips.add(holster);

    const pouch = box(0.10, 0.10, 0.07, '#161a22');
    pouch.position.set(0.25, 0.88, 0.02);
    hips.add(pouch);

    // Head
    const head = box(0.25, 0.26, 0.25, SKIN);
    head.position.y = 1.6;
    hips.add(head);

    // Aviator sunglasses
    const glasses = box(0.24, 0.07, 0.05, '#0d1117');
    glasses.position.set(0, 1.62, -0.13);
    hips.add(glasses);

    const glassBar = box(0.25, 0.015, 0.04, '#eab308');
    glassBar.position.set(0, 1.65, -0.13);
    hips.add(glassBar);

    // Police Cap with peak and crest
    const cap = box(0.29, 0.11, 0.29, '#0d1526');
    cap.position.y = 1.74;
    hips.add(cap);

    const capBadge = box(0.05, 0.06, 0.02, '#ffd45e');
    capBadge.position.set(0, 1.75, -0.15);
    hips.add(capBadge);

    const brim = box(0.27, 0.04, 0.15, '#05070d');
    brim.position.set(0, 1.70, -0.19);
    brim.rotation.x = 0.08;
    hips.add(brim);

    // Legs with heavy service boots
    const legGeo = box(0.17, 0.82, 0.20, UNIFORM_DARK);
    legGeo.position.y = -0.41;
    this.legL.add(legGeo);
    const bootL = box(0.18, 0.14, 0.28, '#090c12');
    bootL.position.set(0, -0.82, 0.03);
    this.legL.add(bootL);
    this.legL.position.set(0.11, 0.84, 0);
    hips.add(this.legL);

    const legRGeo = box(0.17, 0.82, 0.20, UNIFORM_DARK);
    legRGeo.position.y = -0.41;
    this.legR.add(legRGeo);
    const bootR = box(0.18, 0.14, 0.28, '#090c12');
    bootR.position.set(0, -0.82, 0.03);
    this.legR.add(bootR);
    this.legR.position.set(-0.11, 0.84, 0);
    hips.add(this.legR);

    // Arms
    const armGeo = box(0.13, 0.52, 0.15, UNIFORM);
    armGeo.position.y = -0.26;
    this.armL.add(armGeo);
    this.armL.position.set(0.31, 1.4, 0);
    hips.add(this.armL);

    const armRGeo = box(0.13, 0.52, 0.15, UNIFORM);
    armRGeo.position.y = -0.26;
    this.armR.add(armRGeo);
    this.armR.position.set(-0.31, 1.4, 0);
    hips.add(this.armR);

    // Sidearm service pistol with slide and barrel
    const gun = box(0.065, 0.09, 0.28, '#12151b');
    gun.position.set(0, -0.52, -0.18);
    this.armR.add(gun);

    const gunBarrel = box(0.045, 0.045, 0.06, '#080a0f');
    gunBarrel.position.set(0, -0.50, -0.32);
    this.armR.add(gunBarrel);
  }

  damage(amount: number): boolean {
    if (!this.alive) return false;
    this.health -= amount;
    if (this.health <= 0) {
      this.alive = false;
      this.group.rotation.x = -Math.PI / 2;
      this.group.position.y = 0.4;
      return true;
    }
    return false;
  }

  /**
   * Hunt the player. Returns the damage dealt to the player this frame
   * (0 when the officer did not get a shot off).
   */
  update(
    dt: number,
    world: CollisionWorld,
    playerPos: THREE.Vector3,
    effects: { tracer: (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => void; sparks: (x: number, y: number, z: number, n: number) => void },
  ): number {
    if (!this.alive) {
      this.deadTimer += dt;
      return 0;
    }

    const dx = playerPos.x - this.position.x;
    const dz = playerPos.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    const targetYaw = Math.atan2(dx, dz);
    const diff = angleDelta(this.yaw, targetYaw);
    this.yaw += diff * Math.min(1, dt * 6);

    // Close the distance, but stop at firing range.
    const wantDist = 11;
    let moveSpeed = 0;
    if (dist > wantDist) {
      moveSpeed = 3.6;
      const nx = dx / (dist || 1);
      const nz = dz / (dist || 1);
      const px = this.position.x + nx * moveSpeed * dt;
      const pz = this.position.z + nz * moveSpeed * dt;
      if (!world.overlaps(px, pz, 0.45)) {
        this.position.x = px;
        this.position.z = pz;
      }
    } else {
      // Strafe a little so they are not static targets.
      this.position.x += Math.cos(this.yaw * 1.7) * dt * 1.4;
      this.position.z -= Math.sin(this.yaw * 1.7) * dt * 1.4;
    }

    // Aiming and firing.
    this.aim = damp(this.aim, dist < 26 ? 1 : 0, 6, dt);
    this.fireTimer -= dt;
    let damage = 0;
    if (this.fireTimer <= 0 && dist < 26 && this.aim > 0.5) {
      this.fireTimer = 1.1 + Math.random() * 0.8;
      const muzzleY = 1.35;
      const hit = Math.random() < clamp(0.55 - dist * 0.012, 0.12, 0.5);
      const endX = hit ? playerPos.x : playerPos.x + (Math.random() - 0.5) * 6;
      const endZ = hit ? playerPos.z : playerPos.z + (Math.random() - 0.5) * 6;
      effects.tracer(
        this.position.x + Math.sin(this.yaw) * 0.5,
        muzzleY,
        this.position.z + Math.cos(this.yaw) * 0.5,
        endX,
        1.2,
        endZ,
      );
      if (hit) damage = 5 + Math.random() * 5;
    }

    // Animation.
    this.phase += dt * (moveSpeed > 0 ? 8 : 2);
    const swing = Math.sin(this.phase) * (moveSpeed > 0 ? 0.7 : 0.08);
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = -swing * 0.6;
    this.armR.rotation.x = damp(this.armR.rotation.x, -1.45 * this.aim, 10, dt);
    this.group.position.set(this.position.x, 0, this.position.z);
    this.group.rotation.y = this.yaw;
    return damage;
  }

  distanceToPlayer(x: number, z: number): number {
    return dist2D(this.position.x, this.position.z, x, z);
  }

  dispose(): void {
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) (mesh.material as THREE.Material).dispose();
    });
  }
}

/** Keeps a small squad of officers on foot around the player. */
export class FootCopManager {
  readonly cops: FootCop[] = [];
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  spawn(x: number, z: number): FootCop {
    const cop = new FootCop(x, z);
    cop.group.userData.kind = 'cop';
    this.scene.add(cop.group);
    this.cops.push(cop);
    return cop;
  }

  /** Keep the number of officers in line with the wanted level. */
  maintain(count: number, playerX: number, playerZ: number): void {
    // Clean up dead officers that have lingered or cops that are too far away.
    for (let i = this.cops.length - 1; i >= 0; i--) {
      const cop = this.cops[i];
      const dist = cop.distanceToPlayer(playerX, playerZ);
      if ((!cop.alive && cop.deadTimer > 15) || dist > 190) {
        this.scene.remove(cop.group);
        cop.dispose();
        this.cops.splice(i, 1);
      }
    }

    const liveCount = this.cops.filter((c) => c.alive).length;
    while (liveCount < count && this.cops.length < count + 3) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 26 + Math.random() * 22;
      this.spawn(playerX + Math.cos(angle) * dist, playerZ + Math.sin(angle) * dist);
      break;
    }
    while (this.cops.length > count && this.cops.some((c) => !c.alive)) {
      const deadIdx = this.cops.findIndex((c) => !c.alive);
      if (deadIdx >= 0) {
        const cop = this.cops.splice(deadIdx, 1)[0];
        this.scene.remove(cop.group);
        cop.dispose();
      } else {
        break;
      }
    }
    while (this.cops.length > count + 2) {
      const cop = this.cops.pop();
      if (cop) {
        this.scene.remove(cop.group);
        cop.dispose();
      }
    }
  }

  clear(): void {
    for (const cop of this.cops) {
      this.scene.remove(cop.group);
      cop.dispose();
    }
    this.cops.length = 0;
  }
}
