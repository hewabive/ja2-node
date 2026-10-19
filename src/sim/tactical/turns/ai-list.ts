// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TacticalAI/AIList.cc RemoveFirstAIListEntry, InsertIntoAIList, SatisfiesAIListConditions,
// @src MoveToFrontOfAIList, BuildAIListForTeam (and its InitEnemyUIBar). See docs/10 §6.3, docs/25 §7.2.

import { boxingFight } from '../narrative/boxing-state.ts';
import { AlertStatus, Body, NO_PROFILE, OKBREATH, OKLIFE, type Soldier, Team } from '../soldier.ts';
import { mercs, type TacticalState } from '../state.ts';
import { initEnemyUIBar } from './top-message.ts';

const MAX_AI_PRIORITY = 100;
const AI_ACTION_NONE = 0;

function satisfiesAIListConditions(t: TacticalState, s: Soldier, done: { n: number } | null, randomChecks: boolean): boolean {
  if (boxingFight(t) && !s.boxer) return false;
  if (!s.placed || s.life < OKLIFE || s.breath < OKBREATH) return false;
  if (s.moved) {
    if (s.actionPoints <= 1 && done) done.n++;
    return false;
  }
  t.turnHooks.decideAlertStatus(t, s);
  if (s.team === Team.CIV) {
    if (s.bodyType === Body.CROW || s.bodyType === Body.COW) return false;
    if (s.neutral) {
      if (s.ai.alertStatus < AlertStatus.RED) {
        if (randomChecks && t.pre.int(10) !== 0) return false;
      } else if (s.cowering) {
        if (s.visible === 0) return false;
        if (s.profile !== NO_PROFILE) return false;
        if (randomChecks && t.pre.int(3) !== 0) return false;
      } else if (s.bodyType === Body.CRIPPLECIV) {
        if (randomChecks && t.pre.int(3) !== 0) return false;
      }
    }
    if (s.cowering) s.ai.lastAction = AI_ACTION_NONE;
  }
  return true;
}

function insertIntoAIList(t: TacticalState, s: Soldier, priority: number): void {
  const list = t.turn.aiList;
  let k = 0;
  while (k < list.length && priority <= (list[k]?.priority ?? 0)) k++;
  list.splice(k, 0, { soldier: s, priority });
}

export function buildAIListForTeam(t: TacticalState, team: number): boolean {
  t.turn.aiList = [];
  const done = { n: 0 };
  let n = 0;
  for (const s of mercs(t)) {
    if (s.team !== team) continue;
    if (!satisfiesAIListConditions(t, s, done, true)) continue;
    insertIntoAIList(t, s, s.ai.alertStatus + (s.visible === 1 ? 3 : 0));
    n++;
  }
  if (n > 0) initEnemyUIBar(t, n, done.n);
  return n > 0;
}

export function removeFirstAIListEntry(t: TacticalState): Soldier | null {
  while (t.turn.aiList.length > 0) {
    const entry = t.turn.aiList.shift();
    if (entry && satisfiesAIListConditions(t, entry.soldier, null, false)) return entry.soldier;
  }
  return null;
}

export function moveToFrontOfAIList(t: TacticalState, s: Soldier): boolean {
  if (!satisfiesAIListConditions(t, s, null, false)) return false;
  const list = t.turn.aiList;
  const existing = list.findIndex((e) => e.soldier === s);
  if (existing >= 0) list.splice(existing, 1);
  list.unshift({ soldier: s, priority: list[0]?.priority ?? MAX_AI_PRIORITY });
  return true;
}
