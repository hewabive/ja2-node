// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/MessageBoxScreen.cc DoMessageBox (a box asked for while one is up is not shown), ExitMsgBox (the box is
// @src gone before its callback runs); the MSG_BOX_FLAG_YESNO boxes of Tactical/Handle_Items.cc and the globals their
// @src callbacks read: gpBoobyTrapSoldier, g_booby_trap_item, gsBoobyTrapGridNo, gbBoobyTrapLevel, gfDisarmingBuriedBomb,
// @src gbTrapDifficulty, gfJustFoundBoobyTrap.

import type { CommandRefused } from '../command.ts';
import { refuse } from './refusal.ts';
import type { Soldier } from './soldier.ts';
import type { TacticalState } from './state.ts';
import type { WorldItem } from './world-items.ts';

export const TacticalPromptKind = { DISARM_TRAP: 'disarmTrap', ACTIVATE_SWITCH: 'activateSwitch' } as const;
export type TacticalPromptKind = (typeof TacticalPromptKind)[keyof typeof TacticalPromptKind];

export type TacticalPrompt =
  | { readonly id: string; readonly kind: typeof TacticalPromptKind.DISARM_TRAP }
  | {
      readonly id: string;
      readonly kind: typeof TacticalPromptKind.ACTIVATE_SWITCH;
      readonly soldier: Soldier;
      readonly frequency: number;
    };

export interface BoobyTrap {
  soldier: Soldier | null;
  item: WorldItem | null;
  gridNo: number;
  level: number;
  buried: boolean;
  difficulty: number;
  justFound: boolean;
}

export function createBoobyTrap(): BoobyTrap {
  return { soldier: null, item: null, gridNo: 0, level: 0, buried: false, difficulty: 0, justFound: false };
}

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
export type TacticalPromptRequest = WithoutId<TacticalPrompt>;

export const YES_NO_CHOICES = ['yes', 'no'] as const;

export function openTacticalPrompt(t: TacticalState, request: TacticalPromptRequest): void {
  if (t.prompt) return;
  t.promptSeq++;
  t.prompt = { ...request, id: `${request.kind}-${t.clockMs}-${t.promptSeq}` } as TacticalPrompt;
}

export function tacticalPromptOpen(t: TacticalState): boolean {
  return t.prompt !== null;
}

export function promptOpenRefusal(t: TacticalState): CommandRefused | null {
  return t.prompt ? refuse('promptOpen', `answer the ${t.prompt.kind} prompt first`) : null;
}

export type PromptAnswer = { readonly prompt: TacticalPrompt; readonly yes: boolean } | CommandRefused;

export function takeYesNoAnswer(t: TacticalState, cmd: Readonly<Record<string, unknown>>): PromptAnswer {
  const prompt = t.prompt;
  if (!prompt) return refuse('noPrompt', 'no prompt is open');
  if (cmd.prompt !== undefined && cmd.prompt !== prompt.id) return refuse('wrongPrompt', `the open prompt is ${prompt.id}`);
  if (cmd.choice !== 'yes' && cmd.choice !== 'no') return refuse('badChoice', "choose 'yes' or 'no'");
  t.prompt = null;
  return { prompt, yes: cmd.choice === 'yes' };
}
