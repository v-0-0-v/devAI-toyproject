import type { Direction } from "./types";

/**
 * On-screen D-pad for touch devices (`#touch-controls` in index.html, shown
 * only under `@media (pointer: coarse)`). Tracks which direction is
 * currently held so GameScene.update() can poll it alongside the keyboard,
 * the same way Phaser's CursorKeys expose `.isDown`.
 */
export class TouchControls {
  private held: Direction | null = null;

  constructor() {
    const root = document.querySelector<HTMLDivElement>("#touch-controls");
    if (!root) return;

    for (const dir of ["up", "down", "left", "right"] as const) {
      const btn = root.querySelector<HTMLButtonElement>(`[data-dir="${dir}"]`);
      if (!btn) continue;

      const press = (event: Event) => {
        event.preventDefault();
        this.held = dir;
      };
      const release = (event: Event) => {
        event.preventDefault();
        if (this.held === dir) this.held = null;
      };

      btn.addEventListener("pointerdown", press);
      btn.addEventListener("pointerup", release);
      btn.addEventListener("pointercancel", release);
      btn.addEventListener("pointerleave", release);
    }
  }

  getDirection(): Direction | null {
    return this.held;
  }
}
