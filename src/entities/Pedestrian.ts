import * as THREE from 'three';
import { softMesh, kindForSize, type SoftKind } from '../core/Soft';
import type { CollisionWorld } from '../systems/Collision';
import type { Vehicle } from './Vehicle';
import { dist2D, rngFrom, type Rng } from '../core/MathUtil';

type PedState = 'walk' | 'flee' | 'stunned' | 'dead';

const SKIN_TONES = ['#f5d3b3', '#e8be96', '#d69e72', '#b37549', '#82502c', '#543018'];
const SHIRT_TONES = [
  '#ffffff',
  '#ff6b8b',
  '#20b2aa',
  '#3867d6',
  '#f39c12',
  '#2ecc71',
  '#9b59b6',
  '#f1c40f',
  '#1e272e',
  '#e84118',
  '#00cec9',
  '#fd79a8',
];
const PANTS_TONES = ['#273c75', '#353b48', '#718093', '#b8a88a', '#2d3436', '#f5f6fa', '#4b5563'];
const HAIR_TONES = ['#1a1716', '#3b2314', '#59381e', '#8a5024', '#d4af37', '#bca06c', '#71717a'];
const SHOE_TONES = ['#1e272e', '#e84118', '#3867d6', '#ffffff', '#2c3e50', '#8c7ae6'];
const PASTEL_TOPS = ['#ff9ebb', '#fbcfe8', '#a7f3d0', '#bae6fd', '#fef08a', '#e9d5ff', '#fed7aa', '#f43f5e', '#ffffff'];
const SHORTS_SKIRT_TONES = ['#ffffff', '#fbcfe8', '#38bdf8', '#fb7185', '#475569', '#e2e8f0', '#fbbf24', '#fdba74'];

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
  private crouchBlend = 0;
  private crouchTimer = 0;

  constructor(x: number, z: number, rng: Rng) {
    this.position.set(x, 0, z);
    this.rig = buildRig(rng);
    this.group.add(this.rig.group);
    this.group.position.set(x, 0, z);
    this.pathDir = rng.chance(0.5) ? 1 : -1;
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
  }

  get onPath(): boolean {
    return this.path !== null;
  }

  update(dt: number, world: CollisionWorld, blockCenters: { x: number; z: number }[], rng: Rng): void {
    if (this.state === 'dead') {
      this.deadTimer += dt;
      this.crouchBlend = 0;
      this.rig.torso.scale.set(1, 1, 1);
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

    if (running) {
      this.crouchTimer += dt;
      // Occasionally crouch / duck when fleeing from gunfire (every ~2.2s for ~0.8s)
      const cycle = (this.crouchTimer + this.speed * 1.2) % 2.2;
      const targetCrouch = cycle < 0.75 ? Math.sin((cycle / 0.75) * Math.PI) * 0.45 : 0;
      this.crouchBlend += (targetCrouch - this.crouchBlend) * Math.min(1, dt * 8);
    } else {
      this.crouchTimer = 0;
      this.crouchBlend = Math.max(0, this.crouchBlend - dt * 6);
    }

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

    // Base hip bounce plus crouch lowering
    const hipBounce = Math.abs(Math.sin(this.phase)) * (running ? 0.07 : 0.035);
    this.rig.hips.position.y = hipBounce - this.crouchBlend * 0.18;

    // Crouch ducking angle and slight torso compression
    this.rig.torso.rotation.x = this.crouchBlend * 0.35;
    this.rig.torso.scale.set(
      1 + this.crouchBlend * 0.06,
      1 - this.crouchBlend * 0.14,
      1 + this.crouchBlend * 0.06,
    );

    // Ducking arms protect head
    if (this.crouchBlend > 0.02) {
      this.rig.armL.rotation.x += this.crouchBlend * 0.5;
      this.rig.armR.rotation.x += this.crouchBlend * 0.5;
    }

    this.hitFlash = Math.max(0, this.hitFlash - dt);
    const tint = this.hitFlash > 0 ? 1 : 0;
    this.rig.torso.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat && mat.emissive) mat.emissive.setRGB(tint * 0.9, tint * 0.05, tint * 0.05);
      }
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
      if (mesh.geometry && !mesh.userData.sharedGeometry) mesh.geometry.dispose();
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

  const isFemale = rng.chance(0.40);

  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color(rng.pick(SKIN_TONES)), roughness: 0.85 });
  const shirt = new THREE.MeshStandardMaterial({
    color: new THREE.Color(isFemale ? rng.pick(PASTEL_TOPS) : rng.pick(SHIRT_TONES)),
    roughness: 0.85,
  });
  const bottomColor = isFemale ? rng.pick(SHORTS_SKIRT_TONES) : rng.pick(PANTS_TONES);
  const pants = new THREE.MeshStandardMaterial({ color: new THREE.Color(bottomColor), roughness: 0.88 });
  const shoeUpperMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(rng.pick(SHOE_TONES)), roughness: 0.75 });
  const shoeSoleMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#f0f2f5'), roughness: 0.85 });
  const beltMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#221c17'), roughness: 0.80 });
  const buckleMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#d4af37'), metalness: 0.75, roughness: 0.35 });

  const box = (w: number, h: number, d: number, mat: THREE.Material, kind: SoftKind = kindForSize(w, h, d)): THREE.Mesh =>
    softMesh(w, h, d, mat, kind);

  if (isFemale) {
    // ── Female Torso ──
    // Slightly narrower shoulders: 0.32 x 0.44 x 0.20
    const body = box(0.32, 0.44, 0.20, shirt);
    body.position.y = 0.24;
    torso.add(body);

    // Scoop / V-neck skin opening
    const neckline = box(0.10, 0.10, 0.04, skin);
    neckline.position.set(0, 0.40, 0.09);
    torso.add(neckline);

    // High-waist waistband / belt
    const waistband = box(0.33, 0.06, 0.21, pants);
    waistband.position.set(0, 0.05, 0);
    torso.add(waistband);

    // ── Head & Face ──
    const head = box(0.21, 0.23, 0.21, skin, 'round');
    head.position.y = 0.60;
    torso.add(head);

    // Nose
    const nose = box(0.035, 0.05, 0.04, skin);
    nose.position.set(0, 0.59, 0.11);
    torso.add(nose);

    // Female hair style: ponytail (0), bob (1), long waves (2)
    const hairTone = rng.pick(HAIR_TONES);
    const hairMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(hairTone), roughness: 0.9 });
    const hairStyle = rng.int(0, 2);

    if (hairStyle === 0) {
      // Ponytail
      const hairCrown = box(0.23, 0.10, 0.23, hairMat, 'round');
      hairCrown.position.set(0, 0.71, -0.01);
      const hairTie = box(0.06, 0.04, 0.06, shirt);
      hairTie.position.set(0, 0.72, -0.13);
      const ponytail = box(0.06, 0.22, 0.07, hairMat);
      ponytail.position.set(0, 0.63, -0.16);
      ponytail.rotation.x = -0.25;
      torso.add(hairCrown, hairTie, ponytail);
    } else if (hairStyle === 1) {
      // Sleek Bob cut
      const hairCrown = box(0.24, 0.10, 0.24, hairMat, 'round');
      hairCrown.position.set(0, 0.71, 0);
      const bobL = box(0.04, 0.22, 0.22, hairMat);
      bobL.position.set(0.11, 0.61, 0);
      const bobR = box(0.04, 0.22, 0.22, hairMat);
      bobR.position.set(-0.11, 0.61, 0);
      const bobBack = box(0.22, 0.20, 0.04, hairMat);
      bobBack.position.set(0, 0.62, -0.11);
      torso.add(hairCrown, bobL, bobR, bobBack);
    } else {
      // Long flowing waves
      const hairCrown = box(0.24, 0.10, 0.24, hairMat, 'round');
      hairCrown.position.set(0, 0.71, -0.01);
      const waveL = box(0.04, 0.34, 0.16, hairMat);
      waveL.position.set(0.11, 0.55, 0.03);
      const waveR = box(0.04, 0.34, 0.16, hairMat);
      waveR.position.set(-0.11, 0.55, 0.03);
      const cascade = box(0.22, 0.34, 0.04, hairMat);
      cascade.position.set(0, 0.54, -0.11);
      torso.add(hairCrown, waveL, waveR, cascade);
    }

    // Sunglasses (45% probability)
    if (rng.chance(0.45)) {
      const glassesGlass = new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.1, metalness: 0.85 });
      const glassesFrame = new THREE.MeshStandardMaterial({
        color: rng.chance(0.5) ? 0xd4af37 : 0x22262c,
        metalness: 0.7,
        roughness: 0.3,
      });
      const lenses = box(0.17, 0.045, 0.03, glassesGlass);
      lenses.position.set(0, 0.62, 0.11);
      const bridge = box(0.04, 0.02, 0.02, glassesFrame);
      bridge.position.set(0, 0.63, 0.11);
      torso.add(lenses, bridge);
    }

    torso.position.y = 0.96;
    hips.add(torso);

    // ── Female Arms (narrower shoulder position: 0.21) ──
    const armL = new THREE.Group();
    const sleeveL = box(0.09, 0.18, 0.10, shirt);
    sleeveL.position.y = -0.09;
    const handL = box(0.08, 0.28, 0.09, skin);
    handL.position.y = -0.32;
    armL.add(sleeveL, handL);
    armL.position.set(0.21, 0.44, 0);
    torso.add(armL);

    const armR = new THREE.Group();
    const sleeveR = box(0.09, 0.18, 0.10, shirt);
    sleeveR.position.y = -0.09;
    const handR = box(0.08, 0.28, 0.09, skin);
    handR.position.y = -0.32;
    armR.add(sleeveR, handR);
    armR.position.set(-0.21, 0.44, 0);
    torso.add(armR);

    // ── Female Lower Body (High-waist shorts or skirt) ──
    const isSkirt = rng.chance(0.5);
    if (isSkirt) {
      const skirt = box(0.35, 0.22, 0.23, pants);
      skirt.position.set(0, 0.80, 0);
      hips.add(skirt);
    }

    const legL = new THREE.Group();
    if (!isSkirt) {
      // High-waist shorts: upper leg has shorts color, lower leg is bare skin
      const shortsL = box(0.13, 0.22, 0.15, pants);
      shortsL.position.y = -0.11;
      const lowerLegL = box(0.11, 0.46, 0.13, skin);
      lowerLegL.position.y = -0.45;
      legL.add(shortsL, lowerLegL);
    } else {
      // Skirt: legs are skin
      const bareLegL = box(0.11, 0.66, 0.13, skin);
      bareLegL.position.y = -0.33;
      legL.add(bareLegL);
    }
    const shoeL = box(0.13, 0.08, 0.20, shoeUpperMat);
    shoeL.position.set(0, -0.71, 0.02);
    const soleL = box(0.13, 0.04, 0.21, shoeSoleMat);
    soleL.position.set(0, -0.77, 0.02);
    legL.add(shoeL, soleL);
    legL.position.set(0.09, 0.84, 0);
    hips.add(legL);

    const legR = new THREE.Group();
    if (!isSkirt) {
      const shortsR = box(0.13, 0.22, 0.15, pants);
      shortsR.position.y = -0.11;
      const lowerLegR = box(0.11, 0.46, 0.13, skin);
      lowerLegR.position.y = -0.45;
      legR.add(shortsR, lowerLegR);
    } else {
      const bareLegR = box(0.11, 0.66, 0.13, skin);
      bareLegR.position.y = -0.33;
      legR.add(bareLegR);
    }
    const shoeR = box(0.13, 0.08, 0.20, shoeUpperMat);
    shoeR.position.set(0, -0.71, 0.02);
    const soleR = box(0.13, 0.04, 0.21, shoeSoleMat);
    soleR.position.set(0, -0.77, 0.02);
    legR.add(shoeR, soleR);
    legR.position.set(-0.09, 0.84, 0);
    hips.add(legR);

    group.add(hips);
    return { group, hips, torso, armL, armR, legL, legR };
  }

  // ── Torso ──
  const body = box(0.38, 0.46, 0.22, shirt);
  body.position.y = 0.25;
  torso.add(body);

  // V-neck skin opening
  const vneck = box(0.12, 0.12, 0.04, skin);
  vneck.position.set(0, 0.42, 0.10);
  torso.add(vneck);

  // Belt & buckle
  const belt = box(0.39, 0.05, 0.23, beltMat);
  belt.position.set(0, 0.04, 0);
  torso.add(belt);
  const buckle = box(0.08, 0.05, 0.02, buckleMat);
  buckle.position.set(0, 0.04, 0.12);
  torso.add(buckle);

  // ── Head & Face ──
  const head = box(0.22, 0.24, 0.22, skin, 'round');
  head.position.y = 0.62;
  torso.add(head);

  // Nose bridge
  const nose = box(0.04, 0.06, 0.04, skin);
  nose.position.set(0, 0.61, 0.12);
  torso.add(nose);

  // Hair style variety
  const hairTone = rng.pick(HAIR_TONES);
  const hairMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(hairTone), roughness: 0.9 });
  const hairStyle = rng.int(0, 3);

  if (hairStyle === 0) {
    // Short crop with sideburns
    const hairTop = box(0.24, 0.08, 0.24, hairMat, 'round');
    hairTop.position.set(0, 0.74, 0);
    const sideburnL = box(0.03, 0.10, 0.10, hairMat);
    sideburnL.position.set(0.11, 0.63, 0.02);
    const sideburnR = box(0.03, 0.10, 0.10, hairMat);
    sideburnR.position.set(-0.11, 0.63, 0.02);
    torso.add(hairTop, sideburnL, sideburnR);
  } else if (hairStyle === 1) {
    // 80s volume pompadour
    const hairPomp = box(0.24, 0.14, 0.25, hairMat, 'round');
    hairPomp.position.set(0, 0.77, -0.01);
    torso.add(hairPomp);
  } else if (hairStyle === 2) {
    // Afro / round curls
    const afro = box(0.28, 0.16, 0.28, hairMat, 'round');
    afro.position.set(0, 0.75, 0);
    torso.add(afro);
  } else {
    // Baseball cap / sun visor
    const capColor = rng.pick(['#e74c3c', '#3498db', '#2ecc71', '#1e272e', '#f39c12']);
    const capMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(capColor), roughness: 0.85 });
    const capCrown = box(0.24, 0.08, 0.24, capMat);
    capCrown.position.set(0, 0.73, 0);
    const capBrim = box(0.20, 0.02, 0.12, capMat);
    capBrim.position.set(0, 0.70, 0.15);
    torso.add(capCrown, capBrim);
  }

  // Sunglasses (45% probability)
  if (rng.chance(0.45)) {
    const glassesGlass = new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.1, metalness: 0.85 });
    const glassesFrame = new THREE.MeshStandardMaterial({ color: rng.chance(0.5) ? 0xd4af37 : 0x22262c, metalness: 0.7, roughness: 0.3 });
    const lenses = box(0.18, 0.05, 0.03, glassesGlass);
    lenses.position.set(0, 0.64, 0.12);
    const bridge = box(0.04, 0.02, 0.02, glassesFrame);
    bridge.position.set(0, 0.65, 0.12);
    torso.add(lenses, bridge);
  }

  torso.position.y = 0.96;
  hips.add(torso);

  // ── Arms (properly matching short sleeves + skin forearms/hands) ──
  const armL = new THREE.Group();
  const sleeveL = box(0.11, 0.24, 0.12, shirt);
  sleeveL.position.y = -0.12;
  const handL = box(0.09, 0.24, 0.11, skin);
  handL.position.y = -0.36;
  armL.add(sleeveL, handL);
  armL.position.set(0.25, 0.46, 0);
  torso.add(armL);

  const armR = new THREE.Group();
  const sleeveR = box(0.11, 0.24, 0.12, shirt);
  sleeveR.position.y = -0.12;
  const handR = box(0.09, 0.24, 0.11, skin);
  handR.position.y = -0.36;
  armR.add(sleeveR, handR);
  armR.position.set(-0.25, 0.46, 0);
  torso.add(armR);

  // ── Legs with detailed pants + retro sneakers ──
  const legL = new THREE.Group();
  const pantsL = box(0.14, 0.66, 0.16, pants);
  pantsL.position.y = -0.33;
  const shoeL = box(0.15, 0.10, 0.22, shoeUpperMat);
  shoeL.position.set(0, -0.71, 0.02);
  const soleL = box(0.15, 0.04, 0.23, shoeSoleMat);
  soleL.position.set(0, -0.77, 0.02);
  legL.add(pantsL, shoeL, soleL);
  legL.position.set(0.1, 0.84, 0);
  hips.add(legL);

  const legR = new THREE.Group();
  const pantsR = box(0.14, 0.66, 0.16, pants);
  pantsR.position.y = -0.33;
  const shoeR = box(0.15, 0.10, 0.22, shoeUpperMat);
  shoeR.position.set(0, -0.71, 0.02);
  const soleR = box(0.15, 0.04, 0.23, shoeSoleMat);
  soleR.position.set(0, -0.77, 0.02);
  legR.add(pantsR, shoeR, soleR);
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

      // Gunfire and horns trigger panic explicitly; proximity alone is peaceful.
      if (ped.state !== 'dead' && ped.state !== 'stunned') {
        if (vehicles) {
          for (let v = 0; v < vehicles.length; v++) {
            const car = vehicles[v];
            if (Math.abs(car.forwardSpeed) < 4.0) continue;
            const carDist = dist2D(ped.position.x, ped.position.z, car.position.x, car.position.z);
            if (carDist < 3.8) {
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
