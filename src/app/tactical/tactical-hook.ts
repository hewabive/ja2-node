import type { CommandEnvelope, StopCondition } from '../../protocol/messages.ts';
import type { InventoryItemView, ItemView } from '../../protocol/view.ts';
import type { UiHook } from '../game/ui-hook.ts';

export interface FaceSample {
  readonly id: number;
  readonly path: string;
  readonly eye: number;
  readonly mouth: number;
}

export interface SoldierSample {
  readonly id: number;
  readonly team: number;
  readonly gridNo: number;
  readonly level: number;
}

export interface CommandSample {
  readonly type: string;
  readonly ok: boolean;
  readonly reason: string | null;
}

export interface TimeSummary {
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

export interface TacticalHook {
  ready: boolean;
  error: string | null;
  map: string | null;
  panel: string | null;
  selected: number | null;
  smMerc: number | null;
  squad: number;
  slots: readonly (number | null)[];
  radarShown: boolean;
  paused: boolean;
  faces: readonly FaceSample[];
  messages: readonly string[];
  feedback: string | null;
  cursorItem: string | null;
  descriptionOpen: boolean;
  descriptionItem: string | null;
  pickupOpen: boolean;
  stackOpen: boolean;
  keyRingOpen: boolean;
  commands: readonly CommandSample[];
  camera: { readonly centerX: number; readonly centerY: number } | null;
  drawCalls: number;
  drawnSoldiers: number;
  pendingImages: number;
  frameMs: TimeSummary;
  worldMs: TimeSummary;
  command(cmd: CommandEnvelope): Promise<unknown>;
  advance(until: StopCondition): Promise<unknown>;
  inventory(soldier: number): readonly InventoryItemView[];
  soldiers(): readonly SoldierSample[];
  items(): readonly ItemView[];
  soldierScreen(soldier: number): { readonly x: number; readonly y: number } | null;
  gridNoScreen(gridNo: number): { readonly x: number; readonly y: number } | null;
  gridNoAt(x: number, y: number): number | null;
  soldierAt(x: number, y: number): number | null;
  centerOn(gridNo: number): void;
  resetTimes(): void;
}

declare module '../game/ui-hook.ts' {
  interface UiHook {
    tactical?: TacticalHook;
  }
}

const KEPT_SAMPLES = 2048;

export class TimeSamples {
  readonly #samples: number[] = [];

  add(ms: number): void {
    this.#samples.push(ms);
    if (this.#samples.length > KEPT_SAMPLES) this.#samples.shift();
  }

  reset(): void {
    this.#samples.length = 0;
  }

  summary(): TimeSummary {
    const sorted = [...this.#samples].sort((a, b) => a - b);
    const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))] ?? 0;
    return { count: sorted.length, p50: at(50), p95: at(95), max: sorted[sorted.length - 1] ?? 0 };
  }
}

export function attachTacticalHook(hook: UiHook, tactical: TacticalHook): void {
  hook.tactical = tactical;
}
