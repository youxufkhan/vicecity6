import * as THREE from 'three';
import { clamp01, lerp, smoothstep } from '../core/MathUtil';

interface SkyKey {
  t: number;
  zenith: number;
  horizon: number;
  sun: number;
  fog: number;
  light: number;
  ambient: number;
}

const KEYS: SkyKey[] = [
  { t: 0.0, zenith: 0x04050d, horizon: 0x101128, sun: 0x9fb4ff, fog: 0x090b18, light: 0.7, ambient: 0.5 },
  { t: 0.22, zenith: 0x080d2a, horizon: 0x241e46, sun: 0xb9a6ff, fog: 0x111330, light: 0.85, ambient: 0.55 },
  { t: 0.28, zenith: 0x1e3570, horizon: 0xff6a3d, sun: 0xffb066, fog: 0x7d5f78, light: 2.0, ambient: 0.6 },
  { t: 0.34, zenith: 0x2a6fcb, horizon: 0xffb070, sun: 0xffd9a0, fog: 0xc09a86, light: 3.2, ambient: 0.95 },
  { t: 0.45, zenith: 0x1462d0, horizon: 0x8ecdf2, sun: 0xfff3d6, fog: 0xa9cbe2, light: 3.7, ambient: 1.15 },
  { t: 0.62, zenith: 0x1158c4, horizon: 0xa3cbe8, sun: 0xfff0cf, fog: 0xafc9de, light: 3.6, ambient: 1.1 },
  { t: 0.72, zenith: 0x16489b, horizon: 0xff9a5c, sun: 0xffc07a, fog: 0xc79580, light: 2.7, ambient: 0.85 },
  { t: 0.79, zenith: 0x101c4a, horizon: 0xff4f62, sun: 0xff8a5c, fog: 0x7d4a66, light: 1.3, ambient: 0.5 },
  { t: 0.85, zenith: 0x06081a, horizon: 0x261840, sun: 0xa08fff, fog: 0x111328, light: 0.85, ambient: 0.55 },
  { t: 1.0, zenith: 0x04050d, horizon: 0x101128, sun: 0x9fb4ff, fog: 0x090b18, light: 0.7, ambient: 0.5 },
];

const SKY_VERT = /* glsl */ `
varying vec3 vWorldDir;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldDir = normalize(wp.xyz - cameraPosition);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uNight;
varying vec3 vWorldDir;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void main() {
  vec3 dir = normalize(vWorldDir);
  float h = clamp(dir.y, -1.0, 1.0);
  float t = pow(clamp(h * 0.5 + 0.5, 0.0, 1.0), 0.75);
  vec3 col = mix(uHorizon, uZenith, smoothstep(0.36, 0.82, t));

  // Sun / moon disc and glow.
  float d = max(dot(dir, normalize(uSunDir)), 0.0);
  col += uSunColor * pow(d, 220.0) * 1.6;
  col += uSunColor * pow(d, 9.0) * 0.22;

  // Stars at night.
  if (uNight > 0.01 && dir.y > 0.02) {
    vec3 q = floor(dir * 190.0);
    float star = step(0.9965, hash(q));
    col += vec3(star) * uNight * (0.6 + 0.4 * hash(q + 3.0)) * smoothstep(0.02, 0.4, dir.y);
  }
  gl_FragColor = vec4(col, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Sky dome, sun, moon and the time-of-day lighting rig. */
export class Sky {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;
  readonly group = new THREE.Group();

  /** 0 = midnight, 0.5 = noon. */
  dayFraction = 0.38;
  /** Real seconds for one in-game day. */
  dayLength = 480;
  private skyMat: THREE.ShaderMaterial;
  private time = 0;
  private sunDir = new THREE.Vector3(0.4, 0.7, 0.3);
  private nightAmount = 0;

  constructor(scene: THREE.Scene) {
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uZenith: { value: new THREE.Color(0x2f7fd6) },
        uHorizon: { value: new THREE.Color(0xa9d8f2) },
        uSunColor: { value: new THREE.Color(0xfff3d6) },
        uSunDir: { value: this.sunDir },
        uNight: { value: 0 },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(2600, 32, 20), this.skyMat);
    dome.frustumCulled = false;
    dome.renderOrder = -1000;
    this.group.add(dome);

    this.sun = new THREE.DirectionalLight(0xfff3d6, 3.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 460;
    this.sun.shadow.camera.left = -95;
    this.sun.shadow.camera.right = 95;
    this.sun.shadow.camera.top = 95;
    this.sun.shadow.camera.bottom = -95;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.045;
    this.group.add(this.sun);
    this.group.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbcd9ee, 0x3b3324, 1.15);
    this.group.add(this.hemi);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.35);
    this.group.add(this.ambient);

    scene.add(this.group);
    scene.fog = new THREE.FogExp2(0xbfd8e8, 0.0022);
    this.apply();
  }

  get night(): number {
    return this.nightAmount;
  }

  get sunDirection(): THREE.Vector3 {
    return this.sunDir;
  }

  get clockFraction(): number {
    return this.dayFraction;
  }

  setClockFraction(f: number): void {
    this.dayFraction = ((f % 1) + 1) % 1;
    this.apply();
  }

  update(dt: number, focus: THREE.Vector3): void {
    this.time += dt;
    this.dayFraction = (this.dayFraction + dt / this.dayLength) % 1;
    this.apply();
    this.sunDir.normalize();
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 180);
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();
  }

  private apply(): void {
    const f = this.dayFraction;
    let a = KEYS[0];
    let b = KEYS[KEYS.length - 1];
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (f >= KEYS[i].t && f <= KEYS[i + 1].t) {
        a = KEYS[i];
        b = KEYS[i + 1];
        break;
      }
    }
    const span = Math.max(1e-4, b.t - a.t);
    const k = clamp01((f - a.t) / span);

    const zenith = new THREE.Color(a.zenith).lerp(new THREE.Color(b.zenith), k);
    const horizon = new THREE.Color(a.horizon).lerp(new THREE.Color(b.horizon), k);
    const sunColor = new THREE.Color(a.sun).lerp(new THREE.Color(b.sun), k);
    const fogColor = new THREE.Color(a.fog).lerp(new THREE.Color(b.fog), k);

    const lightIntensity = lerp(a.light, b.light, k);
    const ambientIntensity = lerp(a.ambient, b.ambient, k);

    // Sun travels an arc: up in the east, down in the west.
    const angle = (f - 0.25) * Math.PI * 2;
    this.sunDir.set(Math.cos(angle) * 0.85, Math.sin(angle), 0.34).normalize();

    this.nightAmount = clamp01(1 - smoothstep(0.02, 0.16, Math.max(0, this.sunDir.y)) * 1.0);

    this.skyMat.uniforms.uZenith.value.copy(zenith);
    this.skyMat.uniforms.uHorizon.value.copy(horizon);
    this.skyMat.uniforms.uSunColor.value.copy(sunColor);
    this.skyMat.uniforms.uNight.value = this.nightAmount;
    (this.skyMat.uniforms.uSunDir.value as THREE.Vector3).copy(this.sunDir);

    this.sun.color.copy(sunColor);
    this.sun.intensity = lightIntensity;
    this.hemi.color.copy(horizon);
    this.hemi.intensity = ambientIntensity * 1.9;
    this.ambient.intensity = 0.18 + ambientIntensity * 0.34;

    if (this.group.parent) {
      const fog = (this.group.parent as THREE.Scene).fog as THREE.FogExp2 | null;
      if (fog) {
        fog.color.copy(fogColor);
        fog.density = lerp(0.0011, 0.0026, this.nightAmount);
      }
    }
  }
}
