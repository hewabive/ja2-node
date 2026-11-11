// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/MessageBoxScreen.cc DoMessageBox (a box asked for while one is up is not shown), ExitMsgBox (the box is
// @src gone before its callback runs); the MSG_BOX_FLAG_YESNO boxes of Tactical/Handle_Items.cc and the globals their
// @src callbacks read: gpBoobyTrapSoldier, g_booby_trap_item, gsBoobyTrapGridNo, gbBoobyTrapLevel, gfDisarmingBuriedBomb,
// @src gbTrapDifficulty, gfJustFoundBoobyTrap; PLACE_BLUE_FLAG_PROMPT and REMOVE_BLUE_FLAG_PROMPT; the
// @src MSG_BOX_FLAG_FOUR_NUMBERED_BUTTONS box of StartBombMessageBox, answered 1-4 (MSG_BOX_RETURN_1..4), and the
// @src gpTempSoldier and gsTempGridno its callback reads (2026-11-04); Tactical/Auto_Bandage.cc BeginAutoBandage's
// @src BEGIN_AUTOBANDAGE_PROMPT_STR box (2026-11-06).

import type { CommandRefused } from '../command.ts';
import { refuse } from './refusal.ts';
import type { Soldier } from './soldier.ts';
import type { TacticalState } from './state.ts';
import type { WorldItem } from './world-items.ts';

export const TacticalPromptKind = {
  DISARM_TRAP: 'disarmTrap',
  ACTIVATE_SWITCH: 'activateSwitch',
  PLACE_BLUE_FLAG: 'placeBlueFlag',
  REMOVE_BLUE_FLAG: 'removeBlueFlag',
  BOMB_SETTING: 'bombSetting',
  REMOTE_FREQUENCY: 'remoteFrequency',
  BEGIN_AUTO_BANDAGE: 'beginAutoBandage',
} as const;
export type TacticalPromptKind = (typeof TacticalPromptKind)[keyof typeof TacticalPromptKind];

type BoobyTrapPromptKind =
  | typeof TacticalPromptKind.DISARM_TRAP
  | typeof TacticalPromptKind.PLACE_BLUE_FLAG
  | typeof TacticalPromptKind.REMOVE_BLUE_FLAG;

export type TacticalPrompt =
  | { readonly id: string; readonly kind: BoobyTrapPromptKind }
  | { readonly id: string; readonly kind: typeof TacticalPromptKind.BEGIN_AUTO_BANDAGE }
  | {
      readonly id: string;
      readonly kind: typeof TacticalPromptKind.ACTIVATE_SWITCH;
      readonly soldier: Soldier;
      readonly frequency: number;
    }
  | {
      readonly id: string;
      readonly kind: typeof TacticalPromptKind.BOMB_SETTING;
      readonly soldier: Soldier;
      readonly gridNo: number;
      readonly detonator: BombSettingDetonator;
    }
  | {
      readonly id: string;
      readonly kind: typeof TacticalPromptKind.REMOTE_FREQUENCY;
      readonly soldier: Soldier;
      readonly gridNo: number;
    };

export type BombSettingDetonator = 'timed' | 'remote';

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
export const NUMBERED_CHOICES = ['1', '2', '3', '4'] as const;

const NUMBERED_KINDS: ReadonlySet<TacticalPromptKind> = new Set([TacticalPromptKind.BOMB_SETTING, TacticalPromptKind.REMOTE_FREQUENCY]);

function promptChoices(prompt: Pick<TacticalPrompt, 'kind'>): readonly string[] {
  return NUMBERED_KINDS.has(prompt.kind) ? NUMBERED_CHOICES : YES_NO_CHOICES;
}

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

export type PromptAnswer = { readonly prompt: TacticalPrompt; readonly choice: string } | CommandRefused;

function choiceOf(cmd: Readonly<Record<string, unknown>>): unknown {
  return typeof cmd.choice === 'number' ? String(cmd.choice) : cmd.choice;
}

export function takeAnswer(t: TacticalState, cmd: Readonly<Record<string, unknown>>): PromptAnswer {
  const prompt = t.prompt;
  if (!prompt) return refuse('noPrompt', 'no prompt is open');
  if (cmd.prompt !== undefined && cmd.prompt !== prompt.id) return refuse('wrongPrompt', `the open prompt is ${prompt.id}`);
  const choices = promptChoices(prompt);
  const choice = choiceOf(cmd);
  if (typeof choice !== 'string' || !choices.includes(choice))
    return refuse('badChoice', `choose ${choices.map((c) => `'${c}'`).join(', ')}`);
  t.prompt = null;
  return { prompt, choice };
}
