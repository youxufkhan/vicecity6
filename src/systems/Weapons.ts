import * as THREE from 'three';
import type { CollisionWorld } from './Collision';
import type { Effects } from './Effects';
import type { AudioSystem } from './Audio';
import type { Pedestrian } from '../entities/Pedestrian';
import type { FootCop } from '../entities/FootCop';
import type { Vehicle } from '../entities/Vehicle';
import { clamp01 } from '../core/MathUtil';

export type WeaponId = 'unarmed' | 'pistol' | 'smg' | 'shotgun';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  icon: string;
  damage: number;
  /** Rounds per minute. */
  rpm: number;
  spread: number;
  pellets: number;
  range: number;
  magazine: number;
  reserve: number;
  automatic: boolean;
  /** Camera kick per shot, radians (pitch). */
  recoil: number;
  /** Seconds to reload. */
  reloadTime: number;
  /** Spread added per shot (decays when not firing). */
  bloom: number;
  price: number;
  /** Heat added when a shot is fired in public. */
  heat: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  unarmed: {
    id: 'unarmed',
    name: 'UNARMED',
    icon: '✊',
    damage: 6,
    rpm: 120,
    spread: 0.02,
    pellets: 1,
    range: 2.2,
    magazine: 0,
    reserve: 0,
    automatic: false,
    recoil: 0,
    reloadTime: 0,
    bloom: 0,
    price: 0,
    heat: 0.02,
  },
  pistol: {
    id: 'pistol',
    name: 'PISTOL',
    icon: '🔫',
    damage: 26,
    rpm: 320,
    spread: 0.012,
    pellets: 1,
    range: 90,
    magazine: 12,
    reserve: 48,
    automatic: false,
    recoil: 0.022,
    reloadTime: 1.3,
    bloom: 0.012,
    price: 0,
    heat: 0.14,
  },
  smg: {
    id: 'smg',
    name: 'MICRO SMG',
    icon: '🔫',
    damage: 17,
    rpm: 780,
    spread: 0.035,
    pellets: 1,
    range: 70,
    magazine: 30,
    reserve: 120,
    automatic: true,
    recoil: 0.012,
    reloadTime: 1.9,
    bloom: 0.006,
    price: 2500,
    heat: 0.05,
  },
  shotgun: {
    id: 'shotgun',
    name: 'PUMP SHOTGUN',
    icon: '🔫',
    damage: 13,
    rpm: 75,
    spread: 0.075,
    pellets: 8,
    range: 34,
    magazine: 6,
    reserve: 24,
    automatic: false,
    recoil: 0.07,
    reloadTime: 2.2,
    bloom: 0,
    price: 4000,
    heat: 0.2,
  },
};

export interface HitResult {
  hit: boolean;
  distance: number;
  x: number;
  y: number;
  z: number;
  kind: 'none' | 'building' | 'ped' | 'cop' | 'vehicle' | 'ground';
  ped?: Pedestrian;
  cop?: FootCop;
  vehicle?: Vehicle;
}

export interface WeaponContext {
  world: CollisionWorld;
  peds: Pedestrian[];
  cops: FootCop[];
  vehicles: Vehicle[];
  effects: Effects;
  audio: AudioSystem;
  playerPos: THREE.Vector3;
  aimOrigin: THREE.Vector3;
  aimDir: THREE.Vector3;
  onPedHit(ped: Pedestrian, damage: number, killed: boolean): void;
  onCopHit(cop: FootCop, damage: number, killed: boolean): void;
  onVehicleHit(vehicle: Vehicle, damage: number): void;
  onShot(weapon: WeaponDef): void;
}

/** Player weapon handling: aiming, firing, reloading, pickups. */
export class WeaponSystem {
  current: WeaponId = 'unarmed';
  readonly ammo: Record<WeaponId, number> = {
    unarmed: 0,
    pistol: WEAPONS.pistol.reserve,
    smg: 0,
    shotgun: 0,
  };
  readonly owned = new Set<WeaponId>(['unarmed']);
  private cooldown = 0;
  private reloading = 0;
  private magazine: Record<WeaponId, number> = { unarmed: 0, pistol: 0, smg: 0, shotgun: 0 };
  aiming = false;
  /** 0..1 how fast the player is moving; moving makes shots less accurate. */
  moveFactor = 0;
  /** Extra spread from sustained fire, decays between shots. */
  private bloomNow = 0;
  /** Camera kick accumulated by shots; the game drains it into the camera. */
  readonly kick = { pitch: 0, yaw: 0 };
  /** Seconds the hit marker stays lit, and whether the hit was a kill/headshot. */
  hitMarker = 0;
  lastHitKill = false;
  lastHeadshot = false;
  shotsFired = 0;

  constructor(private ctx: WeaponContext) {}

  get def(): WeaponDef {
    return WEAPONS[this.current];
  }

  get inMagazine(): number {
    return this.magazine[this.current];
  }

  get reserveAmmo(): number {
    return this.ammo[this.current];
  }

  get isReloading(): boolean {
    return this.reloading > 0;
  }

  give(weapon: WeaponId, rounds = -1): void {
    this.owned.add(weapon);
    if (rounds >= 0) {
      this.ammo[weapon] = rounds;
      this.magazine[weapon] = WEAPONS[weapon].magazine;
    }
    this.select(weapon);
  }

  select(weapon: WeaponId): void {
    if (!this.owned.has(weapon)) return;
    if (this.current === weapon) return;
    this.current = weapon;
    this.reloading = 0;
    this.ctx.audio.play('reload');
  }

  cycleWeapon(): void {
    const list = [...this.owned];
    const index = list.indexOf(this.current);
    this.select(list[(index + 1) % list.length]);
  }

  update(dt: number, wantFire: boolean, wantReload: boolean): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.bloomNow = Math.max(0, this.bloomNow - dt * 0.35);
    this.hitMarker = Math.max(0, this.hitMarker - dt);

    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const def = this.def;
        const need = def.magazine - this.magazine[def.id];
        const take = Math.min(need, this.ammo[def.id]);
        this.magazine[def.id] += take;
        this.ammo[def.id] -= take;
      }
      return;
    }

    if (wantReload) this.reload();
    if (!wantFire || this.reloading > 0 || this.cooldown > 0) return;

    const def = this.def;
    if (def.id === 'unarmed') {
      this.cooldown = 60 / def.rpm;
      this.fire();
      return;
    }
    if (this.magazine[def.id] <= 0) {
      this.reload();
      return;
    }
    this.cooldown = 60 / def.rpm;
    this.magazine[def.id] -= 1;
    this.fire();
  }

  reload(): void {
    const def = this.def;
    if (def.id === 'unarmed' || this.reloading > 0) return;
    if (this.magazine[def.id] >= def.magazine) return;
    if (this.ammo[def.id] <= 0) return;
    this.reloading = def.reloadTime;
    this.ctx.audio.play('reload');
  }

  /** Current cone half-angle: base spread, wider from the hip, moving and sustained fire. */
  get currentSpread(): number {
    const def = this.def;
    const stance = this.aiming ? 1 : 1.9;
    return def.spread * stance * (1 + this.moveFactor * 1.2) + this.bloomNow;
  }

  private fire(): void {
    const def = this.def;
    const ctx = this.ctx;
    const sound = def.id === 'unarmed' ? 'punch' : def.id === 'shotgun' ? 'shotgun' : def.id === 'smg' ? 'smg' : 'pistol';
    ctx.audio.play(sound);
    this.shotsFired++;

    const baseDir = ctx.aimDir.clone().normalize();
    // Barrel position: a little ahead of the aim origin so tracers leave the gun, not the chest.
    const muzzle = ctx.aimOrigin.clone().addScaledVector(baseDir, def.id === 'unarmed' ? 0 : 0.7);
    // Perpendicular basis for the spread cone.
    const up = Math.abs(baseDir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(baseDir, up).normalize();
    const lift = new THREE.Vector3().crossVectors(side, baseDir).normalize();
    const spread = def.id === 'unarmed' ? def.spread : this.currentSpread;

    let anyHit = false;
    for (let p = 0; p < def.pellets; p++) {
      // Uniform disc sample: sqrt keeps pellets from clumping in the middle.
      const r = Math.sqrt(Math.random()) * spread;
      const a = Math.random() * Math.PI * 2;
      const dir = baseDir.clone().addScaledVector(side, Math.cos(a) * r).addScaledVector(lift, Math.sin(a) * r).normalize();
      const hit = this.hitscan(ctx.aimOrigin, dir, def.range);
      const end = new THREE.Vector3(
        ctx.aimOrigin.x + dir.x * hit.distance,
        ctx.aimOrigin.y + dir.y * hit.distance,
        ctx.aimOrigin.z + dir.z * hit.distance,
      );
      if (def.id !== 'unarmed') ctx.effects.tracer(muzzle.x, muzzle.y, muzzle.z, end.x, end.y, end.z);

      // Damage falls off past a third of the range; head shots hurt, leg shots less.
      const falloff = 1 - 0.55 * clamp01((hit.distance - def.range * 0.33) / (def.range * 0.67));
      const zone = hit.y > 1.5 ? 2.4 : hit.y < 0.75 ? 0.8 : 1;
      const dmg = def.damage * falloff * zone;
      const head = zone > 1;

      if (hit.kind === 'ped' && hit.ped) {
        const killed = hit.ped.damage(dmg);
        ctx.effects.blood(end.x, end.y, end.z);
        ctx.onPedHit(hit.ped, dmg, killed);
        this.markHit(killed, head);
        anyHit = true;
      } else if (hit.kind === 'cop' && hit.cop) {
        const killed = hit.cop.damage(dmg);
        ctx.effects.blood(end.x, end.y, end.z);
        ctx.onCopHit(hit.cop, dmg, killed);
        this.markHit(killed, head);
        anyHit = true;
      } else if (hit.kind === 'vehicle' && hit.vehicle) {
        const vd = def.damage * falloff * 0.7;
        hit.vehicle.applyDamage(vd);
        ctx.effects.sparks(end.x, end.y, end.z, 6);
        ctx.onVehicleHit(hit.vehicle, vd);
      } else if (hit.kind === 'building') {
        ctx.effects.sparks(end.x, end.y, end.z, 5, new THREE.Color(0.8, 0.75, 0.6));
      } else if (hit.kind === 'ground') {
        ctx.effects.sparks(end.x, 0.05, end.z, 4, new THREE.Color(0.55, 0.5, 0.42));
      }
    }
    void anyHit;

    // Recoil: mostly up, a little sideways, then the spread blooms.
    this.kick.pitch += def.recoil * (0.8 + Math.random() * 0.4);
    this.kick.yaw += (Math.random() - 0.5) * def.recoil * 0.7;
    this.bloomNow = Math.min(0.12, this.bloomNow + def.bloom);

    ctx.effects.muzzleFlash(muzzle.x, muzzle.y, muzzle.z, baseDir.x, baseDir.z);
    ctx.onShot(def);
  }

  private markHit(killed: boolean, head: boolean): void {
    this.hitMarker = 0.18;
    this.lastHitKill = killed;
    this.lastHeadshot = head;
  }

  /** Closest hit along a ray. */
  hitscan(origin: THREE.Vector3, dir: THREE.Vector3, range: number): HitResult {
    const ctx = this.ctx;
    let best: HitResult = { hit: false, distance: range, x: 0, y: 0, z: 0, kind: 'none' };

    // Buildings.
    const wall = ctx.world.raycast(origin.x, origin.z, origin.x + dir.x * range, origin.z + dir.z * range, 0.4);
    if (wall.hit) {
      best = {
        hit: true,
        distance: range * wall.t,
        x: wall.x,
        y: origin.y,
        z: wall.z,
        kind: 'building',
      };
    }

    // Pedestrians (vertical cylinders).
    for (const ped of ctx.peds) {
      if (ped.state === 'dead') continue;
      const dx = ped.position.x - origin.x;
      const dz = ped.position.z - origin.z;
      const along = dx * dir.x + dz * dir.z;
      if (along < 0 || along > best.distance) continue;
      const lateral = Math.abs(-dx * dir.z + dz * dir.x);
      if (lateral > 0.55) continue;
      const height = origin.y + dir.y * along;
      if (height > 1.9 || height < -0.2) continue;
      best = {
        hit: true,
        distance: along,
        x: origin.x + dir.x * along,
        y: height,
        z: origin.z + dir.z * along,
        kind: 'ped',
        ped,
      };
    }

    // Officers on foot (vertical cylinders).
    for (const cop of ctx.cops) {
      if (!cop.alive) continue;
      const dx = cop.position.x - origin.x;
      const dz = cop.position.z - origin.z;
      const along = dx * dir.x + dz * dir.z;
      if (along < 0 || along > best.distance) continue;
      const lateral = Math.abs(-dx * dir.z + dz * dir.x);
      if (lateral > 0.55) continue;
      const height = origin.y + dir.y * along;
      if (height > 1.9 || height < -0.2) continue;
      best = {
        hit: true,
        distance: along,
        x: origin.x + dir.x * along,
        y: height,
        z: origin.z + dir.z * along,
        kind: 'cop',
        cop,
      };
    }

    // Vehicles: ray against the car's oriented box (slab test in the car's frame).
    for (const vehicle of ctx.vehicles) {
      if (vehicle.wrecked) continue;
      const t = rayVsCar(origin, dir, vehicle, best.distance);
      if (t === null) continue;
      best = {
        hit: true,
        distance: t,
        x: origin.x + dir.x * t,
        y: origin.y + dir.y * t,
        z: origin.z + dir.z * t,
        kind: 'vehicle',
        vehicle,
      };
    }

    // Ground: a downward ray that reaches y=0 before anything else.
    if (dir.y < -0.001) {
      const tg = -origin.y / dir.y;
      if (tg > 0 && tg < best.distance) {
        best = { hit: true, distance: tg, x: origin.x + dir.x * tg, y: 0, z: origin.z + dir.z * tg, kind: 'ground' };
      }
    }

    return best;
  }

  /** 0..1 how close the crosshair is to a target (for the HUD). */
  crosshairHeat(): number {
    return clamp01(this.aiming ? 1 : 0);
  }
}

/** Distance along the ray to a car's box (length x width x ~1.5 m tall), or null. */
function rayVsCar(o: THREE.Vector3, d: THREE.Vector3, car: Vehicle, maxT: number): number | null {
  const sy = Math.sin(car.yaw);
  const cy = Math.cos(car.yaw);
  const ox = o.x - car.position.x;
  const oz = o.z - car.position.z;
  // Car frame: x = right (-cos, sin), z = forward (sin, cos).
  const lox = -ox * cy + oz * sy;
  const loz = ox * sy + oz * cy;
  const ldx = -d.x * cy + d.z * sy;
  const ldz = d.x * sy + d.z * cy;
  const min = [-car.spec.width / 2, 0.15, -car.spec.length / 2];
  const max = [car.spec.width / 2, 1.5, car.spec.length / 2];
  const lo = [lox, o.y, loz];
  const ld = [ldx, d.y, ldz];
  let t0 = 0;
  let t1 = maxT;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(ld[k]) < 1e-8) {
      if (lo[k] < min[k] || lo[k] > max[k]) return null;
      continue;
    }
    let a = (min[k] - lo[k]) / ld[k];
    let b = (max[k] - lo[k]) / ld[k];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0 < maxT ? t0 : null;
}
