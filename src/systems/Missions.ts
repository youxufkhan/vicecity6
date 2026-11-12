import * as THREE from 'three';
import { roadCenterX, roadCenterZ } from '../world/Layout';
import type { Vehicle } from '../entities/Vehicle';
import type { Wanted } from './Wanted';

export type StepKind = 'goto' | 'steal' | 'deliver' | 'collect' | 'escape' | 'destroy';

export interface MissionStep {
  kind: StepKind;
  text: string;
  marker?: THREE.Vector3;
  radius?: number;
  target?: Vehicle;
  count?: number;
  timeLimit?: number;
  /** Only completable on foot. */
  onFoot?: boolean;
  /** Only completable while driving. */
  driving?: boolean;
}

export interface Mission {
  id: string;
  title: string;
  reward: number;
  steps: MissionStep[];
  repeatable?: boolean;
}

export interface MissionContext {
  playerPos: THREE.Vector3;
  playerVehicle: Vehicle | null;
  wanted: Wanted;
  vehicles: Vehicle[];
  onObjective(title: string, objective: string): void;
  onComplete(mission: Mission): void;
  onFail(reason: string): void;
  setMarker(pos: THREE.Vector3 | null, radius: number): void;
  toast(text: string, kind: 'good' | 'bad' | 'gold'): void;
  spawnTargetVehicle(pos: THREE.Vector3): Vehicle;
  addMoney(amount: number): void;
}

const v = (x: number, z: number): THREE.Vector3 => new THREE.Vector3(x, 0, z);

/** Fixed points of interest used by the story missions. */
export const LOCATIONS = {
  safehouse: v(roadCenterX(3) + 6.5, roadCenterZ(5) - 9),
  garage: v(roadCenterX(1) - 6.5, roadCenterZ(2) + 6.5),
  package: v(roadCenterX(5) + 8.5, roadCenterZ(1) - 8.5),
  dropoff: v(roadCenterX(0) + 8.5, roadCenterZ(6) - 8.5),
  dock: v(roadCenterX(6) - 8.5, roadCenterZ(4) + 8.5),
  plant: v(roadCenterX(2) - 8.5, roadCenterZ(0) - 8.5),
};

export function buildMissionList(): Mission[] {
  return [
    {
      id: 'welcome',
      title: 'WELCOME TO NEON COAST',
      reward: 750,
      steps: [
        {
          kind: 'goto',
          text: 'Walk to the plaza marker',
          marker: LOCATIONS.safehouse,
          radius: 4.5,
          onFoot: true,
        },
        {
          kind: 'steal',
          text: 'Take any car you can find',
        },
      ],
    },
    {
      id: 'grand-theft',
      title: 'GRAND THEFT AUTO',
      reward: 2500,
      steps: [
        {
          kind: 'steal',
          text: 'Steal the marked sports car',
          target: undefined,
        },
        {
          kind: 'deliver',
          text: 'Deliver it to the garage',
          marker: LOCATIONS.garage,
          radius: 6,
          timeLimit: 150,
        },
      ],
    },
    {
      id: 'delivery',
      title: 'SPECIAL DELIVERY',
      reward: 1800,
      steps: [
        {
          kind: 'collect',
          text: 'Collect the package on foot',
          marker: LOCATIONS.package,
          radius: 4,
          onFoot: true,
        },
        {
          kind: 'goto',
          text: 'Deliver the package to the drop point',
          marker: LOCATIONS.dropoff,
          radius: 6,
          timeLimit: 120,
        },
      ],
    },
    {
      id: 'heat',
      title: 'HEAT',
      reward: 5000,
      steps: [
        {
          kind: 'escape',
          text: 'Lose the police',
          timeLimit: 240,
        },
      ],
    },
    {
      id: 'clean-sweep',
      title: 'CLEAN SWEEP',
      reward: 3500,
      steps: [
        {
          kind: 'destroy',
          text: 'Destroy the marked vehicles',
          count: 3,
        },
      ],
    },
    {
      id: 'courier',
      title: 'COURIER RUN',
      reward: 1200,
      repeatable: true,
      steps: [
        {
          kind: 'collect',
          text: 'Collect the package on foot',
          marker: LOCATIONS.dock,
          radius: 4.5,
          onFoot: true,
        },
        {
          kind: 'goto',
          text: 'Deliver the package to the plant',
          marker: LOCATIONS.plant,
          radius: 6,
          timeLimit: 150,
        },
      ],
    },
  ];
}

interface ActiveMission {
  def: Mission;
  stepIndex: number;
  timeLeft: number;
  destroyed: number;
  targets: Vehicle[];
}

/** Runs the mission state machine and owns the active objective. */
export class MissionSystem {
  private missions: Mission[];
  private active: ActiveMission | null = null;
  private availableIndex = 0;

  constructor(missions = buildMissionList()) {
    this.missions = missions;
  }

  get current(): Mission | null {
    return this.active?.def ?? null;
  }

  get step(): MissionStep | null {
    if (!this.active) return null;
    return this.active.def.steps[this.active.stepIndex] ?? null;
  }

  get timeLeft(): number {
    return this.active?.timeLeft ?? 0;
  }

  get marker(): THREE.Vector3 | null {
    return this.step?.marker ?? null;
  }

  get markerRadius(): number {
    return this.step?.radius ?? 4;
  }

  /** Start the next mission from the list. */
  startNext(ctx: MissionContext): boolean {
    if (this.availableIndex >= this.missions.length) {
      // Loop back to the repeatable mission at the end of the list.
      this.availableIndex = this.missions.length - 1;
    }
    const def = this.missions[this.availableIndex];
    if (!def) return false;
    this.active = {
      def,
      stepIndex: 0,
      timeLeft: def.steps[0].timeLimit ?? 0,
      destroyed: 0,
      targets: [],
    };
    if (def.repeatable) {
      this.availableIndex = this.missions.length - 1;
    } else {
      this.availableIndex = Math.min(this.availableIndex + 1, this.missions.length - 1);
    }
    this.prepare(ctx);
    return true;
  }

  private prepare(ctx: MissionContext): void {
    const step = this.step;
    if (!step || !this.active) return;

    // Missions that need a specific vehicle spawn one and mark it.
    if (step.kind === 'steal' && step.target === undefined && this.active.def.id === 'grand-theft') {
      const spot = LOCATIONS.garage.clone().add(new THREE.Vector3(26, 0, 18));
      const car = ctx.spawnTargetVehicle(spot);
      step.target = car;
    }

    if (step.kind === 'destroy') {
      this.active.targets = [];
      const spots = [LOCATIONS.dock, LOCATIONS.plant, LOCATIONS.dropoff];
      for (const spot of spots) {
        const car = ctx.spawnTargetVehicle(spot.clone().add(new THREE.Vector3(3, 0, 3)));
        this.active.targets.push(car);
      }
    }

    if (step.kind === 'escape') {
      ctx.wanted.add(2);
    }

    ctx.onObjective(this.active.def.title, step.text);
    ctx.setMarker(step.marker ?? null, step.radius ?? 4);
  }

  update(dt: number, ctx: MissionContext): void {
    if (!this.active) return;
    const step = this.step;
    if (!step) return;

    if (this.active.timeLeft > 0) {
      this.active.timeLeft -= dt;
      if (this.active.timeLeft <= 0) {
        ctx.onFail('Out of time');
        this.abort(ctx);
        return;
      }
    }

    let done = false;
    switch (step.kind) {
      case 'goto':
      case 'collect': {
        if (!step.marker) {
          done = true;
          break;
        }
        const d = ctx.playerPos.distanceTo(step.marker);
        if (d <= (step.radius ?? 4)) {
          if (step.onFoot && ctx.playerVehicle) {
            ctx.toast('Get out of the car first', 'bad');
            break;
          }
          done = true;
        }
        break;
      }
      case 'steal': {
        if (step.target) {
          done = ctx.playerVehicle === step.target;
        } else {
          done = ctx.playerVehicle !== null;
        }
        break;
      }
      case 'deliver': {
        if (!step.marker || !step.target) {
          done = true;
          break;
        }
        if (ctx.playerVehicle !== step.target) break;
        const d = ctx.playerPos.distanceTo(step.marker);
        if (d <= (step.radius ?? 5)) done = true;
        break;
      }
      case 'escape': {
        done = ctx.wanted.level === 0;
        break;
      }
      case 'destroy': {
        const alive = this.active.targets.filter((t) => !t.wrecked).length;
        this.active.destroyed = this.active.targets.length - alive;
        done = this.active.destroyed >= (step.count ?? 1);
        break;
      }
    }

    if (!done) return;

    this.active.stepIndex++;
    if (this.active.stepIndex >= this.active.def.steps.length) {
      const done = this.active.def;
      ctx.addMoney(done.reward);
      ctx.onComplete(done);
      this.active = null;
      ctx.setMarker(null, 0);
      return;
    }

    const next = this.step!;
    this.active.timeLeft = next.timeLimit ?? 0;
    ctx.onObjective(this.active.def.title, next.text);
    ctx.setMarker(next.marker ?? null, next.radius ?? 4);
  }

  abort(ctx: MissionContext): void {
    this.active = null;
    ctx.setMarker(null, 0);
  }

  reset(): void {
    this.active = null;
    this.availableIndex = 0;
  }
}
