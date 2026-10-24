import type { BattleEntryHook } from '../../ui/screens/battle/battle-entry.ts';
import type { UiHook } from '../game/ui-hook.ts';

export interface BattleHook {
  ready: boolean;
  state: BattleEntryHook | null;
  drives: readonly string[];
  commands: readonly string[];
  sounds: readonly string[];
  buttonPoint(id: string): { readonly x: number; readonly y: number } | null;
}

declare module '../game/ui-hook.ts' {
  interface UiHook {
    battle?: BattleHook;
  }
}

export function attachBattleHook(hook: UiHook, battle: BattleHook): void {
  hook.battle = battle;
}
