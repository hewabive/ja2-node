import type { CommandEnvelope, StopCondition } from '../../protocol/messages.ts';
import type { MapScreenHook } from '../../ui/screens/map/map-screen.ts';
import type { UiHook } from '../game/ui-hook.ts';
import type { HintHook } from '../hints/hint-hook.ts';
import type { CommandSample } from '../tactical/tactical-hook.ts';

export interface MapHook {
  ready: boolean;
  error: string | null;
  screen: MapScreenHook | null;
  holds: readonly string[];
  lagTicks: number;
  pendingImages: number;
  commands: readonly CommandSample[];
  readonly hints: HintHook;
  command(cmd: CommandEnvelope): Promise<unknown>;
  advance(until: StopCondition): Promise<unknown>;
  sectorPoint(sector: string): { readonly x: number; readonly y: number } | null;
  rowPoint(row: number, column: number): { readonly x: number; readonly y: number } | null;
  helicopterPoint(): { readonly x: number; readonly y: number } | null;
}

declare module '../game/ui-hook.ts' {
  interface UiHook {
    map?: MapHook;
  }
}

export function attachMapHook(hook: UiHook, map: MapHook): void {
  hook.map = map;
}
