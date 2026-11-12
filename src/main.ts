import { Game } from './Game';

function fatal(message: string): void {
  const el = document.getElementById('fatal');
  if (el) {
    el.hidden = false;
    el.textContent = `VICE CITY 6 failed to start.\n\n${message}`;
  }
  const boot = document.getElementById('boot');
  if (boot) boot.classList.add('done');
}

function boot(): void {
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  if (!canvas) {
    fatal('Canvas element #game is missing from the document.');
    return;
  }

  try {
    const game = new Game(canvas);
    game.start();

    // Handy for the automated smoke test and for debugging in the console.
    (window as unknown as { __game: Game }).__game = game;

    const bootEl = document.getElementById('boot');
    if (bootEl) {
      bootEl.classList.add('done');
      window.setTimeout(() => bootEl.remove(), 700);
    }

    window.addEventListener('error', (event) => {
      // Surface runtime errors instead of failing silently.
      fatal(`${event.message}\n${event.filename ?? ''}:${event.lineno ?? ''}`);
    });
  } catch (error) {
    const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
    fatal(message);
    throw error;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
