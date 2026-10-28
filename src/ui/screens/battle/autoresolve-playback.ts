// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Auto_Resolve.cc ProcessBattleFrame (Play slices of 1000·pct/100 battle ms per real second,
// @src Fast 4000, Finish at once; Pause stops the battle), AttackTarget and TargetHitCallback (the cell flags the screen
// @src draws: hit, fallen, dead, retreated), PlayButtonCallback, FastButtonCallback, FinishButtonCallback. ja2-node runs
// @src the battle on the server in 1000 ms slices; the client plays each slice's events spread over the slice's real
// @src time at the chosen speed.

import type { AutoresolveCellView, AutoresolveView, PromptView, ViewFrame } from '../../../protocol/view.ts';
import { type DisplayCell, displayCell } from './autoresolve-cells.ts';

export type BattleEvent = NonNullable<ViewFrame['events']>[number];
export type ArEvent = Extract<
  BattleEvent,
  { readonly type: 'arAttack' | 'arHit' | 'arMiss' | 'arFell' | 'arDied' | 'arRetreated' | 'arBattleOver' | 'arSound' }
>;

const AR_EVENT_TYPES: ReadonlySet<string> = new Set([
  'arAttack',
  'arHit',
  'arMiss',
  'arFell',
  'arDied',
  'arRetreated',
  'arBattleOver',
  'arSound',
]);
const SLICE_MS = 1000;
const FULL_SPEED = 100;

export function isArEvent(e: BattleEvent): e is ArEvent {
  return AR_EVENT_TYPES.has(e.type);
}

export interface PlaybackEntry {
  readonly events: readonly ArEvent[];
  readonly view: AutoresolveView | null;
  readonly prompt: PromptView | null;
}

export interface DisplayState {
  readonly status: string;
  readonly sector: string;
  readonly battleSeconds: number;
  readonly cells: readonly DisplayCell[];
  readonly alive: AutoresolveView['alive'];
  readonly prompt: PromptView | null;
}

export type CellKey = `${AutoresolveCellView['side']}:${number}`;

export function cellKey(c: { readonly side: AutoresolveCellView['side']; readonly index: number }): CellKey {
  return `${c.side}:${c.index}`;
}

export function displayState(view: AutoresolveView, prompt: PromptView | null, previous?: DisplayState): DisplayState {
  const before = new Map((previous?.cells ?? []).map((c) => [cellKey(c), c]));
  return {
    status: view.status,
    sector: view.sector,
    battleSeconds: view.battleSeconds,
    alive: view.alive,
    cells: view.cells.map((c) => displayCell(c, before.get(cellKey(c)))),
    prompt,
  };
}

function patchCell(state: DisplayState, key: CellKey, patch: (c: DisplayCell) => DisplayCell): DisplayState {
  return { ...state, cells: state.cells.map((c) => (cellKey(c) === key ? patch(c) : c)) };
}

function aliveFrom(cells: readonly DisplayCell[]): AutoresolveView['alive'] {
  const alive = (side: AutoresolveCellView['side']) => cells.filter((c) => c.side === side && c.state !== 'dead').length;
  return { mercs: alive('merc'), militia: alive('militia'), enemies: alive('enemy') };
}

export function applyEvent(state: DisplayState, e: ArEvent): DisplayState {
  switch (e.type) {
    case 'arHit':
      return patchCell(state, cellKey(e.target), (c) => ({
        ...c,
        ...(e.life !== undefined ? { life: e.life } : {}),
        ...(e.health !== undefined ? { health: e.health, hurt: true } : {}),
        flash: 'white',
      }));
    case 'arFell':
      return patchCell(state, cellKey(e.cell), (c) => ({ ...c, state: c.state === 'dead' ? c.state : 'unconscious' }));
    case 'arDied': {
      const next = patchCell(state, cellKey(e.cell), (c) => {
        const { health: _health, hurt: _hurt, ...rest } = c;
        return { ...rest, state: 'dead', ...(c.side === 'merc' ? { life: 0 } : {}) };
      });
      return { ...next, alive: aliveFrom(next.cells) };
    }
    case 'arRetreated':
      return patchCell(state, cellKey(e.cell), (c) => ({ ...c, state: 'retreated' }));
    case 'arBattleOver':
      return { ...state, status: e.status };
    default:
      return state;
  }
}

export type PlaybackSpeed = 'play' | 'fast' | 'finish';

export function speedPercent(speed: PlaybackSpeed, timeModifier: number): number {
  if (speed === 'fast') return 4 * FULL_SPEED;
  if (speed === 'finish') return Number.POSITIVE_INFINITY;
  return timeModifier;
}

export function sliceDurationMs(entry: PlaybackEntry, percent: number): number {
  if (entry.events.length === 0 || !Number.isFinite(percent)) return 0;
  return (SLICE_MS * FULL_SPEED) / percent;
}

interface Current {
  readonly entry: PlaybackEntry;
  readonly durationMs: number;
  elapsedMs: number;
  released: number;
}

export class ArPlayback {
  #state: DisplayState;
  readonly #queue: PlaybackEntry[] = [];
  #current: Current | null = null;
  #lastView: AutoresolveView;
  #lastPrompt: PromptView | null;

  constructor(view: AutoresolveView, prompt: PromptView | null) {
    this.#state = displayState(view, prompt);
    this.#lastView = view;
    this.#lastPrompt = prompt;
  }

  get state(): DisplayState {
    return this.#state;
  }

  get pending(): number {
    return this.#queue.length + (this.#current ? 1 : 0);
  }

  set state(state: DisplayState) {
    this.#state = state;
  }

  push(frame: ViewFrame): void {
    const view = frame.autoresolve === undefined ? this.#lastView : frame.autoresolve;
    const prompt = frame.prompt === undefined ? this.#lastPrompt : frame.prompt;
    if (view) this.#lastView = view;
    this.#lastPrompt = prompt;
    const events = (frame.events ?? []).filter(isArEvent);
    if (events.length === 0 && frame.autoresolve === undefined && frame.prompt === undefined) return;
    this.#queue.push({ events, view: view ?? null, prompt });
  }

  advance(elapsedMs: number, percent: number, release: (e: ArEvent) => void): void {
    let budget = elapsedMs;
    for (;;) {
      if (!this.#current) {
        const entry = this.#queue.shift();
        if (!entry) return;
        this.#current = { entry, durationMs: sliceDurationMs(entry, percent), elapsedMs: 0, released: 0 };
      }
      const current = this.#current;
      const spend = Math.min(budget, Math.max(0, current.durationMs - current.elapsedMs));
      current.elapsedMs += spend;
      budget -= spend;
      const events = current.entry.events;
      const due = current.durationMs === 0 ? events.length : Math.floor((current.elapsedMs / current.durationMs) * events.length);
      while (current.released < due) {
        const e = events[current.released++] as ArEvent;
        release(e);
        this.#state = applyEvent(this.#state, e);
      }
      if (current.elapsedMs < current.durationMs) return;
      this.#settle(current.entry);
      this.#current = null;
    }
  }

  #settle(entry: PlaybackEntry): void {
    if (entry.view) this.#state = displayState(entry.view, entry.prompt, this.#state);
    else this.#state = { ...this.#state, prompt: entry.prompt };
  }

  flush(release: (e: ArEvent) => void): void {
    this.advance(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, release);
  }
}
