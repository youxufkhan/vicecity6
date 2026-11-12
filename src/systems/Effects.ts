import * as THREE from 'three';
import { radialSprite } from '../core/Textures';
import { clamp01 } from '../core/MathUtil';

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  r: number;
  g: number;
  b: number;
  gravity: number;
}

interface Tracer {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  life: number;
  maxLife: number;
}

interface Skid {
  x: number;
  z: number;
  yaw: number;
  life: number;
}

const MAX_PARTICLES = 320;
const MAX_TRACERS = 24;
const MAX_SKIDS = 180;

/** Particles, tracers, skid marks and explosions. */
export class Effects {
  readonly group = new THREE.Group();

  private particles: Particle[] = [];
  private particleGeo: THREE.BufferGeometry;
  private particlePoints: THREE.Points;
  private particlePositions: Float32Array;
  private particleColors: Float32Array;

  private tracers: Tracer[] = [];
  private tracerGeo: THREE.BufferGeometry;
  private tracerLines: THREE.LineSegments;

  private skids: Skid[] = [];
  private skidGeo: THREE.BufferGeometry;
  private skidMesh: THREE.Mesh;

  private flash: THREE.PointLight;
  private flashTimer = 0;
  private sprite: THREE.Sprite;

  constructor(scene: THREE.Scene) {
    this.group.name = 'effects';

    this.particlePositions = new Float32Array(MAX_PARTICLES * 3);
    this.particleColors = new Float32Array(MAX_PARTICLES * 3);
    this.particleGeo = new THREE.BufferGeometry();
    this.particleGeo.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    this.particleGeo.setAttribute('color', new THREE.BufferAttribute(this.particleColors, 3));
    this.particlePoints = new THREE.Points(
      this.particleGeo,
      new THREE.PointsMaterial({
        size: 0.42,
        map: radialSprite(),
        transparent: true,
        depthWrite: false,
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    );
    this.particlePoints.frustumCulled = false;
    this.group.add(this.particlePoints);

    this.tracerGeo = new THREE.BufferGeometry();
    this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_TRACERS * 6), 3));
    this.tracerLines = new THREE.LineSegments(
      this.tracerGeo,
      new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.tracerLines.frustumCulled = false;
    this.group.add(this.tracerLines);

    this.skidGeo = new THREE.BufferGeometry();
    const skidCount = MAX_SKIDS * 6;
    this.skidGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(skidCount * 3), 3));
    this.skidGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(skidCount * 4), 4));
    const idx = new Uint32Array(MAX_SKIDS * 6);
    for (let i = 0; i < MAX_SKIDS; i++) {
      const v = i * 4;
      idx.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
    }
    this.skidGeo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.skidMesh = new THREE.Mesh(
      this.skidGeo,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    );
    this.skidMesh.frustumCulled = false;
    this.group.add(this.skidMesh);

    this.flash = new THREE.PointLight(0xffcc66, 0, 40, 2);
    this.flash.visible = false;
    this.group.add(this.flash);

    const spriteMat = new THREE.SpriteMaterial({
      map: radialSprite('rgba(255,220,150,1)', 'rgba(255,120,40,0)'),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.sprite = new THREE.Sprite(spriteMat);
    this.sprite.scale.setScalar(3);
    this.sprite.visible = false;
    this.group.add(this.sprite);

    scene.add(this.group);
  }

  /* ─────────────────── emitters ─────────────────── */

  spawnParticle(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    color: THREE.Color,
    life: number,
    size: number,
    gravity = -6,
  ): void {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push({
      x,
      y,
      z,
      vx,
      vy,
      vz,
      life,
      maxLife: life,
      size,
      r: color.r,
      g: color.g,
      b: color.b,
      gravity,
    });
  }

  smoke(x: number, y: number, z: number, amount = 1, dark = 0.35): void {
    const c = new THREE.Color(dark, dark, dark);
    for (let i = 0; i < amount; i++) {
      this.spawnParticle(
        x + (Math.random() - 0.5) * 0.6,
        y + Math.random() * 0.3,
        z + (Math.random() - 0.5) * 0.6,
        (Math.random() - 0.5) * 1.2,
        1.1 + Math.random() * 1.4,
        (Math.random() - 0.5) * 1.2,
        c,
        0.9 + Math.random() * 0.8,
        1.4 + Math.random() * 1.6,
        0.6,
      );
    }
  }

  sparks(x: number, y: number, z: number, amount = 8, color = new THREE.Color(1, 0.75, 0.3)): void {
    for (let i = 0; i < amount; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 3 + Math.random() * 7;
      this.spawnParticle(
        x,
        y,
        z,
        Math.cos(a) * s,
        Math.random() * 5,
        Math.sin(a) * s,
        color,
        0.35 + Math.random() * 0.3,
        0.5,
        -14,
      );
    }
  }

  blood(x: number, y: number, z: number): void {
    const c = new THREE.Color(0.75, 0.06, 0.08);
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 3;
      this.spawnParticle(x, y, z, Math.cos(a) * s, Math.random() * 3, Math.sin(a) * s, c, 0.5, 0.45, -12);
    }
  }

  tracer(ax: number, ay: number, az: number, bx: number, by: number, bz: number, life = 0.07): void {
    if (this.tracers.length >= MAX_TRACERS) this.tracers.shift();
    this.tracers.push({ ax, ay, az, bx, by, bz, life, maxLife: life });
  }

  muzzleFlash(x: number, y: number, z: number, dirX: number, dirZ: number): void {
    this.flash.position.set(x + dirX * 0.5, y, z + dirZ * 0.5);
    this.flash.intensity = 9;
    this.flash.visible = true;
    this.flashTimer = 0.07;
    this.sprite.position.copy(this.flash.position);
    this.sprite.visible = true;
    const c = new THREE.Color(1, 0.85, 0.5);
    for (let i = 0; i < 5; i++) {
      this.spawnParticle(
        x + dirX * 0.6,
        y,
        z + dirZ * 0.6,
        dirX * 6 + (Math.random() - 0.5) * 2,
        1.2 + Math.random() * 1.6,
        dirZ * 6 + (Math.random() - 0.5) * 2,
        c,
        0.1,
        0.22,
        0,
      );
    }
  }

  explosion(x: number, y: number, z: number): void {
    this.flash.position.set(x, y + 1.5, z);
    this.flash.intensity = 40;
    this.flash.visible = true;
    this.flashTimer = 0.3;
    const fire = new THREE.Color(1, 0.45, 0.1);
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * 11;
      this.spawnParticle(
        x,
        y + 0.6,
        z,
        Math.cos(a) * s,
        2 + Math.random() * 9,
        Math.sin(a) * s,
        fire,
        0.5 + Math.random() * 0.6,
        1.4 + Math.random() * 2,
        -6,
      );
    }
    this.smoke(x, y + 1, z, 22, 0.22);
  }

  skid(x: number, z: number, yaw: number): void {
    if (this.skids.length >= MAX_SKIDS) this.skids.shift();
    this.skids.push({ x, z, yaw, life: 14 });
  }

  /* ─────────────────── update ─────────────────── */

  update(dt: number): void {
    // Particles.
    let write = 0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.05) {
        p.y = 0.05;
        p.vy *= -0.25;
        p.vx *= 0.6;
        p.vz *= 0.6;
      }
    }
    for (const p of this.particles) {
      const t = clamp01(p.life / p.maxLife);
      this.particlePositions[write * 3] = p.x;
      this.particlePositions[write * 3 + 1] = p.y;
      this.particlePositions[write * 3 + 2] = p.z;
      this.particleColors[write * 3] = p.r * t;
      this.particleColors[write * 3 + 1] = p.g * t;
      this.particleColors[write * 3 + 2] = p.b * t;
      write++;
    }
    this.particleGeo.setDrawRange(0, write);
    (this.particleGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.particleGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;

    // Tracers.
    const tPos = this.tracerGeo.getAttribute('position') as THREE.BufferAttribute;
    let t = 0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.life -= dt;
      if (tr.life <= 0) {
        this.tracers.splice(i, 1);
        continue;
      }
    }
    for (const tr of this.tracers) {
      const a = tPos.array as Float32Array;
      a[t * 3] = tr.ax;
      a[t * 3 + 1] = tr.ay;
      a[t * 3 + 2] = tr.az;
      a[t * 3 + 3] = tr.bx;
      a[t * 3 + 4] = tr.by;
      a[t * 3 + 5] = tr.bz;
      t += 2;
    }
    this.tracerGeo.setDrawRange(0, t);
    tPos.needsUpdate = true;

    // Skid marks.
    const sPos = this.skidGeo.getAttribute('position') as THREE.BufferAttribute;
    const sCol = this.skidGeo.getAttribute('color') as THREE.BufferAttribute;
    let s = 0;
    for (let i = this.skids.length - 1; i >= 0; i--) {
      const sk = this.skids[i];
      sk.life -= dt;
      if (sk.life <= 0) {
        this.skids.splice(i, 1);
        continue;
      }
    }
    for (const sk of this.skids) {
      const alpha = clamp01(sk.life / 14) * 0.55;
      const halfW = 0.22;
      const halfL = 0.85;
      const c = Math.cos(sk.yaw);
      const sn = Math.sin(sk.yaw);
      const corners: [number, number][] = [
        [-halfW, -halfL],
        [halfW, -halfL],
        [halfW, halfL],
        [-halfW, halfL],
      ];
      for (const [ox, oz] of corners) {
        const x = sk.x + ox * c + oz * sn;
        const z = sk.z - ox * sn + oz * c;
        const p = sPos.array as Float32Array;
        p[s * 3] = x;
        p[s * 3 + 1] = 0.045;
        p[s * 3 + 2] = z;
        const c4 = sCol.array as Float32Array;
        c4[s * 4] = 0.05;
        c4[s * 4 + 1] = 0.05;
        c4[s * 4 + 2] = 0.06;
        c4[s * 4 + 3] = alpha;
        s++;
      }
    }
    this.skidGeo.setDrawRange(0, s);
    sPos.needsUpdate = true;
    sCol.needsUpdate = true;

    // Flash decay.
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      this.flash.intensity = Math.max(0, this.flash.intensity - dt * 220);
      if (this.flashTimer <= 0) {
        this.flash.visible = false;
        this.flash.intensity = 0;
        this.sprite.visible = false;
      }
    }
  }

  clear(): void {
    this.particles.length = 0;
    this.tracers.length = 0;
    this.skids.length = 0;
  }
}
