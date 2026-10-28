// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface.h MESSAGE_TYPES; Interface.cc AddTopMessage, EndTopMessage, InitPlayerUIBar (timed
// @src turns off), InitEnemyUIBar, UpdateEnemyUIBar, CreateTopMessage (the bloodcat turn string); Overhead.cc
// @src HostileBloodcatsPresent.

import { hostileBloodcatsPresent } from '../sector-presence.ts';
import { Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';

export const TopMessageKind = {
  COMPUTER_TURN: 1,
  COMPUTER_INTERRUPT: 2,
  PLAYER_INTERRUPT: 3,
  MILITIA_INTERRUPT: 4,
  AIR_RAID_TURN: 5,
  PLAYER_TURN: 6,
} as const;

export type TopMessageName = 'computerTurn' | 'computerInterrupt' | 'playerInterrupt' | 'militiaInterrupt' | 'airRaidTurn' | 'playerTurn';

const TOP_MESSAGE_NAMES: Readonly<Record<number, TopMessageName>> = {
  [TopMessageKind.COMPUTER_TURN]: 'computerTurn',
  [TopMessageKind.COMPUTER_INTERRUPT]: 'computerInterrupt',
  [TopMessageKind.PLAYER_INTERRUPT]: 'playerInterrupt',
  [TopMessageKind.MILITIA_INTERRUPT]: 'militiaInterrupt',
  [TopMessageKind.AIR_RAID_TURN]: 'airRaidTurn',
  [TopMessageKind.PLAYER_TURN]: 'playerTurn',
};

export function topMessageName(kind: number): TopMessageName {
  return TOP_MESSAGE_NAMES[kind] ?? 'playerTurn';
}

export interface TopMessage {
  readonly kind: number;
  readonly team: number;
  readonly bloodcats: boolean;
}

export interface AiProgress {
  current: number;
  next: number;
  total: number;
}

const PROGRESS_BAR_KINDS: ReadonlySet<number> = new Set([
  TopMessageKind.COMPUTER_TURN,
  TopMessageKind.COMPUTER_INTERRUPT,
  TopMessageKind.MILITIA_INTERRUPT,
  TopMessageKind.AIR_RAID_TURN,
]);

export function noAiProgress(): AiProgress {
  return { current: 0, next: 0, total: 0 };
}

export function addTopMessage(t: TacticalState, kind: number): void {
  const team = t.turn.currentTeam;
  const bloodcats = kind === TopMessageKind.COMPUTER_TURN && team === Team.CREATURE && hostileBloodcatsPresent(t);
  t.turn.topMessage = { kind, team, bloodcats };
}

export function endTopMessage(t: TacticalState): void {
  t.turn.topMessage = null;
}

export function initPlayerUIBar(t: TacticalState, interrupt: boolean): void {
  addTopMessage(t, interrupt ? TopMessageKind.PLAYER_INTERRUPT : TopMessageKind.PLAYER_TURN);
}

export function initEnemyUIBar(t: TacticalState, numEnemies: number, doneEnemies: number): void {
  t.turn.aiProgress = { current: doneEnemies, next: doneEnemies, total: numEnemies + doneEnemies };
}

export function updateEnemyUIBar(t: TacticalState): void {
  const progress = t.turn.aiProgress;
  progress.current = progress.next;
  progress.next++;
  t.events.push({ type: 'enemyTurnProgress', done: progress.current, total: progress.total });
}

export function showsAiProgress(message: TopMessage | null): boolean {
  return message !== null && PROGRESS_BAR_KINDS.has(message.kind);
}
