import * as THREE from 'three';
import { makeRng } from './MathUtil';

/**
 * Every texture in the game is generated at runtime on a 2D canvas — no binary
 * assets, no network fetches, deterministic output for a given seed.
 */

function makeCanvas(size: number, height = size): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = height;
  return c;
}

function finish(canvas: HTMLCanvasElement, repeat: THREE.Vector2 | null, srgb = true): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  if (repeat) tex.repeat.set(repeat.x, repeat.y);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/* ─────────────────────────── ground surfaces ─────────────────────────── */

export function asphaltTexture(seed = 7): THREE.CanvasTexture {
  const size = 256;
  const c = makeCanvas(size);
  const g = c.getContext('2d')!;
  const rnd = makeRng(seed);

  g.fillStyle = '#6a6a73';
  g.fillRect(0, 0, size, size);

  // Mottled patches
  for (let i = 0; i < 120; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 8 + rnd() * 42;
    const shade = 92 + Math.floor(rnd() * 32);
    g.fillStyle = `rgba(${shade},${shade},${shade + 6},0.5)`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  // Aggregate speckle
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 34;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  g.putImageData(img, 0, 0);

  // Cracks
  g.strokeStyle = 'rgba(28,28,34,0.55)';
  g.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    g.beginPath();
    let x = rnd() * size;
    let y = rnd() * size;
    g.moveTo(x, y);
    for (let s = 0; s < 5; s++) {
      x += (rnd() - 0.5) * 44;
      y += (rnd() - 0.5) * 44;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  return finish(c, null);
}

export function roadTexture(seed = 11): THREE.CanvasTexture {
  const size = 256;
  const c = makeCanvas(size);
  const g = c.getContext('2d')!;
  const rnd = makeRng(seed);

  g.drawImage(asphaltCanvas(seed), 0, 0);

  // Edge lines
  g.fillStyle = 'rgba(228,228,220,0.72)';
  g.fillRect(size * 0.045, 0, size * 0.022, size);
  g.fillRect(size * 0.933, 0, size * 0.022, size);

  // Dashed centre line (2 periods of 8 world-units inside a 16 unit tile)
  g.fillStyle = 'rgba(240,196,60,0.85)';
  for (let k = 0; k < 2; k++) {
    const y = size * (k * 0.5) + size * 0.08;
    g.fillRect(size * 0.487, y, size * 0.026, size * 0.18);
  }

  // Tyre wear
  g.fillStyle = 'rgba(0,0,0,0.16)';
  for (const u of [0.19, 0.3, 0.7, 0.81]) g.fillRect(size * u, 0, size * 0.06, size);

  void rnd;
  return finish(c, null);
}

function asphaltCanvas(seed: number): HTMLCanvasElement {
  const size = 256;
  const c = makeCanvas(size);
  const g = c.getContext('2d')!;
  const rnd = makeRng(seed);
  g.fillStyle = '#6a6a73';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 90; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 10 + rnd() * 40;
    const shade = 92 + Math.floor(rnd() * 30);
    g.fillStyle = `rgba(${shade},${shade},${shade + 6},0.45)`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

export function sidewalkTexture(seed = 21): THREE.CanvasTexture {
  const size = 256;
  const c = makeCanvas(size);
  const g = c.getContext('2d')!;
  const rnd = makeRng(seed);

  g.fillStyle = '#8d8a86';
  g.fillRect(0, 0, size, size);

  // Concrete slabs (4x4 per tile)
  const cells = 4;
  const step = size / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const v = 132 + Math.floor(rnd() * 26);
      g.fillStyle = `rgb(${v},${v - 3},${v - 8})`;
      g.fillRect(x * step + 1.5, y * step + 1.5, step - 3, step - 3);
    }
  }

  // Joints
  g.strokeStyle = 'rgba(60,58,56,0.55)';
  g.lineWidth = 2;
  for (let i = 0; i <= cells; i++) {
    g.beginPath();
    g.moveTo(i * step, 0);
    g.lineTo(i * step, size);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i * step);
    g.lineTo(size, i * step);
    g.stroke();
  }

  // Stains
  for (let i = 0; i < 30; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 3 + rnd() * 16;
    g.fillStyle = `rgba(70,66,62,${0.05 + rnd() * 0.12})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  return finish(c, null);
}

export type LotKind = 'concrete' | 'sand' | 'grass' | 'gravel';

export function lotTexture(kind: LotKind, seed = 31): THREE.CanvasTexture {
  const size = 256;
  const c = makeCanvas(size);
  const g = c.getContext('2d')!;
  const rnd = makeRng(seed + kind.length);

  const base: Record<LotKind, [number, number, number]> = {
    concrete: [124, 120, 114],
    sand: [214, 190, 142],
    grass: [86, 112, 66],
    gravel: [120, 116, 112],
  };
  const [r, gg, b] = base[kind];
  g.fillStyle = `rgb(${r},${gg},${b})`;
  g.fillRect(0, 0, size, size);

  const blobs = kind === 'grass' ? 420 : 220;
  for (let i = 0; i < blobs; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const rad = 2 + rnd() * (kind === 'grass' ? 9 : 16);
    const t = rnd();
    const shade =
      kind === 'grass'
        ? `rgba(${58 + t * 50},${86 + t * 46},${44 + t * 32},0.45)`
        : `rgba(${r - 26 + t * 40},${gg - 26 + t * 40},${b - 26 + t * 40},0.4)`;
    g.fillStyle = shade;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }

  if (kind === 'grass') {
    for (let i = 0; i < 500; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      g.strokeStyle = `rgba(${100 + rnd() * 60},${140 + rnd() * 50},${70 + rnd() * 30},0.5)`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (rnd() - 0.5) * 4, y - 2 - rnd() * 4);
      g.stroke();
    }
  }
  return finish(c, null);
}

/* ─────────────────────────── building facades ─────────────────────────── */

export type FacadeKind = 'glass' | 'concrete' | 'brick' | 'stucco';

export interface FacadeTextures {
  map: THREE.CanvasTexture;
  emissiveMap: THREE.CanvasTexture;
}

/**
 * One tile = 4 floors x 4 window bays. The roof flat patch lives in the
 * top-left 6% of the texture so roof faces can borrow it.
 */
export function facadeTextures(kind: FacadeKind, seed = 41): FacadeTextures {
  const size = 256;
  const mapC = makeCanvas(size);
  const emiC = makeCanvas(size);
  const g = mapC.getContext('2d')!;
  const e = emiC.getContext('2d')!;
  const rnd = makeRng(seed + kind.length * 7);

  const palettes: Record<FacadeKind, { wall: string; frame: string; glass: string; shop: string }> = {
    glass: { wall: '#5c6474', frame: '#39404d', glass: '#1b2534', shop: '#2a2f3a' },
    concrete: { wall: '#9a938a', frame: '#6d675f', glass: '#26303c', shop: '#4a4640' },
    brick: { wall: '#8d5648', frame: '#5d3a32', glass: '#202a36', shop: '#40302c' },
    stucco: { wall: '#d9c6a5', frame: '#8d7f6c', glass: '#243040', shop: '#5c5140' },
  };
  const p = palettes[kind];

  g.fillStyle = p.wall;
  g.fillRect(0, 0, size, size);
  e.fillStyle = '#000000';
  e.fillRect(0, 0, size, size);

  // Flat roof patch (top-left corner, 6% square) used by roof faces.
  g.fillStyle = '#6d6a66';
  g.fillRect(0, 0, size * 0.06, size * 0.06);
  e.fillStyle = '#000000';
  e.fillRect(0, 0, size * 0.06, size * 0.06);

  // Wall texture noise
  for (let i = 0; i < 260; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 3 + rnd() * 18;
    g.fillStyle = `rgba(255,255,255,${rnd() * 0.05})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  const cells = 4;
  const step = size / cells;
  const inset = step * 0.2;
  // Bottom row is the shopfront (street level), so the tile covers 4 floors
  // with the ground floor at the bottom of the UV space.
  for (let row = 0; row < cells; row++) {
    const y = size - (row + 1) * step;
    for (let col = 0; col < cells; col++) {
      const x = col * step;
      if (row === 0) {
        // shopfront: dark frame, warm emissive interior
        g.fillStyle = p.shop;
        g.fillRect(x + 1, y + 1, step - 2, step - 2);
        g.fillStyle = 'rgba(255,226,170,0.85)';
        g.fillRect(x + inset * 0.6, y + step * 0.22, step - inset * 1.2, step * 0.58);
        e.fillStyle = 'rgba(255,214,150,0.95)';
        e.fillRect(x + inset * 0.6, y + step * 0.22, step - inset * 1.2, step * 0.58);
        continue;
      }
      // window bay
      g.fillStyle = p.frame;
      g.fillRect(x + inset * 0.7, y + inset * 0.5, step - inset * 1.4, step - inset);
      g.fillStyle = p.glass;
      g.fillRect(x + inset * 0.95, y + inset * 0.72, step - inset * 1.9, step - inset * 1.45);

      const lit = rnd() < 0.42;
      if (lit) {
        const warm = rnd() < 0.75;
        const col = warm ? '255,214,150' : '168,214,255';
        g.fillStyle = `rgba(${col},0.26)`;
        g.fillRect(x + inset * 0.95, y + inset * 0.72, step - inset * 1.9, step - inset * 1.45);
        e.fillStyle = `rgba(${col},1)`;
        e.fillRect(x + inset * 0.95, y + inset * 0.72, step - inset * 1.9, step - inset * 1.45);
      }
      // mullion
      g.fillStyle = p.frame;
      g.fillRect(x + step * 0.5 - 1, y + inset * 0.72, 2, step - inset * 1.45);
    }
  }

  // Floor separator bands
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let row = 1; row < cells; row++) {
    const y = size - row * step;
    g.fillRect(0, y - 1.5, size, 3);
  }

  return {
    map: finish(mapC, null),
    emissiveMap: finish(emiC, null, true),
  };
}

/* ─────────────────────────── misc ─────────────────────────── */

export function waterTexture(seed = 55): THREE.CanvasTexture {
  const size = 256;
  const c = makeCanvas(size);
  const g = c.getContext('2d')!;
  const rnd = makeRng(seed);
  g.fillStyle = '#0d3f5c';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 70; i++) {
    const y = rnd() * size;
    g.strokeStyle = `rgba(150,220,255,${0.05 + rnd() * 0.16})`;
    g.lineWidth = 1 + rnd() * 2.5;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= size; x += 16) {
      g.lineTo(x, y + Math.sin(x * 0.09 + i) * 3.2);
    }
    g.stroke();
  }
  return finish(c, null);
}

export function sandTexture(seed = 61): THREE.CanvasTexture {
  return lotTexture('sand', seed);
}

/** Soft radial sprite used for smoke / muzzle flash / glows. */
export function radialSprite(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)'): THREE.CanvasTexture {
  const size = 128;
  const c = makeCanvas(size);
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.45, inner.replace(/[\d.]+\)$/, '0.55)'));
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Billboard advertising art for the city streets. */
export function billboardTexture(seed = 71): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d')!;
  const rnd = makeRng(seed);
  const palettes: [string, string, string][] = [
    ['#ff2e88', '#ffd45e', 'NEON COAST'],
    ['#35e0ff', '#0b2c4d', 'VICE FUEL'],
    ['#58f5b5', '#06281c', 'LUNA MOTEL'],
    ['#ff7a3d', '#2b0a06', 'HOT DOGS'],
  ];
  const p = palettes[Math.floor(rnd() * palettes.length)];
  g.fillStyle = p[1];
  g.fillRect(0, 0, w, h);
  g.fillStyle = p[0];
  g.fillRect(0, 0, w, 14);
  g.fillRect(0, h - 14, w, 14);
  g.fillStyle = p[2];
  g.font = 'bold 64px Impact, "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(p[2], w / 2, h / 2 - 10);
  g.font = 'bold 26px Impact, "Arial Black", sans-serif';
  g.fillStyle = p[0];
  g.fillText('★ ★ ★  OPEN ALL NIGHT  ★ ★ ★', w / 2, h / 2 + 44);
  return finish(c, null);
}
