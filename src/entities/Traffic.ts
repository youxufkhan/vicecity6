import * as THREE from 'three';
import type { CollisionWorld } from '../systems/Collision';
import { angleDelta, clamp, clamp01, dist2D, rngFrom, type Rng } from '../core/MathUtil';
import { LANE_OFFSET, STOP_LINE_OFFSET, type RoadNetwork } from '../world/Layout';
import { CAR_SPECS, CIVIL_PAINT, type CarSpec } from './CarFactory';
import { Vehicle, type VehicleAI } from './Vehicle';

const SPEC_KEYS = Object.keys(CAR_SPECS);

/* ─────────────────────────── traffic AI ─────────────────────────── */

export class TrafficAI implements VehicleAI {
  private from = 0;
  private to = 0;
  private nextEdge = -1;
  private nextTarget = new THREE.Vector2();
  private lanePoint = new THREE.Vector2();
  /** True while the AI is waiting at a red light. */
  stopped = false;
  private stuckTimer = 0;
  private reverseTimer = 0;
  private reverseSteer = 0;
  private rng: Rng;
  /** Game clock, used for traffic light timing. */
  time = 0;
  /** Smoothed steering so the cars do not saw between the wheels. */
  private steerValue = 0;

  constructor(private roads: RoadNetwork, startNode: number, toNode?: number, seed = startNode * 7919 + 13) {
    this.rng = rngFrom(seed);
    this.from = startNode;
    this.to = toNode ?? this.roads.otherEnd(this.roads.nextEdge(startNode, null, this.rng), startNode);
  }

  update(vehicle: Vehicle, dt: number): void {
    const pos = vehicle.position;
    const toNode = this.roads.nodes[this.to];
    const distToNode = dist2D(pos.x, pos.z, toNode.x, toNode.z);

    // Choose the next edge shortly before the intersection.
    if (this.nextEdge < 0 && distToNode < 24) {
      const edge = this.roads.nextEdge(this.to, this.edgeInto(this.to), this.rng);
      this.nextEdge = edge;
      const dir = this.roads.edgeDirection(edge, this.to);
      const rx = -dir.dz;
      const rz = dir.dx;
      this.nextTarget.set(
        toNode.x + rx * LANE_OFFSET + dir.dx * 9,
        toNode.z + rz * LANE_OFFSET + dir.dz * 9,
      );
    }

    // Current lane centre (projected ahead of the car).
    const dir = this.roads.edgeDirection(this.edgeInto(this.to), this.from);
    const fromNode = this.roads.nodes[this.from];
    const len = dist2D(fromNode.x, fromNode.z, toNode.x, toNode.z);
    const t = clamp01(((pos.x - fromNode.x) * dir.dx + (pos.z - fromNode.z) * dir.dz) / Math.max(1, len));
    const rx = -dir.dz;
    const rz = dir.dx;
    this.lanePoint.set(
      fromNode.x + dir.dx * len * t + rx * LANE_OFFSET,
      fromNode.z + dir.dz * len * t + rz * LANE_OFFSET,
    );

    // Look ahead along the lane, further ahead the faster we go.
    const lookahead = 9 + Math.abs(vehicle.forwardSpeed) * 0.55;
    let targetX = this.lanePoint.x + dir.dx * lookahead;
    let targetZ = this.lanePoint.y + dir.dz * lookahead;
    if (this.nextEdge >= 0) {
      const blend = clamp01((22 - distToNode) / 18);
      targetX = targetX + (this.nextTarget.x - targetX) * blend;
      targetZ = targetZ + (this.nextTarget.y - targetZ) * blend;
    }

    // Steering: aim at the target, damped so the car does not saw.
    const desiredYaw = Math.atan2(targetX - pos.x, targetZ - pos.z);
    const diff = angleDelta(vehicle.yaw, desiredYaw);
    const steerTarget = clamp(-diff * 1.35, -1, 1);
    this.steerValue += (steerTarget - this.steerValue) * Math.min(1, dt * 9);
    let steer = this.steerValue;

    // Desired speed.
    let desiredSpeed = 17;
    if (Math.abs(diff) > 0.5) desiredSpeed = 7;
    if (Math.abs(diff) > 1.1) desiredSpeed = 4;

    // Measure from the front bumper along the approach, independent of lane offset.
    const axis = Math.abs(dir.dx) > 0.5 ? 'x' : 'z';
    const signal = this.roads.signalState(this.to, axis, this.time);
    const speed = vehicle.forwardSpeed;
    const alongToNode = (toNode.x - pos.x) * dir.dx + (toNode.z - pos.z) * dir.dz;
    const stopDistance = alongToNode - STOP_LINE_OFFSET - vehicle.spec.length / 2;
    const brakingDistance = Math.max(0, speed) ** 2 / 20;
    const shouldStop = signal === 'red' || (signal === 'yellow' && stopDistance >= brakingDistance);
    if (shouldStop && stopDistance >= -0.25) {
      desiredSpeed = Math.min(desiredSpeed, stopDistance < 0.45 ? 0 : Math.max(1, stopDistance * 0.95));
    }

    // Vehicle ahead: keep a safe gap and stop behind it.
    const ahead = this.vehicleAhead(vehicle);
    if (Number.isFinite(ahead)) {
      desiredSpeed = Math.min(desiredSpeed, Math.max(0, (ahead - 5.5) * 1.1));
    }

    // Speed control.
    let throttle = 0;
    if (speed < desiredSpeed - 0.6) throttle = clamp((desiredSpeed - speed) * 0.45, 0.25, 1);
    else if (speed > desiredSpeed + 1.2) throttle = -1;

    this.stopped = desiredSpeed < 0.4;

    // Hold the same steering direction for a full recovery manoeuvre.
    if (this.reverseTimer > 0) {
      this.reverseTimer -= dt;
      throttle = -0.8;
      steer = this.reverseSteer;
    } else if (Math.abs(speed) < 0.4 && desiredSpeed > 2) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 2.4) {
        this.reverseTimer = 0.9;
        this.reverseSteer = this.rng.chance(0.5) ? 0.7 : -0.7;
        this.stuckTimer = 0;
      }
    } else {
      this.stuckTimer = 0;
    }

    vehicle.setInput({ throttle, steer, handbrake: this.stopped });

    // Advance to the next node.
    if (distToNode < 5.5 && this.nextEdge >= 0) {
      this.from = this.to;
      this.to = this.roads.otherEnd(this.nextEdge, this.from);
      this.nextEdge = -1;
    }
  }

  private edgeInto(node: number): number {
    for (const e of this.roads.nodes[node].edges) {
      if (this.roads.otherEnd(e, node) === this.from) return e;
    }
    return this.roads.nodes[node].edges[0];
  }

  private vehicleAhead(vehicle: Vehicle): number {
    let closest = Infinity;
    const fx = Math.sin(vehicle.yaw);
    const fz = Math.cos(vehicle.yaw);
    const candidates = this.roadContext?.vehicles ?? [];
    for (const other of candidates) {
      if (other === vehicle) continue;
      const dx = other.position.x - vehicle.position.x;
      const dz = other.position.z - vehicle.position.z;
      const along = dx * fx + dz * fz;
      if (along <= 0 || along > 25) continue;
      const lateral = Math.abs(-dx * fz + dz * fx);
      if (lateral > 2.8) continue;
      // Only brake for traffic going roughly the same way — oncoming cars
      // are handled by staying in the lane.
      const otherFx = Math.sin(other.yaw);
      const otherFz = Math.cos(other.yaw);
      if (other.speed > 1 && otherFx * fx + otherFz * fz < 0.35) continue;
      closest = Math.min(closest, along);
    }
    return closest;
  }

  /** Shared list of vehicles used for forward-looking checks. */
  roadContext: { vehicles: Vehicle[] } | null = null;

  /** Diagnostics: what the AI is currently aiming at. */
  debugState(): Record<string, unknown> {
    const toNode = this.roads.nodes[this.to];
    const dir = this.roads.edgeDirection(this.edgeInto(this.to), this.from);
    const fromNode = this.roads.nodes[this.from];
    const len = dist2D(fromNode.x, fromNode.z, toNode.x, toNode.z);
    return {
      from: [this.from, fromNode.x.toFixed(0), fromNode.z.toFixed(0)],
      to: [this.to, toNode.x.toFixed(0), toNode.z.toFixed(0)],
      dir: [dir.dx.toFixed(2), dir.dz.toFixed(2)],
      len: len.toFixed(0),
      nextEdge: this.nextEdge,
      lanePoint: [this.lanePoint.x.toFixed(1), this.lanePoint.y.toFixed(1)],
      nextTarget: [this.nextTarget.x.toFixed(1), this.nextTarget.y.toFixed(1)],
    };
  }
}

/* ─────────────────────────── police AI ─────────────────────────── */

export class PoliceAI implements VehicleAI {
  private stuckTimer = 0;
  private reverseTimer = 0;
  private reverseSteer = 0;
  private rng: Rng;

  constructor(seed = 1) {
    this.rng = rngFrom(seed * 104729 + 7);
  }

  update(vehicle: Vehicle, dt: number): void {
    const pos = vehicle.position;
    const target = this.roadContext?.playerPos ?? pos;
    const playerVel = this.roadContext?.playerVel;

    // Lead the target.
    let tx = target.x;
    let tz = target.z;
    if (playerVel) {
      const lead = clamp01(dist2D(pos.x, pos.z, target.x, target.z) / 40) * 0.8;
      tx += playerVel.x * lead;
      tz += playerVel.z * lead;
    }

    const dx = tx - pos.x;
    const dz = tz - pos.z;
    const dist = Math.hypot(dx, dz);
    const desiredYaw = Math.atan2(dx, dz);
    const diff = angleDelta(vehicle.yaw, desiredYaw);

    // Wall avoidance: if a building is close ahead, steer around it.
    const world = this.roadContext?.world;
    let steer = clamp(-diff * 1.7, -1, 1);
    if (world) {
      const fx = Math.sin(vehicle.yaw);
      const fz = Math.cos(vehicle.yaw);
      const probe = 9 + vehicle.speed * 0.4;
      const hit = world.raycast(pos.x, pos.z, pos.x + fx * probe, pos.z + fz * probe);
      if (hit.hit) {
        // Steer towards the open side of the wall.
        const side = -hit.nx * fz + hit.nz * fx;
        steer = clamp(steer + (side > 0 ? 0.85 : -0.85), -1, 1);
      }
    }

    let throttle = 1;
    const speed = vehicle.forwardSpeed;
    if (dist < 9 && Math.abs(diff) < 0.6) throttle = 0.25;
    if (Math.abs(diff) > 1.4) throttle = 0.5;

    if (this.reverseTimer > 0) {
      this.reverseTimer -= dt;
      throttle = -0.9;
      steer = this.reverseSteer;
    } else if (Math.abs(speed) < 0.6 && dist > 12) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 1.6) {
        this.reverseTimer = 0.9;
        this.reverseSteer = this.rng.chance(0.5) ? 0.8 : -0.8;
        this.stuckTimer = 0;
      }
    } else {
      this.stuckTimer = 0;
    }

    vehicle.setInput({ throttle, steer, handbrake: false });
  }

  roadContext: {
    vehicles: Vehicle[];
    playerPos: THREE.Vector3;
    playerVel: THREE.Vector3;
    world: CollisionWorld;
  } | null = null;
}

/* ─────────────────────────── traffic manager ─────────────────────────── */

export interface TrafficOptions {
  maxTraffic?: number;
  maxParked?: number;
}

export class TrafficManager {
  readonly traffic: Vehicle[] = [];
  readonly parked: Vehicle[] = [];
  readonly police: Vehicle[] = [];
  /** The player's current car, so AI traffic keeps clear of it. */
  playerVehicle: Vehicle | null = null;
  private rng = rngFrom(9182736);
  private maxTraffic: number;
  private maxParked: number;
  private time = 0;

  constructor(
    private scene: THREE.Scene,
    private roads: RoadNetwork,
    private carSpawns: { x: number; z: number; yaw: number }[],
    options: TrafficOptions = {},
  ) {
    this.maxTraffic = options.maxTraffic ?? 20;
    this.maxParked = options.maxParked ?? 18;
  }

  /** Attach a car to the scene graph so it is actually rendered. */
  private addToScene(car: Vehicle): void {
    car.group.userData.kind = 'vehicle';
    this.scene.add(car.group);
  }

  /** Detach a car and free its geometry. */
  private removeFromScene(car: Vehicle): void {
    this.scene.remove(car.group);
    car.dispose();
  }

  private randomSpec(): CarSpec {
    return CAR_SPECS[SPEC_KEYS[this.rng.int(0, SPEC_KEYS.length - 1)]];
  }

  private randomPaint(): string {
    return CIVIL_PAINT[this.rng.int(0, CIVIL_PAINT.length - 1)];
  }

  /** Parked cars the player can steal. */
  populateParked(): void {
    const shuffled = this.carSpawns.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = this.rng.int(0, i);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    for (let i = 0; i < Math.min(this.maxParked, shuffled.length); i++) {
      const spot = shuffled[i];
      const spec = this.randomSpec();
      const car = new Vehicle(spec, this.randomPaint());
      car.position.set(spot.x, 0, spot.z);
      car.yaw = spot.yaw;
      car.velocity.set(0, 0, 0);
      car.driver = 'none';
      this.addToScene(car);
      this.parked.push(car);
    }
  }

  /** Dispatch from a nearby clear road approach. */
  spawnPolice(x: number, z: number, world: CollisionWorld): Vehicle | null {
    const spec = CAR_SPECS.sedan;
    const spots = this.roads.edges.flatMap((edge) => {
      const a = this.roads.nodes[edge.a];
      const b = this.roads.nodes[edge.b];
      const midX = (a.x + b.x) / 2;
      const midZ = (a.z + b.z) / 2;
      const direction = (x - midX) * edge.dx + (z - midZ) * edge.dz >= 0 ? 1 : -1;
      const px = midX - edge.dz * direction * LANE_OFFSET;
      const pz = midZ + edge.dx * direction * LANE_OFFSET;
      const distance = dist2D(x, z, px, pz);
      if (distance < 32 || distance > 82 || world.overlaps(px, pz, spec.length / 2)) return [];
      return [{ px, pz, yaw: Math.atan2(edge.dx * direction, edge.dz * direction) }];
    });
    const occupied = [...this.traffic, ...this.parked, ...this.police];
    if (this.playerVehicle) occupied.push(this.playerVehicle);
    const clear = spots.filter(({ px, pz }) =>
      occupied.every((car) => dist2D(px, pz, car.position.x, car.position.z) > 7),
    );
    if (clear.length === 0) return null;
    const spot = this.rng.pick(clear);
    const car = new Vehicle(spec, '#f2f2f2', 'police');
    car.position.set(spot.px, 0, spot.pz);
    car.yaw = spot.yaw;
    car.driver = 'police';
    const ai = new PoliceAI(this.rng.int(1, 9999));
    car.ai = ai;
    this.addToScene(car);
    this.police.push(car);
    return car;
  }

  /**
   * Build the shared context so every AI driver knows what is around it.
   * Called once per frame before the vehicles are updated.
   */
  prepareContext(
    playerPos: THREE.Vector3,
    playerVel: THREE.Vector3,
    world: CollisionWorld,
    time: number,
    /** Every vehicle in the world, including the player's own car. */
    allVehicles: Vehicle[] = [],
  ): void {
    this.time = time;
    const vehicles = allVehicles.length
      ? allVehicles
      : [...this.traffic, ...this.police, ...this.parked];
    if (this.playerVehicle && !vehicles.includes(this.playerVehicle)) vehicles.push(this.playerVehicle);

    const trafficContext = { vehicles };
    const policeContext = { vehicles, playerPos, playerVel, world };

    for (const car of this.traffic) {
      const ai = car.ai as TrafficAI | null;
      if (!ai) continue;
      ai.roadContext = trafficContext;
      ai.time = time;
    }
    for (const car of this.police) {
      const ai = car.ai as PoliceAI | null;
      if (!ai) continue;
      ai.roadContext = policeContext;
    }
  }

  /** Traffic vehicles around the player. */
  updateTraffic(dt: number, world: CollisionWorld, playerX: number, playerZ: number, time: number, camera?: THREE.Camera): void {
    this.time = time;
    void dt;
    camera?.updateMatrixWorld();
    const context = { vehicles: [] as Vehicle[] };

    // Recycle traffic that is too far away.
    for (let i = this.traffic.length - 1; i >= 0; i--) {
      const car = this.traffic[i];
      const d = dist2D(car.position.x, car.position.z, playerX, playerZ);
      // Never delete a car the player can see: that reads as a car vanishing.
      if (d > 220 && (d > 320 || !this.inView(car.position.x, car.position.z, camera))) {
        // Beyond 320 m a car is a speck inside the fog; only closer deletions count as a vanish.
        if (d <= 320 && this.inView(car.position.x, car.position.z, camera)) this.popOuts++;
        this.traffic.splice(i, 1);
        this.removeFromScene(car);
      }
    }

    while (this.traffic.length < this.maxTraffic) {
      let spawned = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        const node = this.roads.nodes[this.rng.int(0, this.roads.nodes.length - 1)];
        const d = dist2D(node.x, node.z, playerX, playerZ);
        if (d < 70 || d > 200) continue;
        if (node.edges.length === 0) continue;

        // Pick an outgoing edge and drop the car into the correct lane,
        // pointing the right way down the road.
        const edgeId = node.edges[this.rng.int(0, node.edges.length - 1)];
        const other = this.roads.otherEnd(edgeId, node.id);
        const otherNode = this.roads.nodes[other];
        const dx = otherNode.x - node.x;
        const dz = otherNode.z - node.z;
        const len = Math.hypot(dx, dz) || 1;
        const ux = dx / len;
        const uz = dz / len;
        const rx = -uz;
        const rz = ux;
        const along = len * this.rng.range(0.18, 0.82);

        const sx = node.x + ux * along + rx * LANE_OFFSET;
        const sz = node.z + uz * along + rz * LANE_OFFSET;
        // Pop-in and z-fighting guards: not on screen, not on top of another car.
        if (this.inView(sx, sz, camera) || dist2D(sx, sz, playerX, playerZ) < 70) continue;
        if (this.occupied(sx, sz)) continue;

        const spec = this.randomSpec();
        const car = new Vehicle(spec, this.randomPaint());
        car.position.set(sx, 0, sz);
        car.yaw = Math.atan2(ux, uz);
        car.driver = 'ai';
        const ai = new TrafficAI(this.roads, node.id, other, this.rng.int(1, 1_000_000));
        ai.roadContext = context;
        ai.time = this.time;
        car.ai = ai;
        if (this.inView(sx, sz, camera)) this.popIns++;
        this.addToScene(car);
        this.traffic.push(car);
        spawned = true;
        break;
      }
      if (!spawned) break; // no suitable node this frame
    }

    context.vehicles = [...this.traffic, ...this.police, ...this.parked];
    if (this.playerVehicle) context.vehicles.push(this.playerVehicle);
    void world;
  }

  /** True when a ground point projects inside (a padded) camera view. */
  private inView(x: number, z: number, camera?: THREE.Camera): boolean {
    if (!camera) return false;
    this.probe.set(x, 1, z).project(camera);
    return this.probe.z < 1 && Math.abs(this.probe.x) < 1.25 && Math.abs(this.probe.y) < 1.4;
  }

  /** Whether any existing vehicle is within a car-length of this point. */
  private occupied(x: number, z: number): boolean {
    for (const list of [this.traffic, this.parked, this.police]) {
      for (const c of list) if (dist2D(c.position.x, c.position.z, x, z) < 9) return true;
    }
    return !!this.playerVehicle && dist2D(this.playerVehicle.position.x, this.playerVehicle.position.z, x, z) < 9;
  }

  private probe = new THREE.Vector3();
  /** Counters for tests: cars created or deleted while on screen (should stay 0). */
  popIns = 0;
  popOuts = 0;

  updatePolice(dt: number, world: CollisionWorld, playerPos: THREE.Vector3, playerVel: THREE.Vector3, time: number): void {
    this.time = time;
    void dt;
    void world;
    void playerPos;
    void playerVel;
  }

  removePolice(count: number): void {
    for (let i = 0; i < count && this.police.length > 0; i++) {
      const car = this.police.pop();
      if (car) this.removeFromScene(car);
    }
  }

  /** Drop police units that have drifted far from the action. */
  removeDistantPolice(x: number, z: number, distance: number): void {
    for (let i = this.police.length - 1; i >= 0; i--) {
      const cop = this.police[i];
      if (dist2D(cop.position.x, cop.position.z, x, z) > distance) {
        this.police.splice(i, 1);
        this.removeFromScene(cop);
      }
    }
  }

  clear(): void {
    for (const car of this.traffic) this.removeFromScene(car);
    for (const car of this.parked) this.removeFromScene(car);
    for (const car of this.police) this.removeFromScene(car);
    this.traffic.length = 0;
    this.parked.length = 0;
    this.police.length = 0;
  }
}
