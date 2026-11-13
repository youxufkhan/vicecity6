import { clamp } from '../core/MathUtil';

export const MAX_WANTED = 5;

/**
 * Five-star wanted system. Heat accumulates from crimes and cools down once
 * the police lose sight of the player.
 */
export class Wanted {
  /** Fractional heat; the star level is floor(heat). */
  heat = 0;
  /** True while at least one police unit can see the player. */
  spotted = false;
  /** Seconds since the police last saw the player. */
  sinceSeen = 0;
  /** Grace period before the police can be dispatched. */
  dispatchDelay = 0;
  /** Seconds before officers can actually bust the player. */
  graceTimer = 0;

  get level(): number {
    return Math.min(MAX_WANTED, Math.floor(this.heat));
  }

  get active(): boolean {
    return this.level > 0;
  }

  add(amount: number): void {
    const before = this.level;
    this.heat = clamp(this.heat + amount, 0, MAX_WANTED);
    this.sinceSeen = 0;
    if (this.level > before) {
      this.dispatchDelay = 1.2;
      this.graceTimer = 3.5;
    }
  }

  clear(): void {
    this.heat = 0;
    this.spotted = false;
    this.sinceSeen = 0;
  }

  update(dt: number): void {
    if (this.dispatchDelay > 0) this.dispatchDelay -= dt;
    if (this.graceTimer > 0) this.graceTimer -= dt;
    if (this.spotted) {
      this.sinceSeen = 0;
    } else {
      this.sinceSeen += dt;
      // The police lose interest after a while out of sight.
      if (this.sinceSeen > 4.5 && this.heat > 0) {
        this.heat = Math.max(0, this.heat - dt * 0.45);
        if (this.heat < 0.6) this.heat = 0;
      }
    }
  }

  /** Progress towards the next star, 0..1. */
  get progress(): number {
    if (this.heat >= MAX_WANTED) return 1;
    return this.heat - Math.floor(this.heat);
  }
}
