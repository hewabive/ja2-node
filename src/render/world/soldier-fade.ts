// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc ExecuteOverhead (fade in and out, NEW_FADE_DELAY: the simulation keeps a soldier who
// @src drops out of sight at bVisible -2 while he fades out; our mercs never fade in); src/game/TileEngine/RenderWorld.cc
// @src RenderTiles (a fading soldier is drawn where he is, at the fade's shade).

export const FADE_STEP_MS = 60;
const SHADE_MIN = 15;
const FADE_LIMIT = SHADE_MIN - 3;
const OUR_TEAM = 0;

interface Fade {
  readonly direction: 'in' | 'out';
  readonly start: number;
  readonly startedAt: number;
}

export interface FadingSoldier {
  readonly id: number;
  readonly team: number;
  readonly gridNo: number;
  readonly fadingOut?: boolean;
}

type LandShade = (g: number) => number;

export class SoldierFades<T extends FadingSoldier> {
  readonly #fades = new Map<number, Fade>();
  #known: ReadonlySet<number> | null = null;

  update(visible: readonly T[], clockMs: number, landShade: LandShade): void {
    for (const s of visible) this.#follow(s, clockMs, landShade);
    const now = new Set(visible.map((s) => s.id));
    for (const id of this.#fades.keys()) if (!now.has(id)) this.#fades.delete(id);
    this.#known = now;
    for (const s of visible)
      if (this.#fades.get(s.id)?.direction === 'in' && this.shade(s, clockMs, landShade) === null) this.#fades.delete(s.id);
  }

  #follow(s: T, clockMs: number, landShade: LandShade): void {
    const fade = this.#fades.get(s.id);
    if (s.fadingOut) {
      if (fade?.direction !== 'out') this.#fades.set(s.id, { direction: 'out', start: landShade(s.gridNo), startedAt: clockMs });
      return;
    }
    if (fade?.direction === 'out') this.#fades.delete(s.id);
    else if (!fade && s.team !== OUR_TEAM && this.#known && !this.#known.has(s.id))
      this.#fades.set(s.id, { direction: 'in', start: FADE_LIMIT, startedAt: clockMs });
  }

  #level(f: Fade, clockMs: number): number {
    const steps = Math.max(0, Math.floor((clockMs - f.startedAt) / FADE_STEP_MS));
    return f.direction === 'in' ? Math.max(0, f.start - steps) : Math.min(f.start + steps, SHADE_MIN);
  }

  shade(s: T, clockMs: number, landShade: LandShade): number | null {
    const f = this.#fades.get(s.id);
    if (!f) return null;
    const level = this.#level(f, clockMs);
    if (f.direction === 'in') return level <= landShade(s.gridNo) ? null : level;
    return level;
  }

  fadedOut(s: T, clockMs: number): boolean {
    const f = this.#fades.get(s.id);
    return f?.direction === 'out' && this.#level(f, clockMs) >= FADE_LIMIT;
  }

  reset(): void {
    this.#fades.clear();
    this.#known = null;
  }
}
