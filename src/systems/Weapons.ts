import * as THREE from 'three';
import type { CollisionWorld } from './Collision';
import type { Effects } from './Effects';
import type { AudioSystem } from './Audio';
import type { Pedestrian } from '../entities/Pedestrian';
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
  recoil: number;
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
    recoil: 0.1,
    price: 0,
    heat: 0.35,
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
    recoil: 0.35,
    price: 0,
    heat: 0.45,
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
    recoil: 0.22,
    price: 2500,
    heat: 0.3,
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
    recoil: 0.9,
    price: 4000,
    heat: 0.6,
  },
};

export interface HitResult {
  hit: boolean;
  distance: number;
  x: number;
  y: number;
  z: number;
  kind: 'none' | 'building' | 'ped' | 'vehicle' | 'ground';
  ped?: Pedestrian;
  vehicle?: Vehicle;
}

export interface WeaponContext {
  world: CollisionWorld;
  peds: Pedestrian[];
  vehicles: Vehicle[];
  effects: Effects;
  audio: AudioSystem;
  playerPos: THREE.Vector3;
  aimOrigin: THREE.Vector3;
  aimDir: THREE.Vector3;
  onPedHit(ped: Pedestrian, damage: number, killed: boolean): void;
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
    if (!wantFire) return;

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
    if (this.cooldown > 0) return;
    this.cooldown = 60 / def.rpm;
    this.magazine[def.id] -= 1;
    this.fire();
  }

  reload(): void {
    const def = this.def;
    if (def.id === 'unarmed' || this.reloading > 0) return;
    if (this.magazine[def.id] >= def.magazine) return;
    if (this.ammo[def.id] <= 0) return;
    this.reloading = 1.15;
    this.ctx.audio.play('reload');
  }

  private fire(): void {
    const def = this.def;
    const ctx = this.ctx;
    const sound = def.id === 'unarmed' ? 'punch' : def.id === 'shotgun' ? 'shotgun' : def.id === 'smg' ? 'smg' : 'pistol';
    ctx.audio.play(sound);

    const muzzle = ctx.playerPos.clone().setY(ctx.playerPos.y + 1.35);
    const baseDir = ctx.aimDir.clone().normalize();

    for (let p = 0; p < def.pellets; p++) {
      const dir = baseDir.clone();
      if (def.spread > 0) {
        dir.x += (Math.random() - 0.5) * def.spread * 2;
        dir.y += (Math.random() - 0.5) * def.spread * 1.2;
        dir.z += (Math.random() - 0.5) * def.spread * 2;
        dir.normalize();
      }
      const hit = this.hitscan(ctx.aimOrigin, dir, def.range);
      const end = new THREE.Vector3(
        ctx.aimOrigin.x + dir.x * hit.distance,
        ctx.aimOrigin.y + dir.y * hit.distance,
        ctx.aimOrigin.z + dir.z * hit.distance,
      );
      ctx.effects.tracer(muzzle.x, muzzle.y, muzzle.z, end.x, end.y, end.z);

      if (hit.kind === 'ped' && hit.ped) {
        const killed = hit.ped.damage(def.damage);
        ctx.effects.blood(end.x, end.y, end.z);
        ctx.onPedHit(hit.ped, def.damage, killed);
      } else if (hit.kind === 'vehicle' && hit.vehicle) {
        hit.vehicle.applyDamage(def.damage * 0.7);
        ctx.effects.sparks(end.x, end.y, end.z, 6);
        ctx.onVehicleHit(hit.vehicle, def.damage * 0.7);
      } else if (hit.kind === 'building') {
        ctx.effects.sparks(end.x, end.y, end.z, 5, new THREE.Color(0.8, 0.75, 0.6));
      }
    }

    ctx.effects.muzzleFlash(muzzle.x, muzzle.y, muzzle.z, baseDir.x, baseDir.z);
    ctx.onShot(def);
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

    // Vehicles.
    for (const vehicle of ctx.vehicles) {
      if (vehicle.wrecked) continue;
      const dx = vehicle.position.x - origin.x;
      const dz = vehicle.position.z - origin.z;
      const along = dx * dir.x + dz * dir.z;
      if (along < 0 || along > best.distance) continue;
      const lateral = Math.abs(-dx * dir.z + dz * dir.x);
      const radius = vehicle.spec.width * 0.6;
      if (lateral > radius) continue;
      const height = origin.y + dir.y * along;
      if (height > 1.7 || height < -0.2) continue;
      best = {
        hit: true,
        distance: along,
        x: origin.x + dir.x * along,
        y: height,
        z: origin.z + dir.z * along,
        kind: 'vehicle',
        vehicle,
      };
    }

    return best;
  }

  /** 0..1 how close the crosshair is to a target (for the HUD). */
  crosshairHeat(): number {
    return clamp01(this.aiming ? 1 : 0);
  }
}
