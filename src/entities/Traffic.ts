import * as THREE from 'three';
import type { CollisionWorld } from '../systems/Collision';
import { angleDelta, clamp, clamp01, dist2D, rngFrom, type Rng } from '../core/MathUtil';
import { LANE_OFFSET, ROAD_WIDTH, type RoadNetwork } from '../world/Layout';
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
  private rng: Rng;
  /** Game clock, used for traffic light timing. */
  time = 0;
  /** Smoothed steering so the cars do not saw between the wheels. */
  private steerValue = 0;

  constructor(private roads: RoadNetwork, startNode: number, toNode?: number) {
    this.rng = rngFrom(startNode * 7919 + 13);
    this.from = startNode;
    this.to = toNode ?? this.roads.otherEnd(this.roads.nextEdge(startNode, null), startNode);
  }

  update(vehicle: Vehicle, dt: number): void {
    const pos = vehicle.position;
    const toNode = this.roads.nodes[this.to];
    const distToNode = dist2D(pos.x, pos.z, toNode.x, toNode.z);

    // Choose the next edge shortly before the intersection.
    if (this.nextEdge < 0 && distToNode < 24) {
      const edge = this.roads.nextEdge(this.to, this.edgeInto(this.to));
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

    // Traffic light: stop for red.
    const axis = Math.abs(dir.dx) > 0.5 ? 'x' : 'z';
    const signal = this.roads.signalState(this.to, axis, this.time);
    const stopDistance = distToNode - (ROAD_WIDTH / 2 + 3.5);
    if (signal !== 'green' && stopDistance < 16 && stopDistance > -2) {
      desiredSpeed = Math.min(desiredSpeed, Math.max(0, stopDistance * 0.75));
      if (stopDistance < 0.4) desiredSpeed = 0;
    }

    // Vehicle ahead: keep a safe gap and stop behind it.
    const ahead = this.vehicleAhead(vehicle);
    if (ahead > 0) {
      desiredSpeed = Math.min(desiredSpeed, Math.max(0, (ahead - 5.5) * 1.1));
    }

    // Speed control.
    const speed = vehicle.forwardSpeed;
    let throttle = 0;
    if (speed < desiredSpeed - 0.6) throttle = clamp((desiredSpeed - speed) * 0.45, 0.25, 1);
    else if (speed > desiredSpeed + 1.2) throttle = -1;

    this.stopped = desiredSpeed < 0.4;

    // Unstick: reverse if wedged.
    if (Math.abs(speed) < 0.4 && desiredSpeed > 2) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 2.4) {
        throttle = -0.8;
        steer = this.rng.chance(0.5) ? 0.7 : -0.7;
      }
    } else {
      this.stuckTimer = 0;
    }

    vehicle.setInput({ throttle, steer, handbrake: false });

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
      if (otherFx * fx + otherFz * fz < 0.35) continue;
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
    const t = Math.max(0, Math.min(1, 1));
    void t;
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
      steer = this.rng.chance(0.5) ? 0.8 : -0.8;
    } else if (Math.abs(speed) < 0.6 && dist > 12) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 1.6) {
        this.reverseTimer = 0.9;
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

  /** Spawn a police cruiser near a position. */
  spawnPolice(x: number, z: number): Vehicle {
    const spec = CAR_SPECS.sedan;
    const car = new Vehicle(spec, '#f2f2f2', 'police');
    const angle = this.rng.range(0, Math.PI * 2);
    const dist = this.rng.range(32, 62);
    car.position.set(x + Math.cos(angle) * dist, 0, z + Math.sin(angle) * dist);
    car.yaw = Math.atan2(x - car.position.x, z - car.position.z);
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
  updateTraffic(dt: number, world: CollisionWorld, playerX: number, playerZ: number, time: number): void {
    this.time = time;
    void dt;
    const context = { vehicles: [] as Vehicle[] };

    // Recycle traffic that is too far away.
    for (let i = this.traffic.length - 1; i >= 0; i--) {
      const car = this.traffic[i];
      const d = dist2D(car.position.x, car.position.z, playerX, playerZ);
      if (d > 220) {
        this.traffic.splice(i, 1);
        this.removeFromScene(car);
      }
    }

    while (this.traffic.length < this.maxTraffic) {
      let spawned = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        const node = this.roads.nodes[this.rng.int(0, this.roads.nodes.length - 1)];
        const d = dist2D(node.x, node.z, playerX, playerZ);
        if (d < 40 || d > 190) continue;
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

        const spec = this.randomSpec();
        const car = new Vehicle(spec, this.randomPaint());
        car.position.set(
          node.x + ux * along + rx * LANE_OFFSET,
          0,
          node.z + uz * along + rz * LANE_OFFSET,
        );
        car.yaw = Math.atan2(ux, uz);
        car.driver = 'ai';
        const ai = new TrafficAI(this.roads, node.id, other);
        ai.roadContext = context;
        ai.time = this.time;
        car.ai = ai;
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
