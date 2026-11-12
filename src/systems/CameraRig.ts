import * as THREE from 'three';
import type { CollisionWorld } from './Collision';
import { clamp, damp, wrapAngle } from '../core/MathUtil';

export type CameraMode = 'foot' | 'vehicle' | 'aim' | 'cinematic';

export interface CameraTarget {
  position: THREE.Vector3;
  /** Heading the camera should settle behind (vehicle mode). */
  heading: number;
  speed: number;
}

/** Third person camera with auto-align, collision pull-in and shake. */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = 0.18;
  private distance = 5;
  private currentDistance = 5;
  private distanceOverride: number | null = null;
  private idleTimer = 0;
  private shake = 0;
  private fov = 68;
  private smoothFocus = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(68, aspect, 0.25, 4000);
    this.camera.position.set(0, 6, 12);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Override the follow distance (used by the visual tour). */
  setDistance(distance: number): void {
    this.distanceOverride = distance;
    this.distance = distance;
    this.currentDistance = distance;
  }

  look(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    this.yaw = wrapAngle(this.yaw - dx);
    this.pitch = clamp(this.pitch + dy, -0.42, 1.05);
    this.idleTimer = 0;
  }

  addShake(amount: number): void {
    this.shake = Math.min(1.6, this.shake + amount);
  }

  update(dt: number, target: CameraTarget, mode: CameraMode, world: CollisionWorld): void {
    this.idleTimer += dt;

    // Focus point.
    const focusY = mode === 'vehicle' ? 1.5 : 1.42;
    const desiredFocus = new THREE.Vector3(target.position.x, focusY, target.position.z);
    this.smoothFocus.x = damp(this.smoothFocus.x, desiredFocus.x, 14, dt);
    this.smoothFocus.y = damp(this.smoothFocus.y, desiredFocus.y, 10, dt);
    this.smoothFocus.z = damp(this.smoothFocus.z, desiredFocus.z, 14, dt);
    if (this.smoothFocus.lengthSq() < 0.0001) this.smoothFocus.copy(desiredFocus);

    // Auto-align behind the vehicle once the player stops looking around.
    if (mode === 'vehicle' && this.idleTimer > 1.1 && target.speed > 3.5) {
      const desired = wrapAngle(target.heading + Math.PI);
      this.yaw = wrapAngle(this.yaw + wrapAngle(desired - this.yaw) * Math.min(1, dt * 2.4));
    }

    // Desired distance and field of view.
    let desiredDistance = 5.2;
    let targetFov = 68;
    if (mode === 'vehicle') {
      desiredDistance = clamp(6.6 + target.speed * 0.16, 6.6, 11.5);
      targetFov = clamp(68 + target.speed * 0.75, 68, 92);
    } else if (mode === 'aim') {
      desiredDistance = 2.1;
      targetFov = 58;
    } else if (mode === 'cinematic') {
      desiredDistance = 26;
      targetFov = 52;
    }
    this.distance = damp(this.distance, desiredDistance, 6, dt);
    if (this.distanceOverride !== null) this.distance = this.distanceOverride;
    this.fov = damp(this.fov, targetFov, 5, dt);

    // Shoulder offset while aiming.
    let focus = this.smoothFocus;
    if (mode === 'aim') {
      const rx = -Math.cos(this.yaw);
      const rz = Math.sin(this.yaw);
      focus = new THREE.Vector3(
        this.smoothFocus.x + rx * 0.75,
        this.smoothFocus.y + 0.12,
        this.smoothFocus.z + rz * 0.75,
      );
    }

    // Camera position behind the focus.
    const cosPitch = Math.cos(this.pitch);
    const offsetX = Math.sin(this.yaw) * cosPitch * this.distance;
    const offsetZ = Math.cos(this.yaw) * cosPitch * this.distance;

    // Pull the camera in when a building is in the way.
    let dist = this.distance;
    const hit = world.rayDistance(focus.x, focus.z, focus.x + offsetX, focus.z + offsetZ);
    const maxDist = Math.hypot(offsetX, offsetZ);
    if (maxDist > 0.01 && hit < maxDist) {
      dist = Math.max(0.9, (hit / maxDist) * this.distance - 0.35);
    }
    this.currentDistance = damp(this.currentDistance, dist, 14, dt);

    const finalDist = Math.min(this.currentDistance, this.distance);
    let camX = focus.x + Math.sin(this.yaw) * cosPitch * finalDist;
    let camZ = focus.z + Math.cos(this.yaw) * cosPitch * finalDist;
    let camY = focus.y + Math.sin(this.pitch) * finalDist + 0.55;

    // Keep the camera above the ground.
    if (camY < 0.7) camY = 0.7;

    // Shake.
    if (this.shake > 0.001) {
      const s = this.shake * 0.42;
      camX += (Math.random() - 0.5) * s;
      camY += (Math.random() - 0.5) * s;
      camZ += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 2.4);
    }

    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(focus.x, focus.y + (mode === 'aim' ? 0.05 : 0.15), focus.z);
    if (this.camera.fov !== this.fov) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Direction the camera is looking, on the XZ plane. */
  get forward(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  get right(): THREE.Vector3 {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }
}
