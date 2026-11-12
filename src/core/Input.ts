/**
 * Keyboard / mouse / touch input.
 *
 * - `down(code)`     : held this frame
 * - `pressed(code)`  : went down this frame (consumed by `endFrame`)
 * - `lookX/lookY`    : accumulated mouse/touch delta since last frame
 * - Touch controls write into the same virtual axes so gameplay code never
 *   needs to know whether the player is on a keyboard or a phone.
 */

export const enum Axis {
  Forward = 'forward',
  Right = 'right',
}

const MOVE_KEYS: Record<string, [Axis, number]> = {
  KeyW: [Axis.Forward, 1],
  ArrowUp: [Axis.Forward, 1],
  KeyS: [Axis.Forward, -1],
  ArrowDown: [Axis.Forward, -1],
  KeyA: [Axis.Right, -1],
  ArrowLeft: [Axis.Right, -1],
  KeyD: [Axis.Right, 1],
  ArrowRight: [Axis.Right, 1],
};

export class Input {
  private held = new Set<string>();
  private pressedSet = new Set<string>();
  private releasedSet = new Set<string>();

  mouseButtons = 0;
  private mousePressed = new Set<number>();
  private mouseReleased = new Set<number>();

  lookX = 0;
  lookY = 0;
  wheel = 0;

  /** Virtual movement axes (touch stick + keys combined). */
  moveAxis = 0;
  strafeAxis = 0;

  pointerLocked = false;
  /** Set true while the game wants the pointer but cannot lock it. */
  enabled = true;

  private canvas: HTMLElement | null = null;
  private invertY = false;
  private sensitivity = 1;

  private touchMove = { x: 0, y: 0 };
  private touchButtons = new Set<string>();
  private touchPressed = new Set<string>();

  onPointerLockChange: ((locked: boolean) => void) | null = null;

  attach(canvas: HTMLElement): void {
    this.canvas = canvas;

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);

    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
  }

  setInvertY(v: boolean): void {
    this.invertY = v;
  }

  setSensitivity(v: number): void {
    this.sensitivity = v;
  }

  requestPointerLock(): void {
    if (!this.canvas) return;
    if (document.pointerLockElement !== this.canvas) {
      const el = this.canvas as HTMLElement & { requestPointerLock?: () => void };
      try {
        el.requestPointerLock?.();
      } catch {
        /* browser refused; the click-to-play overlay covers it */
      }
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code: string): boolean {
    return this.held.has(code);
  }

  pressed(code: string): boolean {
    return this.pressedSet.has(code);
  }

  released(code: string): boolean {
    return this.releasedSet.has(code);
  }

  anyPressed(...codes: string[]): boolean {
    for (const c of codes) if (this.pressedSet.has(c)) return true;
    return false;
  }

  mouseDown(button: number): boolean {
    return (this.mouseButtons & (1 << button)) !== 0;
  }

  mouseJustPressed(button: number): boolean {
    return this.mousePressed.has(button);
  }

  mouseJustReleased(button: number): boolean {
    return this.mouseReleased.has(button);
  }

  touchDown(name: string): boolean {
    return this.touchButtons.has(name);
  }

  touchJustPressed(name: string): boolean {
    return this.touchPressed.has(name);
  }

  /** Combined movement vector in local space: x = strafe, y = forward. */
  get moveX(): number {
    let v = 0;
    for (const code of this.held.keys()) {
      const m = MOVE_KEYS[code];
      if (m && m[0] === Axis.Right) v += m[1];
    }
    v += this.touchMove.x;
    return Math.max(-1, Math.min(1, v));
  }

  get moveY(): number {
    let v = 0;
    for (const code of this.held.keys()) {
      const m = MOVE_KEYS[code];
      if (m && m[0] === Axis.Forward) v += m[1];
    }
    v += this.touchMove.y;
    return Math.max(-1, Math.min(1, v));
  }

  setTouchMove(x: number, y: number): void {
    this.touchMove.x = x;
    this.touchMove.y = y;
  }

  setTouchButton(name: string, down: boolean): void {
    if (down) {
      if (!this.touchButtons.has(name)) this.touchPressed.add(name);
      this.touchButtons.add(name);
    } else {
      this.touchButtons.delete(name);
    }
  }

  /** Call once at the end of every rendered frame. */
  endFrame(): void {
    this.pressedSet.clear();
    this.releasedSet.clear();
    this.mousePressed.clear();
    this.mouseReleased.clear();
    this.touchPressed.clear();
    this.lookX = 0;
    this.lookY = 0;
    this.wheel = 0;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled) return;
    if (e.repeat) {
      e.preventDefault();
      return;
    }
    this.held.add(e.code);
    this.pressedSet.add(e.code);
    if (
      e.code === 'Space' ||
      e.code === 'Tab' ||
      e.code.startsWith('Arrow') ||
      (e.code === 'KeyM' && e.ctrlKey)
    ) {
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
    this.releasedSet.add(e.code);
  };

  private onBlur = (): void => {
    this.held.clear();
    this.mouseButtons = 0;
    this.touchButtons.clear();
  };

  private onVisibility = (): void => {
    if (document.hidden) this.onBlur();
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.enabled) return;
    this.mouseButtons |= 1 << e.button;
    this.mousePressed.add(e.button);
  };

  private onMouseUp = (e: MouseEvent): void => {
    this.mouseButtons &= ~(1 << e.button);
    this.mouseReleased.add(e.button);
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.enabled) return;
    if (this.pointerLocked) {
      this.lookX += e.movementX * 0.0022 * this.sensitivity;
      this.lookY += e.movementY * 0.0022 * this.sensitivity * (this.invertY ? -1 : 1);
    }
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.enabled) return;
    e.preventDefault();
    this.wheel += Math.sign(e.deltaY);
  };

  private handlePointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
    this.onPointerLockChange?.(this.pointerLocked);
  };
}
