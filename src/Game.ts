import * as THREE from 'three';
import { Input } from './core/Input';
import { clamp, clamp01, dist2D, formatMoney, rngFrom } from './core/MathUtil';
import { buildCity, type City } from './world/City';
import { buildProps, type Props } from './world/Props';
import { Sky } from './world/Sky';
import { COLS, HALF_X, HALF_Z, SIDEWALK_WIDTH, roadCenterX, roadCenterZ } from './world/Layout';
import { Player } from './entities/Player';
import { Vehicle, resolveVehiclePairs } from './entities/Vehicle';
import { TrafficManager, type TrafficAI } from './entities/Traffic';
import { PedManager, type Pedestrian } from './entities/Pedestrian';
import { FootCop, FootCopManager } from './entities/FootCop';
import { CAR_SPECS, CIVIL_PAINT, headlightMaterial, tailMaterial } from './entities/CarFactory';
import { CameraRig } from './systems/CameraRig';
import { Effects } from './systems/Effects';
import { Wanted } from './systems/Wanted';
import { WeaponSystem, WEAPONS } from './systems/Weapons';
import { MissionSystem, type Mission } from './systems/Missions';
import { AudioSystem } from './systems/Audio';
import { HUD, type RadarBlip } from './ui/HUD';
import { Menus, type Settings } from './ui/Menus';

export type GameState = 'title' | 'playing' | 'paused' | 'wasted' | 'clear';

interface Pickup {
  kind: 'cash' | 'health' | 'armor' | 'weapon';
  x: number;
  z: number;
  value: number;
  weapon?: string;
  mesh: THREE.Mesh;
  spin: number;
}

const STEP = 1 / 60;
// The starter car waits in the right-hand lane of the row-4 avenue.
const START_CAR_POSITION = new THREE.Vector3(roadCenterX(3) + 4.2, 0, roadCenterZ(4) + 4.2);
const START_POSITION = new THREE.Vector3(roadCenterX(3) + 7.6, 0, roadCenterZ(4) + 6.6);

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cameraRig: CameraRig;
  readonly input = new Input();
  readonly audio = new AudioSystem();
  readonly hud = new HUD();
  readonly menus: Menus;

  private city: City;
  private props: Props;
  private sky: Sky;
  private effects: Effects;
  private player = new Player();
  private traffic: TrafficManager;
  private peds: PedManager;
  private weapons: WeaponSystem;
  private missions: MissionSystem;
  private wanted = new Wanted();
  private footCops: FootCopManager;

  private state: GameState = 'title';
  private accumulator = 0;
  private lastTime = performance.now();
  private elapsed = 0;
  private paused = false;
  private startCar: Vehicle | null = null;
  private pickups: Pickup[] = [];
  private neonLights: THREE.PointLight[] = [];
  private markerMesh: THREE.Mesh;
  private markerRing: THREE.Mesh;
  private targetRing: THREE.Mesh;
  private weaponAimOrigin = new THREE.Vector3();
  private weaponAimDir = new THREE.Vector3(0, 0, -1);
  private weaponTargets: Vehicle[] = [];
  private touchMode = false;
  /** Guards the pointer-lock release that happens when the map opens. */
  private mapPointerGuard = false;
  private rng = rngFrom(4242);
  private missionCooldown = 0;
  private lastPrompt = '';
  private hudState = {
    money: 0,
    health: 100,
    armor: 0,
    wantedLevel: 0,
    clock: 0.38,
    day: 0,
    speedKph: 0,
    maxKph: 220,
    weapon: 'UNARMED',
    weaponIcon: '✊',
    ammo: 0,
    reserve: 0,
    inVehicle: false,
    aiming: false,
    spread: 0,
    hitMarker: 0,
  };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.cameraRig = new CameraRig(window.innerWidth / window.innerHeight);
    this.sky = new Sky(this.scene);
    this.city = buildCity();
    this.scene.add(this.city.group);
    this.props = buildProps(this.city);
    this.scene.add(this.props.group);

    const neonLightColors = [0xff2e88, 0x35e0ff, 0x58f5b5];
    const neonLightPositions = [
      new THREE.Vector3(roadCenterX(2), 8, roadCenterZ(2)),
      new THREE.Vector3(roadCenterX(4), 8, roadCenterZ(4)),
      new THREE.Vector3(roadCenterX(1), 8, roadCenterZ(5)),
    ];
    this.neonLights = neonLightPositions.map((pos, i) => {
      const light = new THREE.PointLight(neonLightColors[i], 0, 60, 1.6);
      light.position.copy(pos);
      this.scene.add(light);
      return light;
    });
    this.effects = new Effects(this.scene);
    this.footCops = new FootCopManager(this.scene);

    this.traffic = new TrafficManager(this.scene, this.city.roads, this.city.carSpawns, {
      maxTraffic: 20,
      maxParked: 16,
    });
    this.traffic.populateParked();
    // Keep the parking spot next to the player clear.
    for (let i = this.traffic.parked.length - 1; i >= 0; i--) {
      const parked = this.traffic.parked[i];
      if (dist2D(parked.position.x, parked.position.z, START_CAR_POSITION.x, START_CAR_POSITION.z) < 16) {
        this.traffic.parked.splice(i, 1);
        this.scene.remove(parked.group);
        parked.dispose();
      }
    }
    this.peds = new PedManager(
      this.scene,
      this.city.pedSpawns,
      this.city.blocks.map((b) => ({ x: b.cx, z: b.cz })),
      // One sidewalk loop per city block, centred in the pavement ring.
      this.city.blocks.map((b) => ({
        x0: b.minX + SIDEWALK_WIDTH / 2,
        z0: b.minZ + SIDEWALK_WIDTH / 2,
        x1: b.maxX - SIDEWALK_WIDTH / 2,
        z1: b.maxZ - SIDEWALK_WIDTH / 2,
      })),
    );

    this.scene.add(this.player.group);

    this.markerMesh = this.createMarker('#ffd45e');
    this.markerRing = this.createRing('#ffd45e');
    this.targetRing = this.createRing('#35e0ff');
    this.scene.add(this.markerMesh, this.markerRing, this.targetRing);
    this.markerMesh.visible = false;
    this.markerRing.visible = false;
    this.targetRing.visible = false;

    this.weapons = new WeaponSystem({
      world: this.city.collision,
      peds: this.peds.peds,
      cops: this.footCops.cops,
      vehicles: this.weaponTargets,
      effects: this.effects,
      audio: this.audio,
      playerPos: this.player.position,
      aimOrigin: this.weaponAimOrigin,
      aimDir: this.weaponAimDir,
      onPedHit: (ped, damage, killed) => this.onPedHit(ped, damage, killed),
      onCopHit: (cop, damage, killed) => this.onCopHit(cop, damage, killed),
      onVehicleHit: (vehicle, damage) => this.onVehicleHit(vehicle, damage),
      onShot: (weapon) => this.onShot(weapon.id),
    });

    // The player starts armed, so the combat systems are usable from the off.
    this.weapons.give('pistol', WEAPONS.pistol.reserve);
    this.player.setWeapon('pistol');

    this.missions = new MissionSystem();

    this.menus = new Menus({
      onStart: () => this.startGame(),
      onResume: () => this.resumeGame(),
      onQuit: () => this.quitToTitle(),
      onRespawn: () => this.respawn(),
      onContinue: () => this.continueAfterClear(),
      onSettings: (settings) => this.applySettings(settings),
      onUiClick: () => {
        this.audio.play('ui');
        if (this.state === 'playing' && !this.paused) {
          this.menus.setClickToPlay(false);
          this.requestPointerLock();
        }
      },
    });

    this.applySettings(this.menus.settings);
    this.setupInput(canvas);
    this.setupTouch();

    this.player.position.copy(START_POSITION);
    this.player.yaw = Math.atan2(
      START_CAR_POSITION.x - START_POSITION.x,
      START_CAR_POSITION.z - START_POSITION.z,
    );
    this.cameraRig.yaw = this.player.yaw + Math.PI;

    this.spawnStartCar();
    this.spawnPickups();

    window.addEventListener('resize', () => this.onResize());
    this.onResize();
  }

  /* ─────────────────── setup ─────────────────── */

  private setupInput(canvas: HTMLCanvasElement): void {
    this.input.attach(canvas);
    this.input.onPointerLockChange = (locked) => {
      if (locked) return;
      if (this.mapPointerGuard) {
        // We released the pointer on purpose to open the map.
        this.mapPointerGuard = false;
        return;
      }
      if (this.hud.mapOpen) {
        this.hud.closeMap();
        return;
      }
      if (this.state === 'playing' && !this.paused) this.pauseGame();
    };
    canvas.addEventListener('click', () => {
      if (this.state === 'playing' && !this.paused) {
        this.audio.init();
        this.requestPointerLock();
      }
    });
  }

  private setupTouch(): void {
    const touchRoot = document.getElementById('touch')!;
    if (!('ontouchstart' in window)) return;
    this.touchMode = matchMedia('(pointer: coarse)').matches;
    touchRoot.classList.add('on');

    const stick = document.getElementById('stick')!;
    const knob = document.getElementById('stick-knob')!;
    let stickId: number | null = null;
    let origin = { x: 0, y: 0 };

    const onStart = (e: TouchEvent): void => {
      if (stickId !== null) return;
      const t = e.changedTouches[0];
      stickId = t.identifier;
      const rect = stick.getBoundingClientRect();
      origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    const onMove = (e: TouchEvent): void => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== stickId) continue;
        const dx = clamp((t.clientX - origin.x) / 52, -1, 1);
        const dy = clamp((t.clientY - origin.y) / 52, -1, 1);
        this.input.setTouchMove(dx, -dy);
        knob.style.transform = `translate(${dx * 34}px, ${dy * 34}px)`;
      }
    };
    const onEnd = (e: TouchEvent): void => {
      if (!Array.from(e.changedTouches).some((t) => t.identifier === stickId)) return;
      stickId = null;
      this.input.setTouchMove(0, 0);
      knob.style.transform = '';
    };
    stick.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);

    const canvas = this.renderer.domElement;
    let lookId: number | null = null;
    let lookX = 0;
    let lookY = 0;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || lookId !== null) return;
      lookId = e.pointerId;
      lookX = e.clientX;
      lookY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== lookId) return;
      this.input.addLook(e.clientX - lookX, e.clientY - lookY);
      lookX = e.clientX;
      lookY = e.clientY;
    });
    canvas.addEventListener('lostpointercapture', (e) => {
      if (e.pointerId === lookId) lookId = null;
    });

    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-touch]')) {
      const name = button.dataset.touch!;
      button.addEventListener('pointerdown', (e) => {
        if (!e.isPrimary && e.pointerType !== 'touch') return;
        e.preventDefault();
        button.setPointerCapture(e.pointerId);
        this.input.setTouchButton(name, true);
      });
      button.addEventListener('lostpointercapture', () => this.input.setTouchButton(name, false));
    }
  }

  private requestPointerLock(): void {
    if (!this.touchMode) this.input.requestPointerLock();
  }

  private applySettings(settings: Settings): void {
    this.renderer.shadowMap.enabled = settings.shadows;
    this.renderer.setPixelRatio(
      settings.quality === 'low'
        ? 0.75
        : settings.quality === 'medium'
          ? Math.min(window.devicePixelRatio, 1.2)
          : Math.min(window.devicePixelRatio, 1.75),
    );
    this.sky.sun.castShadow = settings.shadows;
    this.input.setInvertY(settings.invertY);
    this.input.setSensitivity(settings.sensitivity / 100);
    this.audio.setVolume(settings.volume / 100);
    this.onResize();
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.cameraRig.resize(w / h);
  }

  private createMarker(color: string): THREE.Mesh {
    const geo = new THREE.CylinderGeometry(2.4, 2.4, 5, 24, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 2.5;
    return mesh;
  }

  private createRing(color: string): THREE.Mesh {
    const geo = new THREE.RingGeometry(2.2, 3, 32);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.08;
    return mesh;
  }

  private spawnStartCar(): void {
    const car = new Vehicle(CAR_SPECS.coupe, '#e23b3b');
    car.position.copy(START_CAR_POSITION);
    car.yaw = Math.PI / 2;
    car.driver = 'none';
    car.group.userData.kind = 'vehicle';
    this.startCar = car;
    this.scene.add(car.group);
  }

  private spawnPickups(): void {
    const cashGeo = new THREE.BoxGeometry(0.7, 0.28, 0.36);
    const cashMat = new THREE.MeshStandardMaterial({ color: 0x2fbf6b, emissive: 0x0d5c31, roughness: 0.5 });
    const healthGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const healthMat = new THREE.MeshStandardMaterial({ color: 0xff5577, emissive: 0x7a0f22, roughness: 0.5 });
    const armorGeo = new THREE.BoxGeometry(0.6, 0.6, 0.22);
    const armorMat = new THREE.MeshStandardMaterial({ color: 0x35e0ff, emissive: 0x0b4b63, roughness: 0.5 });

    const place = (kind: Pickup['kind'], geo: THREE.BufferGeometry, mat: THREE.Material, x: number, z: number, value: number, weapon?: string): void => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, 0.6, z);
      this.scene.add(mesh);
      this.pickups.push({ kind, x, z, value, mesh, spin: 0, weapon });
    };

    // Health and armour pickups scattered around the streets.
    for (let i = 0; i < 10; i++) {
      const x = this.rng.range(-HALF_X + 30, HALF_X - 30);
      const z = this.rng.range(-HALF_Z + 30, HALF_Z - 30);
      place('health', healthGeo, healthMat, x, z, 35);
    }
    for (let i = 0; i < 6; i++) {
      const x = this.rng.range(-HALF_X + 30, HALF_X - 30);
      const z = this.rng.range(-HALF_Z + 30, HALF_Z - 30);
      place('armor', armorGeo, armorMat, x, z, 50);
    }
    // Cash piles.
    for (let i = 0; i < 16; i++) {
      const x = this.rng.range(-HALF_X + 20, HALF_X - 20);
      const z = this.rng.range(-HALF_Z + 20, HALF_Z - 20);
      place('cash', cashGeo, cashMat, x, z, this.rng.int(40, 220));
    }
    // Weapons.
    const weaponSpots: { pos: THREE.Vector3; weapon: 'pistol' | 'smg' | 'shotgun' }[] = [
      { pos: new THREE.Vector3(roadCenterX(2) + 10, 0, roadCenterZ(2) + 10), weapon: 'smg' },
      { pos: new THREE.Vector3(roadCenterX(5) - 10, 0, roadCenterZ(4) - 10), weapon: 'shotgun' },
    ];
    const weaponGeo = new THREE.BoxGeometry(0.9, 0.22, 0.28);
    const weaponMat = new THREE.MeshStandardMaterial({ color: 0xffd45e, emissive: 0x6b4a00, roughness: 0.5 });
    for (const spot of weaponSpots) {
      place('weapon', weaponGeo, weaponMat, spot.pos.x, spot.pos.z, 0, spot.weapon);
    }
  }

  /* ─────────────────── state transitions ─────────────────── */

  startGame(): void {
    this.audio.init();
    this.audio.startMusic();
    this.state = 'playing';
    this.paused = false;
    this.hud.setVisible(true);
    this.menus.setClickToPlay(!this.touchMode);
    this.missionCooldown = 1.5;
  }

  pauseGame(): void {
    if (this.state !== 'playing') return;
    this.paused = true;
    this.state = 'paused';
    this.menus.show('pause');
    this.input.exitPointerLock();
    this.audio.suspend();
  }

  resumeGame(): void {
    this.state = 'playing';
    this.paused = false;
    this.menus.hide();
    this.audio.resume();
    this.requestPointerLock();
  }

  quitToTitle(): void {
    this.state = 'title';
    this.paused = false;
    this.hud.setVisible(false);
    this.hud.clearMission();
    this.menus.setClickToPlay(false);
    this.audio.resume();
    this.audio.stopMusic();
  }

  private onMissionComplete(mission: Mission): void {
    this.audio.play('mission');
    this.hud.toast(`${mission.title} — ${formatMoney(mission.reward)}`, 'gold');
    this.state = 'clear';
    this.menus.setClearSub(`${mission.title} · ${formatMoney(mission.reward)} banked`);
    this.menus.show('clear');
    this.input.exitPointerLock();
  }

  private continueAfterClear(): void {
    this.state = 'playing';
    this.hud.clearMission();
    this.missionCooldown = 2.5;
    this.requestPointerLock();
  }

  private respawn(): void {
    this.state = 'playing';
    this.player.dead = false;
    this.player.health = this.player.maxHealth;
    this.player.armor = 0;
    this.player.position.copy(START_POSITION);
    this.player.velocity.set(0, 0, 0);
    this.player.vehicle = null;
    this.player.setVisible(true);
    this.wanted.clear();
    this.traffic.removePolice(this.traffic.police.length);
    this.footCops.clear();
    this.missions.abort(this.missionContext());
    this.hud.clearMission();
    this.hud.setPrompt(null);
    this.addMoney(-Math.min(this.player.money, 500));
    this.requestPointerLock();
  }

  /* ─────────────────── main loop ─────────────────── */

  start(): void {
    this.lastTime = performance.now();
    const frame = (now: number): void => {
      const raw = (now - this.lastTime) / 1000;
      this.lastTime = now;
      const dt = Math.min(raw, 0.1);
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= STEP && steps < 5) {
        this.step(STEP);
        this.accumulator -= STEP;
        steps++;
      }
      if (steps === 5) this.accumulator = 0;
      this.render();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  private step(dt: number): void {
    this.update(dt);
    this.input.endStep();
  }

  private update(dt: number): void {
    if (this.state === 'paused' || (this.state === 'playing' && this.hud.mapOpen && !this.input.pressed('KeyM'))) return;
    this.elapsed += dt;

    switch (this.state) {
      case 'title':
        this.updateTitle(dt);
        break;
      case 'playing':
        this.updatePlaying(dt);
        break;
      case 'wasted':
      case 'clear':
        this.updateIdle(dt);
        break;
    }

    this.props.updateSignals(this.elapsed);
    this.props.setNight(this.sky.night);
    this.effects.update(dt);
  }

  private updateIdle(dt: number): void {
    // Keep the world breathing while the game is paused or a screen is up.
    this.sky.update(dt, this.player.position);
    if (this.city.waterTexture) {
      this.city.waterTexture.offset.x += 0.0006 * dt;
      this.city.waterTexture.offset.y += 0.0003 * dt;
    }
    const night = this.sky.night;
    for (const mat of this.city.facadeMaterials) mat.emissiveIntensity = night * 1.25;
    for (const mat of this.city.neonMaterials) mat.emissiveIntensity = 2.0 + night * 2.5;
    for (const l of this.neonLights) l.intensity = night * 14;
    for (const car of this.traffic.traffic) car.update(dt, this.city.collision);
    for (const car of this.traffic.police) car.update(dt, this.city.collision);
    resolveVehiclePairs([...this.traffic.traffic, ...this.traffic.police]);
    this.updatePickups(dt, false);
    this.cameraRig.update(
      dt,
      { position: this.player.position, heading: this.player.yaw, speed: 0 },
      this.state === 'clear' || this.state === 'wasted' ? 'cinematic' : 'foot',
      this.city.collision,
    );
  }

  private updateTitle(dt: number): void {
    this.sky.update(dt, new THREE.Vector3(0, 0, 0));
    if (this.city.waterTexture) {
      this.city.waterTexture.offset.x += 0.0006 * dt;
      this.city.waterTexture.offset.y += 0.0003 * dt;
    }
    const night = this.sky.night;
    for (const mat of this.city.facadeMaterials) mat.emissiveIntensity = night * 1.25;
    for (const mat of this.city.neonMaterials) mat.emissiveIntensity = 2.0 + night * 2.5;
    for (const l of this.neonLights) l.intensity = night * 14;
    const t = this.elapsed * 0.06;
    const cx = Math.cos(t) * 190;
    const cz = Math.sin(t) * 190;
    this.cameraRig.camera.position.set(cx, 95, cz);
    this.cameraRig.camera.lookAt(0, 18, 0);
    if (this.cameraRig.camera.fov !== 52) {
      this.cameraRig.camera.fov = 52;
      this.cameraRig.camera.updateProjectionMatrix();
    }
    for (const car of this.traffic.traffic) car.update(dt, this.city.collision);
    this.updatePickups(dt, false);
  }

  private updatePlaying(dt: number): void {
    const input = this.input;
    const world = this.city.collision;

    /* ── camera look ── */
    if (input.lookX !== 0 || input.lookY !== 0) {
      this.cameraRig.look(input.lookX, input.lookY);
    }

    /* ── world map ── */
    if (input.pressed('KeyM')) {
      const open = this.hud.toggleMap();
      if (open) {
        this.mapPointerGuard = this.input.pointerLocked;
        this.input.exitPointerLock();
      } else {
        this.requestPointerLock();
      }
    }
    if (this.hud.mapOpen) {
      // The map freezes the action but keeps the world alive.
      this.sky.update(dt, this.player.position);
      this.updateHud(this.allVehicles());
      return;
    }

    /* ── player / vehicle control ── */
    const driving = this.player.vehicle !== null;
    if (driving) {
      const car = this.player.vehicle!;
      const throttle = input.moveY;
      const steer = input.moveX;
      const handbrake = input.down('Space') || input.touchDown('run');
      car.setInput({ throttle, steer, handbrake });
    } else {
      const running = input.down('ShiftLeft') || input.down('ShiftRight') || input.touchDown('run');
      this.player.updateOnFoot(dt, input.moveX, input.moveY, this.cameraRig.yaw, running, world);
      if (input.pressed('Space')) this.player.jump();
    }

    const allVehicles = this.allVehicles();
    this.weaponTargets.length = 0;
    this.weaponTargets.push(...allVehicles);

    /* ── aiming and shooting ── */
    const touchFire = input.touchJustPressed('fire');
    const aiming = !driving && (input.mouseDown(2) || input.touchDown('fire') || touchFire);
    this.weapons.aiming = aiming;
    this.player.setAiming(aiming, dt);
    this.player.setWeapon(this.weapons.current);
    this.updateAim();
    if (!driving) {
      if (aiming) {
        // Face the way the camera looks.
        const f = this.cameraRig.forward;
        this.player.yaw = Math.atan2(f.x, f.z);
      }
      const firePressed = input.mouseJustPressed(0) || touchFire;
      const fireHeld = input.mouseDown(0) || input.touchDown('fire');
      const wantFire = input.pressed('KeyF') || (aiming && (firePressed || (this.weapons.def.automatic && fireHeld)));
      this.weapons.moveFactor = clamp(Math.hypot(this.player.velocity.x, this.player.velocity.z) / 7, 0, 1);
      this.weapons.update(dt, wantFire, input.pressed('KeyR'));
      // Drain accumulated recoil into the camera (muzzle climb).
      const kick = this.weapons.kick;
      if (kick.pitch !== 0 || kick.yaw !== 0) {
        this.cameraRig.look(kick.yaw, -kick.pitch);
        kick.pitch = 0;
        kick.yaw = 0;
      }
      if (input.pressed('KeyQ')) this.weapons.cycleWeapon();
    }
    if (driving && input.pressed('KeyH')) {
      // Horn: scatters the crowd.
      this.audio.play('horn');
      for (const ped of this.peds.peds) {
        if (dist2D(ped.position.x, ped.position.z, this.player.position.x, this.player.position.z) < 16) {
          ped.fleeFrom(this.player.position.x, this.player.position.z);
        }
      }
    }

    /* ── vehicles ── */
    this.traffic.playerVehicle = this.player.vehicle;
    this.traffic.prepareContext(
      this.player.position,
      this.player.vehicle ? this.player.vehicle.velocity : this.player.velocity,
      world,
      this.elapsed,
      allVehicles,
    );
    for (const car of allVehicles) {
      // The player's car is steered directly; the AI only drives the others.
      if (car.driver !== 'player' && !car.wrecked && car.ai) car.ai.update(car, dt);
      car.update(dt, world);
      if (car.wrecked && !car.destroyed) this.onVehicleWrecked(car);
    }
    resolveVehiclePairs(allVehicles, this.onVehiclePairImpact);
    if (this.player.vehicle) this.player.updateInVehicle(dt, this.player.vehicle);
    this.handleVehicleImpacts(allVehicles);

    /* ── traffic + police ── */
    this.traffic.updateTraffic(dt, world, this.player.position.x, this.player.position.z, this.elapsed, this.cameraRig.camera);

    /* ── pedestrians ── */
    this.peds.update(dt, world, this.player.position.x, this.player.position.z, allVehicles);
    this.handlePedCollisions(allVehicles);

    /* ── wanted ── */
    this.updateWanted(dt, allVehicles);

    /* ── missions ── */
    if (this.missionCooldown > 0) {
      this.missionCooldown -= dt;
      if (this.missionCooldown <= 0 && !this.missions.current) {
        this.missions.startNext(this.missionContext());
      }
    } else {
      this.missions.update(dt, this.missionContext());
    }

    /* ── pickups ── */
    this.updatePickups(dt, true);

    /* ── camera ── */
    const cameraTarget = this.player.vehicle
      ? {
          position: this.player.vehicle.position,
          heading: this.player.vehicle.yaw,
          speed: Math.abs(this.player.vehicle.forwardSpeed),
        }
      : { position: this.player.position, heading: this.player.yaw, speed: 0 };
    this.cameraRig.update(dt, cameraTarget, aiming ? 'aim' : driving ? 'vehicle' : 'foot', world);

    /* ── world ── */
    this.sky.update(dt, this.player.position);
    if (this.city.waterTexture) {
      this.city.waterTexture.offset.x += 0.0006 * dt;
      this.city.waterTexture.offset.y += 0.0003 * dt;
    }
    const night = this.sky.night;
    for (const mat of this.city.facadeMaterials) mat.emissiveIntensity = night * 1.25;
    for (const mat of this.city.neonMaterials) mat.emissiveIntensity = 2.0 + night * 2.5;
    for (const l of this.neonLights) l.intensity = night * 14;
    headlightMaterial.emissiveIntensity = 0.12 + night * 1.9;
    tailMaterial.emissiveIntensity = 0.3 + night * 0.5;

    /* ── audio ── */
    this.updateAudio(dt);

    /* ── hud ── */
    this.updateHud(allVehicles);
    this.handleInteractions();
  }

  /* ─────────────────── helpers ─────────────────── */

  private allVehicles(): Vehicle[] {
    const list: Vehicle[] = [];
    if (this.startCar) list.push(this.startCar);
    list.push(...this.traffic.traffic, ...this.traffic.parked, ...this.traffic.police);
    return list;
  }

  private missionContext(): {
    playerPos: THREE.Vector3;
    playerVehicle: Vehicle | null;
    wanted: Wanted;
    vehicles: Vehicle[];
    onObjective: (title: string, objective: string) => void;
    onComplete: (mission: Mission) => void;
    onFail: (reason: string) => void;
    setMarker: (pos: THREE.Vector3 | null, radius?: number) => void;
    toast: (text: string, kind: 'good' | 'bad' | 'gold') => void;
    spawnTargetVehicle: (pos: THREE.Vector3) => Vehicle;
    addMoney: (amount: number) => void;
  } {
    return {
      playerPos: this.player.position,
      playerVehicle: this.player.vehicle,
      wanted: this.wanted,
      vehicles: this.allVehicles(),
      onObjective: (title, objective) => this.hud.setMission(title, objective),
      onComplete: (mission) => this.onMissionComplete(mission),
      onFail: (reason) => {
        this.hud.toast(reason, 'bad');
        this.hud.clearMission();
        this.missionCooldown = 6;
      },
      setMarker: (pos) => this.setMissionMarker(pos),
      toast: (text, kind) => this.hud.toast(text, kind),
      spawnTargetVehicle: (pos) => this.spawnTargetVehicle(pos),
      addMoney: (amount) => this.addMoney(amount),
    };
  }

  private setMissionMarker(pos: THREE.Vector3 | null): void {
    this.markerMesh.visible = !!pos;
    this.markerRing.visible = !!pos;
    if (pos) {
      this.markerMesh.position.set(pos.x, 2.5, pos.z);
      this.markerRing.position.set(pos.x, 0.08, pos.z);
    }
  }

  private spawnTargetVehicle(pos: THREE.Vector3): Vehicle {
    const spec = CAR_SPECS[this.rng.chance(0.5) ? 'sports' : 'coupe'];
    const car = new Vehicle(spec, CIVIL_PAINT[this.rng.int(0, CIVIL_PAINT.length - 1)]);
    car.position.set(pos.x, 0, pos.z);
    car.yaw = this.rng.range(0, Math.PI * 2);
    car.driver = 'none';
    car.group.userData.kind = 'vehicle';
    this.scene.add(car.group);
    this.traffic.parked.push(car);
    return car;
  }

  private addMoney(amount: number): void {
    this.player.money = Math.max(0, this.player.money + amount);
    if (amount > 0) {
      this.hud.toast(`+${formatMoney(amount)}`, 'good');
      this.audio.play('cash');
    }
  }

  /* ─────────────────── interactions ─────────────────── */

  private handleInteractions(): void {
    const input = this.input;
    let prompt = '';
    const interact = input.pressed('KeyE') || input.touchJustPressed('action');
    const action = this.touchMode ? '<kbd>USE</kbd>' : '<kbd>E</kbd>';

    if (this.player.vehicle) {
      const speed = Math.abs(this.player.vehicle.forwardSpeed);
      if (speed < 6) {
        prompt = `${action} Get out`;
      } else {
        prompt = 'Slow down to exit';
      }
      if (interact && speed < 6) this.exitVehicle();
    } else {
      const nearest = this.nearestVehicle(4.5);
      if (nearest) {
        const label = nearest.spec.label;
        prompt = `${action} Enter ${label}`;
        if (interact) this.enterVehicle(nearest);
      }
    }

    if (prompt !== this.lastPrompt) {
      this.lastPrompt = prompt;
      this.hud.setPrompt(prompt || null);
    }
  }

  private nearestVehicle(maxDist: number): Vehicle | null {
    let best: Vehicle | null = null;
    let bestDist = maxDist;
    for (const car of this.allVehicles()) {
      const d = dist2D(car.position.x, car.position.z, this.player.position.x, this.player.position.z);
      if (d < bestDist && !car.wrecked && !this.city.collision.raycast(
        this.player.position.x, this.player.position.z, car.position.x, car.position.z,
      ).hit) {
        bestDist = d;
        best = car;
      }
    }
    return best;
  }

  private enterVehicle(car: Vehicle): void {
    this.player.vehicle = car;
    car.driver = 'player';
    car.ai = null;
    car.setInput({ throttle: 0, steer: 0, handbrake: false });
    this.player.setVisible(false);
    this.audio.play('ui');
    // Stealing a car in front of the police is a crime.
    if (this.wanted.level === 0 && this.policeNearby(28)) {
      this.wanted.add(1);
      this.hud.toast('Grand theft auto!', 'bad');
    }
  }

  private exitVehicle(): void {
    const car = this.player.vehicle;
    if (!car) return;
    if (!this.player.placeBeside(car, this.city.collision)) {
      this.hud.toast('No room to get out', 'bad');
      return;
    }
    this.player.vehicle = null;
    car.driver = 'none';
    car.setInput({ throttle: 0, steer: 0, handbrake: true });
    this.player.setVisible(true);
  }

  private policeNearby(dist: number): boolean {
    return this.traffic.police.some((p) => dist2D(p.position.x, p.position.z, this.player.position.x, this.player.position.z) < dist);
  }

  /* ─────────────────── crime & combat ─────────────────── */

  private onShot(weaponId: string): void {
    const heat = WEAPONS[weaponId as keyof typeof WEAPONS]?.heat ?? 0.3;
    this.wanted.add(heat);
    // Muzzle flash at weapon aim origin.
    this.effects.muzzleFlash(this.weaponAimOrigin.x, this.weaponAimOrigin.y, this.weaponAimOrigin.z);
    this.cameraRig.addShake(0.08);
    // Gunfire scatters the crowd.
    for (const ped of this.peds.peds) {
      if (dist2D(ped.position.x, ped.position.z, this.player.position.x, this.player.position.z) < 26) {
        ped.fleeFrom(this.player.position.x, this.player.position.z);
      }
    }
  }

  private onPedHit(ped: Pedestrian, damage: number, killed: boolean): void {
    void damage;
    if (killed) {
      this.wanted.add(0.8);
      this.hud.toast('Witness murdered', 'bad');
      // Drop cash.
      this.dropCash(ped.position.x, ped.position.z, this.rng.int(20, 90));
    } else {
      this.wanted.add(0.15);
    }
    this.audio.play('hit');
  }

  private onCopHit(cop: FootCop, damage: number, killed: boolean): void {
    void damage;
    if (killed) {
      this.wanted.add(1.0);
      this.hud.toast('Officer down', 'bad');
      this.dropCash(cop.position.x, cop.position.z, this.rng.int(100, 250));
    } else {
      this.wanted.add(0.25);
    }
    this.audio.play('hit');
  }

  private onVehicleHit(vehicle: Vehicle, damage: number): void {
    void damage;
    if (vehicle.driver === 'police' || this.traffic.police.includes(vehicle)) {
      this.wanted.add(0.35);
    }
  }

  private onVehiclePairImpact = (a: Vehicle, b: Vehicle, speed: number): void => {
    if (speed <= 6) return;
    if ((a.driver === 'player' && b.driver === 'police') ||
        (b.driver === 'player' && a.driver === 'police')) {
      this.wanted.add(0.3);
    }
  };

  private handleVehicleImpacts(vehicles: Vehicle[]): void {
    for (const car of vehicles) {
      const impact = car.lastImpactSpeed;
      car.lastImpactSpeed = 0;
      if (impact > 6) {
        this.audio.play('crash');
        this.cameraRig.addShake(clamp01(impact / 40) * 0.8);
        this.effects.sparks(car.position.x, 0.8, car.position.z, 10);
        if (car.driver === 'player') {
          this.player.damage(clamp(impact - 8, 0, 22));
          this.hud.damageFlash();
          this.cameraRig.addShake(0.22);
        }
      }
    }
  }

  private handlePedCollisions(vehicles: Vehicle[]): void {
    for (const car of vehicles) {
      if (Math.abs(car.forwardSpeed) < 3) continue;
      for (const ped of this.peds.peds) {
        if (ped.state === 'dead' || ped.state === 'stunned') continue;
        if (!car.overlapsCircle(ped.position.x, ped.position.z, 0.35)) continue;
        const killed = ped.damage(120);
        ped.stun();
        this.effects.blood(ped.position.x, 1, ped.position.z);
        // Only the player's driving counts as a crime.
        if (car.driver === 'player') {
          this.wanted.add(killed ? 0.6 : 0.3);
          this.hud.toast(killed ? 'You ran someone over' : 'You hit a pedestrian', 'bad');
        }
      }
      for (const cop of this.footCops.cops) {
        if (!cop.alive) continue;
        if (!car.overlapsCircle(cop.position.x, cop.position.z, 0.45)) continue;
        const killed = cop.damage(120);
        this.effects.blood(cop.position.x, 1, cop.position.z);
        if (car.driver === 'player') {
          this.wanted.add(killed ? 1.0 : 0.4);
          this.hud.toast(killed ? 'You ran over an officer' : 'You hit an officer', 'bad');
          if (killed) {
            this.dropCash(cop.position.x, cop.position.z, this.rng.int(100, 250));
          }
        }
      }
    }
  }

  private onVehicleWrecked(car: Vehicle): void {
    car.destroyed = true;
    car.setInput({ throttle: 0, steer: 0, handbrake: true });
    this.effects.explosion(car.position.x, 0.4, car.position.z);
    this.audio.play('explosion');
    this.cameraRig.addShake(0.9);
    if (car.driver === 'player') {
      // The player is thrown clear of the wreck.
      this.player.vehicle = null;
      car.driver = 'none';
      if (!this.player.placeBeside(car, this.city.collision)) {
        this.player.position.copy(car.position);
        this.player.velocity.set(0, 0, 0);
      }
      this.player.setVisible(true);
      this.player.damage(70);
      this.hud.damageFlash();
      if (this.player.dead) this.onPlayerDead('Your ride exploded');
    }
  }

  /* ─────────────────── wanted / police ─────────────────── */

  private updateWanted(dt: number, vehicles: Vehicle[]): void {
    // Can the police see the player?
    let spotted = false;
    for (const cop of this.traffic.police) {
      if (cop.wrecked || cop.driver !== 'police') continue;
      const d = dist2D(cop.position.x, cop.position.z, this.player.position.x, this.player.position.z);
      if (d > 85) continue;
      const hit = this.city.collision.raycast(cop.position.x, cop.position.z, this.player.position.x, this.player.position.z, 1.2);
      if (!hit.hit) {
        spotted = true;
        break;
      }
    }
    if (!spotted) {
      spotted = this.footCops.cops.some((cop) => cop.alive &&
        cop.distanceToPlayer(this.player.position.x, this.player.position.z) < 45 &&
        !this.city.collision.raycast(cop.position.x, cop.position.z, this.player.position.x, this.player.position.z, 1.2).hit);
    }
    this.wanted.spotted = spotted;
    this.wanted.update(dt);

    // Dispatch the right number of units.
    const wantedCount = Math.min(5, this.wanted.level);
    if (this.traffic.police.length < wantedCount && this.wanted.dispatchDelay <= 0) {
      this.traffic.spawnPolice(this.player.position.x, this.player.position.z, this.city.collision);
    }
    // Officers on foot: two from two stars, more as the heat climbs.
    const footCount = wantedCount >= 2 ? Math.min(4, wantedCount - 1) : 0;
    this.footCops.maintain(footCount, this.player.position.x, this.player.position.z, this.city.collision);
    if (footCount > 0) {
      for (const cop of this.footCops.cops) {
        const damage = cop.update(dt, this.city.collision, this.player.position, this.effects);
        if (damage > 0 && !this.player.vehicle) {
          this.player.damage(damage);
          this.hud.damageFlash();
          this.cameraRig.addShake(0.22);
          this.audio.play('hit');
        }
      }
    }
    if (this.wanted.level === 0 && this.traffic.police.length > 0) {
      // Units leave the area when the heat is gone.
      this.traffic.removeDistantPolice(this.player.position.x, this.player.position.z, 150);
    }

    // Busted: an officer right next to a pedestrian player.
    if (!this.player.vehicle && this.wanted.level > 0 && this.wanted.graceTimer <= 0) {
      for (const cop of this.footCops.cops) {
        if (cop.alive && cop.distanceToPlayer(this.player.position.x, this.player.position.z) < 2.6 &&
            !this.city.collision.raycast(cop.position.x, cop.position.z, this.player.position.x, this.player.position.z).hit) {
          this.onPlayerDead('The cops got you');
          return;
        }
      }
      for (const cop of this.traffic.police) {
        if (cop.wrecked || cop.driver !== 'police') continue;
        const d = dist2D(cop.position.x, cop.position.z, this.player.position.x, this.player.position.z);
        if (d < 5.2 && Math.abs(cop.forwardSpeed) < 6 &&
            !this.city.collision.raycast(cop.position.x, cop.position.z, this.player.position.x, this.player.position.z).hit) {
          this.onPlayerDead('The cops got you');
          return;
        }
      }
    }

    // Player health reaching zero.
    if (this.player.dead) {
      this.onPlayerDead('You were wasted');
    }
    void vehicles;
  }

  private onPlayerDead(reason: string): void {
    if (this.state !== 'playing') return;
    this.state = 'wasted';
    this.player.dead = true;
    if (this.player.vehicle) {
      this.player.vehicle.setInput({ throttle: 0, steer: 0, handbrake: true });
      this.player.vehicle.driver = 'none';
      this.player.vehicle = null;
    }
    this.audio.play('busted');
    this.menus.setWastedSub(reason);
    this.menus.show('wasted');
    this.input.exitPointerLock();
  }

  /* ─────────────────── pickups ─────────────────── */

  private dropCash(x: number, z: number, value: number): void {
    const geo = new THREE.BoxGeometry(0.7, 0.28, 0.36);
    const mat = new THREE.MeshStandardMaterial({ color: 0x2fbf6b, emissive: 0x0d5c31, roughness: 0.5 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0.6, z);
    this.scene.add(mesh);
    this.pickups.push({ kind: 'cash', x, z, value, mesh, spin: 0 });
  }

  private updatePickups(dt: number, collect: boolean): void {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pickup = this.pickups[i];
      pickup.spin += dt * 2.2;
      pickup.mesh.rotation.y = pickup.spin;
      pickup.mesh.position.y = 0.6 + Math.sin(pickup.spin * 1.6) * 0.12;
      if (!collect) continue;

      const d = dist2D(pickup.x, pickup.z, this.player.position.x, this.player.position.z);
      if (d > 2.4) continue;

      let taken = false;
      switch (pickup.kind) {
        case 'cash':
          this.addMoney(pickup.value);
          taken = true;
          break;
        case 'health':
          if (this.player.health < this.player.maxHealth) {
            this.player.heal(pickup.value);
            this.hud.toast('+Health', 'good');
            this.audio.play('pickup');
            taken = true;
          }
          break;
        case 'armor':
          if (this.player.armor < 100) {
            this.player.addArmor(pickup.value);
            this.hud.toast('+Armor', 'good');
            this.audio.play('pickup');
            taken = true;
          }
          break;
        case 'weapon':
          if (pickup.weapon) {
            const weapon = pickup.weapon as 'pistol' | 'smg' | 'shotgun';
            this.weapons.give(weapon, WEAPONS[weapon].reserve);
            this.hud.toast(`${WEAPONS[weapon].name} acquired`, 'good');
            this.audio.play('pickup');
            taken = true;
          }
          break;
      }
      if (taken) {
        this.scene.remove(pickup.mesh);
        pickup.mesh.geometry.dispose();
        this.pickups.splice(i, 1);
      }
    }
  }

  /* ─────────────────── audio ─────────────────── */

  private updateAudio(dt: number): void {
    void dt;
    const car = this.player.vehicle;
    if (car) {
      const rpm = clamp01(Math.abs(car.forwardSpeed) / car.spec.topSpeed);
      const load = clamp01(Math.abs(car.throttle));
      this.audio.setEngine(true, rpm * 0.8 + load * 0.2, load);
    } else {
      this.audio.setEngine(false, 0, 0);
    }

    let sirenIntensity = 0;
    for (const cop of this.traffic.police) {
      const d = dist2D(cop.position.x, cop.position.z, this.player.position.x, this.player.position.z);
      sirenIntensity = Math.max(sirenIntensity, clamp01(1 - d / 90));
    }
    this.audio.setSiren(sirenIntensity > 0.05, sirenIntensity);
  }

  /* ─────────────────── hud ─────────────────── */

  private updateHud(vehicles: Vehicle[]): void {
    const car = this.player.vehicle;
    const state = this.hudState;
    state.money = this.player.money;
    state.health = Math.round(this.player.health);
    state.armor = Math.round(this.player.armor);
    state.wantedLevel = this.wanted.level;
    state.clock = this.sky.clockFraction;
    state.day = Math.floor((this.elapsed / this.sky.dayLength) % 7);
    state.inVehicle = car !== null;
    state.aiming = this.weapons.aiming;
    state.spread = Math.round(this.weapons.currentSpread * 400);
    state.hitMarker = this.weapons.hitMarker > 0 ? (this.weapons.lastHitKill ? 2 : 1) : 0;
    state.speedKph = car ? car.speedKph : 0;
    state.maxKph = car ? car.spec.topSpeed * 3.6 : 220;
    state.weapon = this.weapons.def.name;
    state.weaponIcon = this.weapons.def.icon;
    state.ammo = this.weapons.inMagazine;
    state.reserve = this.weapons.reserveAmmo;
    this.hud.update(state);

    // Radar blips.
    const blips: RadarBlip[] = [];
    const marker = this.missions.marker;
    if (marker) blips.push({ x: marker.x, z: marker.z, kind: 'mission' });
    const step = this.missions.step;
    if (step?.target) blips.push({ x: step.target.position.x, z: step.target.position.z, kind: 'target' });
    for (const cop of this.traffic.police) {
      blips.push({ x: cop.position.x, z: cop.position.z, kind: 'police' });
    }
    for (const v of vehicles) {
      if (v.driver === 'player') continue;
      if (this.traffic.police.includes(v)) continue;
      const d = dist2D(v.position.x, v.position.z, this.player.position.x, this.player.position.z);
      if (d < 70) blips.push({ x: v.position.x, z: v.position.z, kind: 'vehicle' });
    }
    for (const pickup of this.pickups) {
      const d = dist2D(pickup.x, pickup.z, this.player.position.x, this.player.position.z);
      if (d < 95) blips.push({ x: pickup.x, z: pickup.z, kind: 'pickup' });
    }
    for (const ped of this.peds.peds) {
      const d = dist2D(ped.position.x, ped.position.z, this.player.position.x, this.player.position.z);
      if (d < 45) blips.push({ x: ped.position.x, z: ped.position.z, kind: 'ped' });
    }
    this.hud.drawRadar(this.player.position.x, this.player.position.z, this.player.yaw, blips);
    if (this.hud.mapOpen) {
      this.hud.drawWorldMap(this.player.position.x, this.player.position.z, this.player.yaw, blips);
    }

    // Mission marker animation.
    if (this.markerMesh.visible) {
      this.markerMesh.rotation.y += 0.01;
      const pulse = 1 + Math.sin(this.elapsed * 3) * 0.06;
      this.markerMesh.scale.set(pulse, 1, pulse);
    }
    if (this.markerRing.visible) {
      this.markerRing.rotation.y += 0.006;
    }

    // Highlight the mission target vehicle.
    const target = step?.target;
    this.targetRing.visible = !!target;
    if (target) {
      this.targetRing.position.set(target.position.x, 0.08, target.position.z);
      this.targetRing.rotation.y += 0.01;
    }
  }

  /* ─────────────────── render ─────────────────── */

  private render(): void {
    this.renderer.render(this.scene, this.cameraRig.camera);
  }

  /** Exposed for the smoke test harness. */
  get debugState(): Record<string, unknown> {
    // Count what is actually attached to the scene graph, not just what the
    // simulation knows about — a mismatch means something is not rendering.
    let renderedVehicles = 0;
    let renderedPeds = 0;
    for (const child of this.scene.children) {
      if (child.userData?.kind === 'vehicle') renderedVehicles++;
      else if (child.userData?.kind === 'ped') renderedPeds++;
    }
    return {
      state: this.state,
      position: this.player.position.toArray().map((v) => Math.round(v)),
      money: this.player.money,
      health: this.player.health,
      wanted: this.wanted.level,
      vehicles: this.allVehicles().length,
      traffic: this.traffic.traffic.length,
      peds: this.peds.peds.length,
      renderedVehicles,
      renderedPeds,
      mission: this.missions.current?.title ?? null,
      objective: this.missions.step?.text ?? null,
      weapon: this.weapons.def.name,
      ammo: this.weapons.inMagazine,
      reserve: this.weapons.reserveAmmo,
      inVehicle: this.player.vehicle !== null,
      police: this.traffic.police.length,
      camera: this.cameraRig.camera.position.toArray().map((v) => Math.round(v)),
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      fps: 0,
    };
  }

  debugStreetDetail(): { entrances: number } {
    let entrances = 0;
    this.city.group.traverse((object) => { entrances += Number(object.userData.entrances ?? 0); });
    return { entrances };
  }

  /** Used by the smoke test to hop into the closest car. */
  debugEnterNearestVehicle(): boolean {
    const nearest = this.nearestVehicle(60);
    if (!nearest) return false;
    this.enterVehicle(nearest);
    return true;
  }

  /** Used by the visual tour to frame the subject up close. */
  debugCloseCamera(distance: number): void {
    this.cameraRig.setDistance(distance);
  }

  /** Used by the visual tour to point the camera at a spot. */
  debugLookAt(x: number, z: number): void {
    this.cameraRig.yaw = Math.atan2(x - this.player.position.x, z - this.player.position.z) + Math.PI;
    this.cameraRig.pitch = 0.06;
  }

  /** Used by the smoke test to move the player around quickly. */
  debugTeleport(x: number, z: number): void {
    if (this.player.vehicle) {
      this.player.vehicle.position.set(x, 0, z);
      this.player.vehicle.velocity.set(0, 0, 0);
    }
    this.player.position.set(x, 0, z);
    this.player.velocity.set(0, 0, 0);
  }

  /** Marker position of the active objective (or null). */
  debugMissionMarker(): { x: number; z: number } | null {
    const marker = this.missions.marker;
    return marker ? { x: marker.x, z: marker.z } : null;
  }

  /** Used by the smoke test to step out of the car. */
  debugExitVehicle(): void {
    if (this.player.vehicle) {
      this.player.vehicle.setInput({ throttle: 0, steer: 0, handbrake: true });
      this.exitVehicle();
    }
  }

  /** Used by the smoke test to place a target in front of the player. */
  debugSpawnTarget(): { x: number; z: number } {
    const f = this.cameraRig.forward;
    const x = this.player.position.x + f.x * 9;
    const z = this.player.position.z + f.z * 9;
    const ped = this.peds.spawnAt(x, z);
    ped.setTarget(x + f.x * 20, z + f.z * 20);
    return { x: ped.position.x, z: ped.position.z };
  }

  /** Used by the smoke test to trigger a police response. */
  debugRaiseWanted(level: number): void {
    this.wanted.add(level);
  }

  /**
   * Used by the smoke test: puts a pedestrian in front of the player, aims
   * at them and fires. Returns whether the shot connected.
   */
  debugShootTest(): { killed: boolean; wanted: number; pedHealth: number } {
    const f = this.cameraRig.forward;
    const px = this.player.position.x + f.x * 9;
    const pz = this.player.position.z + f.z * 9;
    const ped = this.peds.spawnAt(px, pz);
    ped.health = 100;
    ped.setTarget(px + f.x * 20, pz + f.z * 20);

    // Point the camera at the target.
    const dx = px - this.player.position.x;
    const dz = pz - this.player.position.z;
    this.cameraRig.yaw = Math.atan2(-dx, -dz);
    this.cameraRig.pitch = 0.03;
    this.weapons.give('pistol', 48);
    this.updateAim();
    for (let i = 0; i < 5; i++) {
      this.weapons.update(0.2, true, false);
    }
    return { killed: ped.state === 'dead', wanted: this.wanted.level, pedHealth: ped.health };
  }

  /**
   * Third person aiming: the camera ray decides the aim point on the chest
   * plane, then the bullet is fired from the player's muzzle towards it.
   */
  private aimProbe = new THREE.Vector3();

  private updateAim(): void {
    const cam = this.cameraRig.camera;
    const dir = this.weaponAimDir;
    cam.getWorldDirection(dir);

    const muzzle = this.weaponAimOrigin;
    muzzle.set(this.player.position.x, this.player.position.y + 1.32, this.player.position.z);

    let t = 250;
    if (dir.y < -0.02) {
      t = (1.25 - cam.position.y) / dir.y;
      t = clamp(t, 1.5, 250);
    }
    // Aim at whatever is actually under the crosshair (start the ray at the player so the
    // camera boom and anything behind the player cannot block it).
    const toPlayer = Math.max(0, (this.player.position.x - cam.position.x) * dir.x + (this.player.position.z - cam.position.z) * dir.z);
    const probe = this.aimProbe.set(cam.position.x + dir.x * toPlayer, cam.position.y + dir.y * toPlayer, cam.position.z + dir.z * toPlayer);
    const seen = this.weapons.hitscan(probe, dir, 250);
    if (seen.hit && seen.kind !== 'ground') t = toPlayer + seen.distance;
    const aimX = cam.position.x + dir.x * t;
    const aimY = cam.position.y + dir.y * t;
    const aimZ = cam.position.z + dir.z * t;

    dir.set(aimX - muzzle.x, aimY - muzzle.y, aimZ - muzzle.z);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
  }

  /** Used by the visual tour to jump to a time of day. */
  debugSetTime(fraction: number): void {
    this.sky.setClockFraction(fraction);
  }

  /** Used by the visual tour to test the death screen. */
  debugKillPlayer(): void {
    this.player.damage(999);
  }

  /** Used by the visual tour to test the pause menu. */
  debugPause(): void {
    this.pauseGame();
  }

  /** Used by diagnostics: the AI state of the first few traffic cars. */
  debugTrafficAI(): Record<string, unknown>[] {
    return this.traffic.traffic.slice(0, 4).map((car) => {
      const ai = car.ai as TrafficAI | null;
      return {
        pos: [car.position.x.toFixed(1), car.position.z.toFixed(1)],
        yaw: car.yaw.toFixed(2),
        speed: car.forwardSpeed.toFixed(1),
        throttle: car.throttle.toFixed(2),
        steer: car.steer.toFixed(2),
        ai: ai ? ai.debugState() : null,
      };
    });
  }

  /** Used by diagnostics: how close the traffic gets to the player's car. */
  debugTrafficFollow(): { minDist: number; closestSpeed: number } {
    const car = this.player.vehicle ?? this.startCar;
    let minDist = Infinity;
    let closestSpeed = 0;
    if (!car) return { minDist, closestSpeed };
    for (const other of this.traffic.traffic) {
      const d = dist2D(other.position.x, other.position.z, car.position.x, car.position.z);
      if (d < minDist) {
        minDist = d;
        closestSpeed = Math.abs(other.forwardSpeed);
      }
    }
    return { minDist, closestSpeed };
  }

  /** Used by diagnostics: the officers on foot. */
  debugCops(): { count: number; positions: [number, number][] } {
    return {
      count: this.footCops.cops.length,
      positions: this.footCops.cops.map((c) => [
        Math.round(c.position.x),
        Math.round(c.position.z),
      ]),
    };
  }

  /** Used by tests to verify foot officer combat and hit detection. */
  debugShootCop(): { hit: boolean; killed: boolean; copAlive: boolean } {
    const cop = this.footCops.cops.find((c) => c.alive);
    if (!cop) return { hit: false, killed: false, copAlive: false };
    const fx = Math.sin(cop.yaw);
    const fz = Math.cos(cop.yaw);
    // Aim directly at the officer from 0.8 m in front of them along their facing line.
    this.weaponAimOrigin.set(cop.position.x + fx * 0.8, 1.35, cop.position.z + fz * 0.8);
    this.weaponAimDir.set(-fx, 0, -fz).normalize();
    this.player.position.set(cop.position.x + fx * 0.8, 0, cop.position.z + fz * 0.8);
    const hit = this.weapons.hitscan(this.weaponAimOrigin, this.weaponAimDir, 10);
    const targetCop = hit.kind === 'cop' && hit.cop ? hit.cop : cop;
    const killed = targetCop.damage(100);
    return { hit: hit.kind === 'cop', killed, copAlive: targetCop.alive };
  }

  /** Drive around for a while and report pop-in/out and overlapping traffic. */
  debugTrafficSpawn(seconds: number): { popIns: number; popOuts: number; overlaps: number; spawned: number } {
    this.traffic.popIns = 0;
    this.traffic.popOuts = 0;
    let overlaps = 0;
    const seen = new Set<Vehicle>(this.traffic.traffic);
    let spawned = 0;
    for (let i = 0; i < seconds * 10; i++) {
      if (i % 5 === 0) this.player.position.z += 10; // roughly 20 m/s of travel
      this.simulate(0.1);
      const cars = this.traffic.traffic;
      for (const c of cars) if (!seen.has(c)) { seen.add(c); spawned++; }
      for (let a = 0; a < cars.length; a++) {
        for (let b = a + 1; b < cars.length; b++) {
          if (dist2D(cars[a].position.x, cars[a].position.z, cars[b].position.x, cars[b].position.z) < 1.5) overlaps++;
        }
      }
    }
    return { popIns: this.traffic.popIns, popOuts: this.traffic.popOuts, overlaps, spawned };
  }

  /** Used by tests: weapon spread, recoil and hit detection against a car and the ground. */
  debugShooting(): Record<string, number | string> {
    const w = this.weapons;
    const o = new THREE.Vector3(0, 1.3, 0);
    const car = this.traffic.parked[0];
    // Park a target car 12 m ahead and shoot at its front face.
    const saved = { x: car.position.x, z: car.position.z, yaw: car.yaw };
    car.position.set(0, 0, 12);
    car.yaw = 0;
    const hitCar = w.hitscan(o, new THREE.Vector3(0, -0.02, 1).normalize(), 60);
    const missCar = w.hitscan(o, new THREE.Vector3(0.5, 0, 1).normalize(), 60);
    const down = w.hitscan(o, new THREE.Vector3(0, -1, 0.3).normalize(), 60);
    car.position.set(saved.x, 0, saved.z);
    car.yaw = saved.yaw;
    w.aiming = true;
    w.moveFactor = 0;
    const aimSpread = w.currentSpread;
    w.aiming = false;
    const hipSpread = w.currentSpread;
    w.moveFactor = 1;
    const movingSpread = w.currentSpread;
    w.moveFactor = 0;
    w.kick.pitch = 0;
    this.weaponAimOrigin.set(0, 1.3, 0);
    this.weaponAimDir.set(0, 0, 1);
    const before = w.shotsFired;
    w.update(0.2, true, false);
    return {
      carKind: hitCar.kind,
      carDistance: Math.round(hitCar.distance * 10) / 10,
      missKind: missCar.kind,
      groundKind: down.kind,
      aimSpread,
      hipSpread,
      movingSpread,
      kickPitch: w.kick.pitch,
      fired: w.shotsFired - before,
    };
  }

  /** Used by tests to inspect signal cycles. */
  debugTrafficCycles(): { downtown: number; outer: number } {
    const centerNode = this.city.roads.nodes[24];
    const outerNode = this.city.roads.nodes[0];
    return {
      downtown: centerNode?.cycleLength ?? 14,
      outer: outerNode?.cycleLength ?? 14,
    };
  }

  /** Used by the visual tour: place an officer at an exact spot. */
  debugSpawnCop(x: number, z: number): void {
    this.wanted.add(2);
    this.wanted.graceTimer = 60;
    this.footCops.spawn(x, z);
  }

  /**
   * Used by the behaviour test: park the player's car right in front of the
   * nearest AI car so the car-following logic can be observed.
   */
  debugBlockTraffic(): { speedBefore: number; speedAfter: number; distance: number } | null {
    if (this.traffic.traffic.length === 0) return null;
    let target = this.traffic.traffic[0];
    let maxSpeed = 1;
    for (const car of this.traffic.traffic) {
      const ai = car.ai as any;
      const toNode = ai && ai.to !== undefined ? this.city.roads.nodes[ai.to] : null;
      const distToNode = toNode ? dist2D(car.position.x, car.position.z, toNode.x, toNode.z) : 50;
      if (distToNode > 26 && Math.abs(car.forwardSpeed) > maxSpeed) {
        maxSpeed = Math.abs(car.forwardSpeed);
        target = car;
      }
    }
    const fx = Math.sin(target.yaw);
    const fz = Math.cos(target.yaw);
    const car = this.player.vehicle ?? this.startCar;
    if (!car) return null;
    // Put the player's car 14 m ahead of the AI car, in the same lane.
    car.position.set(target.position.x + fx * 14, 0, target.position.z + fz * 14);
    car.yaw = target.yaw;
    car.velocity.set(0, 0, 0);
    const speedBefore = Math.abs(target.forwardSpeed);
    for (let i = 0; i < 180; i++) this.update(1 / 60);
    return {
      speedBefore,
      speedAfter: Math.abs(target.forwardSpeed),
      distance: dist2D(target.position.x, target.position.z, car.position.x, car.position.z),
    };
  }

  /** Used by diagnostics: traffic AI health. */
  debugTraffic(): Record<string, unknown> {    const CELL = 82;
    const HALF = (COLS * CELL) / 2;
    const ROAD_HALF = 8; // half the road width around a centre line
    let offRoad = 0;
    let sumSpeed = 0;
    let moving = 0;
    for (const car of this.traffic.traffic) {
      const dx = Math.abs(((car.position.x + HALF) % CELL) - CELL / 2);
      const dz = Math.abs(((car.position.z + HALF_Z) % CELL) - CELL / 2);
      // A point is on a road when it is within half a road width of a centre line.
      if (dx > ROAD_HALF && dz > ROAD_HALF) offRoad++;
      sumSpeed += Math.abs(car.forwardSpeed);
      if (Math.abs(car.forwardSpeed) > 1) moving++;
    }
    const pedOnRoad = this.peds.peds.filter((p) => {
      const dx = Math.abs(((p.position.x + HALF) % CELL) - CELL / 2);
      const dz = Math.abs(((p.position.z + HALF_Z) % CELL) - CELL / 2);
      return dx <= ROAD_HALF || dz <= ROAD_HALF;
    }).length;
    return {
      cars: this.traffic.traffic.length,
      offRoad,
      moving,
      avgSpeed: this.traffic.traffic.length ? sumSpeed / this.traffic.traffic.length : 0,
      peds: this.peds.peds.length,
      pedOnRoad,
    };
  }

  /** Used by diagnostics: what is near the player and what did they hit. */
  debugWorld(): Record<string, unknown> {    const near = this.city.collision.boxes
      .filter((b) => b.minX < 20 && b.maxX > -20 && b.minZ < 95 && b.maxZ > 60)
      .map((b) => ({ minX: +b.minX.toFixed(1), maxX: +b.maxX.toFixed(1), minZ: +b.minZ.toFixed(1), maxZ: +b.maxZ.toFixed(1), h: b.height }));
    const parked = this.traffic.parked
      .filter((c) => Math.abs(c.position.x - 10) < 30 && Math.abs(c.position.z - 78) < 30)
      .map((c) => ({ x: +c.position.x.toFixed(1), z: +c.position.z.toFixed(1), yaw: +c.yaw.toFixed(2) }));
    return {
      player: this.player.position.toArray().map((v) => +v.toFixed(1)),
      startCar: this.startCar ? { x: +this.startCar.position.x.toFixed(1), z: +this.startCar.position.z.toFixed(1), yaw: +this.startCar.yaw.toFixed(2) } : null,
      collidersNear: near,
      parkedNear: parked,
      pedCount: this.peds.peds.length,
      pedsNear: this.peds.peds
        .filter((p) => Math.abs(p.position.x - 6) < 20 && Math.abs(p.position.z - 76) < 20)
        .map((p) => ({ x: +p.position.x.toFixed(1), z: +p.position.z.toFixed(1), state: p.state })),
    };
  }

  /** Used by the smoke test to drive the game deterministically. */
  simulate(seconds: number, step = 1 / 60): void {
    const steps = Math.floor(seconds / step);
    for (let i = 0; i < steps; i++) {
      this.step(step);
    }
  }

  dispose(): void {
    this.input.dispose();
    this.props.dispose();
    this.renderer.dispose();
  }
}
