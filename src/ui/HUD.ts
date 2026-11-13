import { formatClock, formatMoney, WEEKDAYS } from '../core/MathUtil';
import { COLS, HALF_X, HALF_Z, ROAD_WIDTH, ROWS, roadCenterX, roadCenterZ } from '../world/Layout';

export interface RadarBlip {
  x: number;
  z: number;
  kind: 'mission' | 'target' | 'police' | 'vehicle' | 'ped' | 'pickup' | 'exit';
  label?: string;
}

export interface HudState {
  money: number;
  health: number;
  armor: number;
  wantedLevel: number;
  clock: number;
  day: number;
  speedKph: number;
  maxKph: number;
  weapon: string;
  weaponIcon: string;
  ammo: number;
  reserve: number;
  inVehicle: boolean;
  aiming: boolean;
  /** Crosshair gap in px, from the weapon's current spread. */
  spread: number;
  /** 0 none, 1 hit, 2 kill. */
  hitMarker: number;
}

const BLIP_COLORS: Record<RadarBlip['kind'], string> = {
  mission: '#ffd45e',
  target: '#35e0ff',
  police: '#ff2e88',
  vehicle: '#e8e6dc',
  ped: '#7f8490',
  pickup: '#58f5b5',
  exit: '#ff7a3d',
};

/** DOM based heads-up display plus the radar and speedometer canvases. */
export class HUD {
  private root = document.getElementById('hud')!;
  private moneyEl = document.getElementById('money')!;
  private healthEl = document.getElementById('health-fill')!;
  private armorEl = document.getElementById('armor-fill')!;
  private wantedEl = document.getElementById('wanted')!;
  private clockEl = document.getElementById('clock-time')!;
  private dayEl = document.getElementById('clock-day')!;
  private missionBanner = document.getElementById('mission-banner')!;
  private missionKicker = document.getElementById('mission-kicker')!;
  private missionTitle = document.getElementById('mission-title')!;
  private missionObjective = document.getElementById('mission-objective')!;
  private toastBox = document.getElementById('toasts')!;
  private crosshairEl = document.getElementById('crosshair')!;
  private lastSpread = -1;
  private promptEl = document.getElementById('prompt')!;
  private damageEl = document.getElementById('damage-flash')!;
  private wantedFlashEl = document.getElementById('wanted-flash')!;
  private speedLinesEl = document.getElementById('speed-lines')!;
  private weaponIconEl = document.getElementById('weapon-icon')!;
  private weaponNameEl = document.getElementById('weapon-name')!;
  private ammoEl = document.getElementById('ammo')!;
  private radarCanvas = document.getElementById('radar') as HTMLCanvasElement;
  private speedoCanvas = document.getElementById('speedo') as HTMLCanvasElement;
  private radarCtx = this.radarCanvas.getContext('2d')!;
  private speedoCtx = this.speedoCanvas.getContext('2d')!;

  private lastMoney = -1;
  private lastHealth = -1;
  private lastArmor = -1;
  private lastWanted = -1;
  private lastClock = '';
  private lastWeapon = '';
  private lastAmmo = '';
  private lastSpeed = -1;
  private stars: HTMLElement[];

  constructor() {
    this.stars = Array.from(this.wantedEl.querySelectorAll<HTMLElement>('.wanted-star'));
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
    this.root.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  update(state: HudState): void {
    if (state.money !== this.lastMoney) {
      this.lastMoney = state.money;
      this.moneyEl.textContent = formatMoney(state.money);
      this.moneyEl.classList.remove('bump');
      void this.moneyEl.offsetWidth;
      this.moneyEl.classList.add('bump');
    }

    if (state.health !== this.lastHealth) {
      this.lastHealth = state.health;
      this.healthEl.style.transform = `scaleX(${Math.max(0, Math.min(1, state.health / 100))})`;
    }
    if (state.armor !== this.lastArmor) {
      this.lastArmor = state.armor;
      this.armorEl.style.transform = `scaleX(${Math.max(0, Math.min(1, state.armor / 100))})`;
    }

    if (state.wantedLevel !== this.lastWanted) {
      this.lastWanted = state.wantedLevel;
      this.stars.forEach((star, i) => {
        const on = i < state.wantedLevel;
        star.classList.toggle('on', on);
        star.classList.toggle('blink', on && i === state.wantedLevel - 1);
      });
      this.wantedFlashEl.classList.toggle('on', state.wantedLevel > 0);
    }

    const clock = formatClock(state.clock);
    if (clock !== this.lastClock) {
      this.lastClock = clock;
      this.clockEl.textContent = clock;
      this.dayEl.textContent = WEEKDAYS[state.day % WEEKDAYS.length];
    }

    const weaponKey = `${state.weaponIcon}|${state.weapon}`;
    if (weaponKey !== this.lastWeapon) {
      this.lastWeapon = weaponKey;
      this.weaponIconEl.textContent = state.weaponIcon;
      this.weaponNameEl.textContent = state.weapon;
    }

    const ammoText = state.ammo > 0 ? `${state.ammo}` : state.weapon === 'UNARMED' ? '—' : '0';
    if (ammoText !== this.lastAmmo) {
      this.lastAmmo = ammoText;
      this.ammoEl.textContent = state.weapon === 'UNARMED' ? '—' : `${ammoText}/${state.reserve}`;
    }

    this.crosshairEl.classList.toggle('show', state.aiming);
    this.crosshairEl.classList.toggle('hit', state.hitMarker === 1);
    this.crosshairEl.classList.toggle('kill', state.hitMarker === 2);
    if (state.spread !== this.lastSpread) {
      this.lastSpread = state.spread;
      this.crosshairEl.style.setProperty('--gap', `${Math.min(40, 4 + state.spread)}px`);
    }
    this.speedLinesEl.style.opacity = state.inVehicle && state.speedKph > 150 ? '0.55' : '0';
    this.drawSpeedo(state.speedKph, state.maxKph);
  }

  setMission(title: string, objective: string): void {
    this.missionKicker.textContent = 'MISSION';
    this.missionTitle.textContent = title;
    this.missionObjective.textContent = objective;
    this.missionBanner.classList.add('show');
  }

  setObjective(objective: string): void {
    this.missionObjective.textContent = objective;
  }

  clearMission(): void {
    this.missionBanner.classList.remove('show');
  }

  setPrompt(text: string | null): void {
    if (text) {
      this.promptEl.innerHTML = text;
      this.promptEl.classList.add('show');
    } else {
      this.promptEl.classList.remove('show');
    }
  }

  toast(text: string, kind: 'good' | 'bad' | 'gold' = 'good'): void {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.toastBox.appendChild(el);
    window.setTimeout(() => {
      el.classList.add('out');
      window.setTimeout(() => el.remove(), 400);
    }, 2600);
  }

  damageFlash(): void {
    this.damageEl.classList.remove('hit');
    void this.damageEl.offsetWidth;
    this.damageEl.classList.add('hit');
  }

  /* ─────────────────── radar ─────────────────── */

  drawRadar(playerX: number, playerZ: number, playerYaw: number, blips: RadarBlip[], zoom = 1): void {
    const ctx = this.radarCtx;
    const size = this.radarCanvas.width;
    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 6;
    const scale = (radius / 110) * zoom;

    ctx.clearRect(0, 0, size, size);

    // Clip to the radar circle.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = '#0b1014';
    ctx.fillRect(0, 0, size, size);

    // Rotate the world so the player's heading points up.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(playerYaw + Math.PI);

    const wx = (x: number): number => (x - playerX) * scale;
    const wz = (z: number): number => (z - playerZ) * scale;

    // Water to the south.
    ctx.fillStyle = '#0d3f5c';
    ctx.fillRect(-size, wz(HALF_Z + ROAD_WIDTH / 2), size * 2, 2400);

    // Beach.
    ctx.fillStyle = '#4a4126';
    ctx.fillRect(-size, wz(HALF_Z + ROAD_WIDTH / 2), size * 2, Math.max(0, 90 * scale));

    // Roads.
    ctx.strokeStyle = '#565b63';
    ctx.lineWidth = Math.max(3, ROAD_WIDTH * scale);
    ctx.beginPath();
    for (let col = 0; col < COLS; col++) {
      const x = wx(roadCenterX(col));
      ctx.moveTo(x, -size * 2);
      ctx.lineTo(x, size * 2);
    }
    for (let row = 0; row < ROWS; row++) {
      const y = wz(roadCenterZ(row));
      ctx.moveTo(-size * 2, y);
      ctx.lineTo(size * 2, y);
    }
    ctx.stroke();

    ctx.restore();

    // Blips are drawn upright, in the same rotated frame as the roads.
    const cos = Math.cos(playerYaw);
    const sin = Math.sin(playerYaw);
    for (const blip of blips) {
      const dx = blip.x - playerX;
      const dz = blip.z - playerZ;
      const rx = (-dx * cos + dz * sin) * scale;
      const rz = (-dx * sin - dz * cos) * scale;
      const px = cx + rx;
      const py = cy + rz;
      if (Math.hypot(px - cx, py - cy) > radius - 4) continue;

      const color = BLIP_COLORS[blip.kind];
      ctx.fillStyle = color;
      if (blip.kind === 'mission' || blip.kind === 'target') {
        ctx.beginPath();
        ctx.moveTo(px, py - 6);
        ctx.lineTo(px + 5, py + 4);
        ctx.lineTo(px - 5, py + 4);
        ctx.closePath();
        ctx.fill();
      } else if (blip.kind === 'police') {
        ctx.beginPath();
        ctx.arc(px, py, 3.4, 0, Math.PI * 2);
        ctx.fill();
      } else if (blip.kind === 'ped') {
        ctx.fillRect(px - 1, py - 1, 2, 2);
      } else {
        ctx.fillRect(px - 2, py - 2, 4, 4);
      }
    }

    // Player arrow.
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 7);
    ctx.lineTo(cx + 5, cy + 6);
    ctx.lineTo(cx, cy + 3);
    ctx.lineTo(cx - 5, cy + 6);
    ctx.closePath();
    ctx.fill();

    // North marker.
    const nx = cx - Math.sin(playerYaw) * (radius - 14);
    const ny = cy + Math.cos(playerYaw) * (radius - 14);
    ctx.fillStyle = 'rgba(255,46,136,0.9)';
    ctx.font = '700 11px "Inter", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny);

    ctx.restore();

    // Rim.
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  /* ─────────────────── world map ─────────────────── */

  private mapCanvas = document.getElementById('worldmap-canvas') as HTMLCanvasElement;
  private mapEl = document.getElementById('worldmap')!;
  private mapCtx = this.mapCanvas.getContext('2d')!;

  get mapOpen(): boolean {
    return this.mapEl.classList.contains('show');
  }

  toggleMap(): boolean {
    const open = !this.mapOpen;
    this.mapEl.classList.toggle('show', open);
    return open;
  }

  closeMap(): void {
    this.mapEl.classList.remove('show');
  }

  drawWorldMap(playerX: number, playerZ: number, playerYaw: number, blips: RadarBlip[]): void {
    const ctx = this.mapCtx;
    const w = this.mapCanvas.width;
    const h = this.mapCanvas.height;
    const spanX = HALF_X * 2 + 140;
    const spanZ = HALF_Z * 2 + 200;
    const scale = Math.min(w / spanX, h / spanZ);
    const cx = w / 2;
    const cy = h / 2;
    const wx = (x: number): number => cx + (x - playerX) * scale;
    const wz = (z: number): number => cy + (z - playerZ) * scale;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0a0d12';
    ctx.fillRect(0, 0, w, h);

    // Water and beach to the south.
    ctx.fillStyle = '#0d3f5c';
    ctx.fillRect(0, wz(HALF_Z + ROAD_WIDTH / 2), w, h);
    ctx.fillStyle = '#3f3a24';
    ctx.fillRect(0, wz(HALF_Z + ROAD_WIDTH / 2), w, 90 * scale);

    // City blocks.
    ctx.fillStyle = '#1b1f27';
    for (let col = 0; col < COLS - 1; col++) {
      for (let row = 0; row < ROWS - 1; row++) {
        const x0 = wx(roadCenterX(col) + ROAD_WIDTH / 2);
        const x1 = wx(roadCenterX(col + 1) - ROAD_WIDTH / 2);
        const z0 = wz(roadCenterZ(row) + ROAD_WIDTH / 2);
        const z1 = wz(roadCenterZ(row + 1) - ROAD_WIDTH / 2);
        ctx.fillRect(x0, z0, x1 - x0, z1 - z0);
      }
    }

    // Roads.
    ctx.strokeStyle = '#4a505a';
    ctx.lineWidth = Math.max(2, ROAD_WIDTH * scale * 0.8);
    ctx.beginPath();
    for (let col = 0; col < COLS; col++) {
      const x = wx(roadCenterX(col));
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let row = 0; row < ROWS; row++) {
      const y = wz(roadCenterZ(row));
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();

    // Blips.
    for (const blip of blips) {
      const px = wx(blip.x);
      const py = wz(blip.z);
      const color = BLIP_COLORS[blip.kind];
      ctx.fillStyle = color;
      if (blip.kind === 'mission' || blip.kind === 'target') {
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 11, 0, Math.PI * 2);
        ctx.stroke();
      } else if (blip.kind === 'police') {
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(px - 2, py - 2, 4, 4);
      }
    }

    // Player.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-playerYaw);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(7, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /* ─────────────────── speedometer ─────────────────── */

  private drawSpeedo(speed: number, max: number): void {
    const rounded = Math.round(speed);
    if (rounded === this.lastSpeed) return;
    this.lastSpeed = rounded;

    const ctx = this.speedoCtx;
    const size = this.speedoCanvas.width;
    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 12;
    const start = Math.PI * 0.78;
    const end = Math.PI * 2.22;
    const t = Math.min(1, speed / Math.max(60, max));

    ctx.clearRect(0, 0, size, size);

    // Track.
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, end);
    ctx.stroke();

    // Value.
    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, '#35e0ff');
    gradient.addColorStop(0.6, '#ff2e88');
    gradient.addColorStop(1, '#ffd45e');
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, start + (end - start) * t);
    ctx.stroke();

    // Ticks.
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 8; i++) {
      const a = start + ((end - start) * i) / 8;
      const r1 = radius - 12;
      const r2 = radius - 4;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.stroke();
    }

    // Needle.
    const a = start + (end - start) * t;
    ctx.strokeStyle = '#ffd45e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(a) * 10, cy - Math.sin(a) * 10);
    ctx.lineTo(cx + Math.cos(a) * (radius - 16), cy + Math.sin(a) * (radius - 16));
    ctx.stroke();

    // Readout.
    ctx.fillStyle = '#f6f1ff';
    ctx.textAlign = 'center';
    ctx.font = '700 30px "JetBrains Mono", Consolas, monospace';
    ctx.fillText(String(rounded), cx, cy + 12);
    ctx.fillStyle = 'rgba(246,241,255,0.5)';
    ctx.font = '600 11px "Inter", system-ui, sans-serif';
    ctx.fillText('KM/H', cx, cy + 28);
  }
}
