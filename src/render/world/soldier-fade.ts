// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc ExecuteOverhead (fade in and out, NEW_FADE_DELAY: only a soldier still in the
// @src sector whose bVisible drops to -1 fades out, so neither a dead soldier, whom TurnSoldierIntoCorpse takes off the
// @src map, nor our own mercs, who stay visible).

export const FADE_STEP_MS = 60;
const SHADE_MIN = 15;
const FADE_LIMIT = SHADE_MIN - 3;
const OUR_TEAM = 0;

interface Fade<T> {
  readonly direction: 'in' | 'out';
  readonly start: number;
  readonly startedAt: number;
  readonly last: T;
}

export interface FadingSoldier {
  readonly id: number;
  readonly team: number;
  readonly gridNo: number;
}

export class SoldierFades<T extends FadingSoldier> {
  readonly #fades = new Map<number, Fade<T>>();
  readonly #withoutFade = new Set<number>();
  #known: Map<number, T> | null = null;

  removeWithoutFade(id: number): void {
    if (this.#fades.get(id)?.direction === 'out') this.#fades.delete(id);
    else this.#withoutFade.add(id);
  }

  update(visible: readonly T[], clockMs: number, landShade: (g: number) => number): void {
    const now = new Map(visible.map((s) => [s.id, s] as const));
    const known = this.#known;
    if (known) {
      for (const s of visible) {
        if (!known.has(s.id) && s.team !== OUR_TEAM && !this.#fades.has(s.id)) {
          this.#fades.set(s.id, { direction: 'in', start: FADE_LIMIT, startedAt: clockMs, last: s });
        }
        const fade = this.#fades.get(s.id);
        if (fade?.direction === 'out') this.#fades.delete(s.id);
      }
      for (const [id, s] of known) {
        if (now.has(id) || this.#withoutFade.delete(id)) continue;
        if (s.team !== OUR_TEAM && !this.#fades.has(id))
          this.#fades.set(id, { direction: 'out', start: landShade(s.gridNo), startedAt: clockMs, last: s });
      }
    }
    for (const id of this.#withoutFade) if (!now.has(id)) this.#withoutFade.delete(id);
    this.#known = now;
    for (const [id, f] of this.#fades) {
      const shade = this.#shadeAt(f, clockMs, landShade);
      if (shade === null) this.#fades.delete(id);
    }
  }

  #shadeAt(f: Fade<T>, clockMs: number, landShade: (g: number) => number): number | null {
    const steps = Math.max(0, Math.floor((clockMs - f.startedAt) / FADE_STEP_MS));
    if (f.direction === 'in') {
      const level = Math.max(0, f.start - steps);
      return level <= landShade(f.last.gridNo) ? null : level;
    }
    const level = Math.min(f.start + steps, SHADE_MIN);
    return level >= FADE_LIMIT ? null : level;
  }

  shade(id: number, clockMs: number, landShade: (g: number) => number): number | null {
    const f = this.#fades.get(id);
    return f ? this.#shadeAt(f, clockMs, landShade) : null;
  }

  fadingOut(): T[] {
    return [...this.#fades.values()].filter((f) => f.direction === 'out').map((f) => f.last);
  }

  reset(): void {
    this.#fades.clear();
    this.#withoutFade.clear();
    this.#known = null;
  }
}
