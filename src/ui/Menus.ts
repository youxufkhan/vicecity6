export type ScreenName = 'title' | 'controls' | 'settings' | 'pause' | 'wasted' | 'clear';

export interface Settings {
  quality: 'low' | 'medium' | 'high';
  shadows: boolean;
  volume: number;
  invertY: boolean;
  sensitivity: number;
}

export interface MenuCallbacks {
  onStart(): void;
  onResume(): void;
  onQuit(): void;
  onRespawn(): void;
  onContinue(): void;
  onSettings(settings: Settings): void;
  onUiClick(): void;
}

const STORAGE_KEY = 'vice-city-6.settings';

const DEFAULT_SETTINGS: Settings = {
  quality: 'high',
  shadows: true,
  volume: 70,
  invertY: false,
  sensitivity: 100,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage may be unavailable; settings simply do not persist */
  }
}

/** Screen and menu management. */
export class Menus {
  private screens = new Map<ScreenName, HTMLElement>();
  private current: ScreenName | null = null;
  private previous: ScreenName | null = null;
  private clickToPlay = document.getElementById('click-to-play')!;
  private boot = document.getElementById('boot')!;
  settings: Settings;

  constructor(private callbacks: MenuCallbacks) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('.screen'))) {
      const name = el.dataset.screen as ScreenName;
      if (name) this.screens.set(name, el);
    }
    this.settings = loadSettings();

    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-action]'))) {
      button.addEventListener('click', () => this.handleAction(button.dataset.action ?? ''));
    }

    const quality = document.getElementById('set-quality') as HTMLSelectElement;
    const shadows = document.getElementById('set-shadows') as HTMLInputElement;
    const volume = document.getElementById('set-volume') as HTMLInputElement;
    const invert = document.getElementById('set-invert') as HTMLInputElement;
    const sens = document.getElementById('set-sens') as HTMLInputElement;

    quality.value = this.settings.quality;
    shadows.checked = this.settings.shadows;
    volume.value = String(this.settings.volume);
    invert.checked = this.settings.invertY;
    sens.value = String(this.settings.sensitivity);

    const apply = (): void => {
      this.settings = {
        quality: quality.value as Settings['quality'],
        shadows: shadows.checked,
        volume: Number(volume.value),
        invertY: invert.checked,
        sensitivity: Number(sens.value),
      };
      saveSettings(this.settings);
      this.callbacks.onSettings(this.settings);
    };
    quality.addEventListener('change', apply);
    shadows.addEventListener('change', apply);
    volume.addEventListener('input', apply);
    invert.addEventListener('change', apply);
    sens.addEventListener('input', apply);

    this.clickToPlay.addEventListener('click', () => {
      this.clickToPlay.classList.remove('show');
      this.callbacks.onUiClick();
    });
  }

  private handleAction(action: string): void {
    this.callbacks.onUiClick();
    switch (action) {
      case 'start':
        this.previous = 'title';
        this.current = null;
        this.hideAll();
        this.callbacks.onStart();
        break;
      case 'controls':
        this.previous = this.current ?? 'title';
        this.show('controls');
        break;
      case 'settings':
        this.previous = this.current ?? 'title';
        this.show('settings');
        break;
      case 'back':
        this.show(this.previous ?? 'title');
        this.previous = null;
        break;
      case 'resume':
        this.current = null;
        this.hideAll();
        this.callbacks.onResume();
        break;
      case 'quit':
        this.current = 'title';
        this.show('title');
        this.callbacks.onQuit();
        break;
      case 'respawn':
        this.current = null;
        this.hideAll();
        this.callbacks.onRespawn();
        break;
      case 'continue':
        this.current = null;
        this.hideAll();
        this.callbacks.onContinue();
        break;
    }
  }

  show(name: ScreenName): void {
    this.hideAll();
    this.current = name;
    const el = this.screens.get(name);
    if (el) el.classList.add('is-active');
  }

  hideAll(): void {
    for (const el of this.screens.values()) el.classList.remove('is-active');
  }

  hide(): void {
    this.hideAll();
    this.current = null;
  }

  get active(): ScreenName | null {
    return this.current;
  }

  setClickToPlay(show: boolean): void {
    this.clickToPlay.classList.toggle('show', show);
  }

  setBootDone(): void {
    this.boot.classList.add('done');
    window.setTimeout(() => this.boot.remove(), 600);
  }

  setWastedSub(text: string): void {
    const el = document.getElementById('wasted-sub');
    if (el) el.textContent = text;
  }

  setClearSub(text: string): void {
    const el = document.getElementById('clear-sub');
    if (el) el.textContent = text;
  }
}
