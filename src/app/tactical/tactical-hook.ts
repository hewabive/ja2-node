import type { CommandEnvelope, DriverMode, StopCondition } from '../../protocol/messages.ts';
import type { InventoryItemView, ItemView } from '../../protocol/view.ts';
import type { TimeSummary } from '../game/time-samples.ts';
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

export interface SpeechLineSample {
  readonly surface: string;
  readonly profile: number;
  readonly soldier: number | null;
  readonly text: string;
  readonly phase: string;
  readonly subtitles: boolean;
}

export interface TalkSample {
  readonly open: boolean;
  readonly profile: number | null;
  readonly busy: boolean;
  readonly line: SpeechLineSample | null;
  readonly queued: number;
  readonly spoken: number;
  readonly textBox: string | null;
  readonly facePopup: boolean;
  readonly civQuote: string | null;
}

export interface ShopSlotSample {
  readonly item: string;
  readonly count: number;
}

export interface ShopSample {
  readonly open: boolean;
  readonly dealer: number | null;
  readonly page: number;
  readonly pages: number;
  readonly dealerBoxes: readonly ShopSlotSample[];
  readonly doa: readonly (ShopSlotSample | null)[];
  readonly poa: readonly (ShopSlotSample | null)[];
  readonly totals: { readonly cost: number; readonly value: number; readonly cash: number } | null;
  readonly transactionEnabled: boolean;
  readonly doneEnabled: boolean;
  readonly lastQuote: number | null;
  readonly subtitle: string | null;
  readonly held: string | null;
}

export const LOAD_PHASES = ['assets', 'presentation', 'world', 'sound', 'layouts', 'media'] as const;
export type LoadPhase = (typeof LOAD_PHASES)[number];

export interface LoadTimes {
  readonly total: number;
  readonly sincePageStart: number;
  readonly phases: Readonly<Partial<Record<LoadPhase, number>>>;
}

export interface TacticalHook {
  ready: boolean;
  loadMs: LoadTimes | null;
  error: string | null;
  map: string | null;
  panel: string | null;
  selected: number | null;
  smMerc: number | null;
  squad: number;
  slots: readonly (number | null)[];
  radarShown: boolean;
  paused: boolean;
  driver: DriverMode['mode'];
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
  enemyBar: { readonly counter: number; readonly max: number };
  topMessage: string | null;
  talk: TalkSample;
  shop: ShopSample;
  uiMode: string | null;
  uiCursor: string | null;
  uiLock: string | null;
  markers: readonly string[];
  apNumber: number | null;
  movementMenuOpen: boolean;
  doorMenuOpen: boolean;
  exitDialogOpen: boolean;
  overheadOpen: boolean;
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

export function attachTacticalHook(hook: UiHook, tactical: TacticalHook): void {
  hook.tactical = tactical;
}
