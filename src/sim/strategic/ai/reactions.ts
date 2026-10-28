// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_AI.cc WakeUpQueen, ExecuteStrategicAIAction, StrategicHandleQueenLosingControlOfSector,
// @src StrategicHandleMineThatRanOut; Player_Command.cc (P3 basement).

import { byDifficultyLevel } from '../../../content/strategic/army.ts';
import { type Sector, sectorId, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { i8, i32, idiv, u8, u16, u32 } from '../../../core/int.ts';
import { EnemyIntention } from '../forces/constants.ts';
import { createNewEnemyGroupDepartingFromSector, getGroup } from '../forces/groups.ts';
import { sectorInfo } from '../map/sectors.ts';
import { enemyOf } from './composition.ts';
import {
  HALF_HOUR_SECONDS,
  MINE_RAN_OUT_PRIORITY_DIVISOR,
  MINE_RAN_OUT_SECTORS,
  NO_GARRISON,
  SAM_SQUAD_BASE,
  SAM_SQUAD_PROGRESS_DIVISOR,
  SEC,
  StrategicAiAction,
  WAKE_VICTORIES_BASE,
} from './constants.ts';
import { type QueenContext, rollInt } from './context.ts';
import { highestPlayerProgressPercentage } from './difficulty.ts';
import { evolveQueenPriorityPhase } from './evaluate.ts';
import {
  MoveCode,
  moveSAIGroupToSector,
  reassignAIGroup,
  redirectEnemyGroupsMovingThroughSector,
  removeGroupFromStrategicAILists,
} from './orders.ts';
import { massFortifyTowns } from './reinforce.ts';
import { garrison } from './weights.ts';

export function wakeUpQueen(q: QueenContext): void {
  const queen = q.state.queen;
  queen.awake = true;
  if (queen.massFortificationOrdered) return;
  queen.massFortificationOrdered = true;
  massFortifyTowns(q);
}

function sendTroopsToSam(q: QueenContext, sector: Sector | null): void {
  const queen = q.state.queen;
  const id = sector ? sectorId(sector) : 0;
  const n = u8(SAM_SQUAD_BASE + q.state.options.difficulty + idiv(highestPlayerProgressPercentage(q), SAM_SQUAD_PROGRESS_DIVISOR));
  queen.reinforcementPool = Math.max(i32(queen.reinforcementPool - n), 0);
  const g = createNewEnemyGroupDepartingFromSector(q, SEC.P3, 0, 0, n);
  moveSAIGroupToSector(q, g, id, MoveCode.STAGE, EnemyIntention.REINFORCEMENTS);
  const gi = q.state.map.sectors[id]?.garrisonId ?? NO_GARRISON;
  if (gi === NO_GARRISON) return;
  const gg = garrison(q, gi);
  const pending = gg.pendingGroup ? getGroup(q, gg.pendingGroup) : undefined;
  if (pending) removeGroupFromStrategicAILists(q, pending.id);
  enemyOf(g).intention = EnemyIntention.REINFORCEMENTS;
  gg.pendingGroup = g.id;
  if (pending) reassignAIGroup(q, pending);
}

export function executeStrategicAIAction(q: QueenContext, code: number, sector: Sector | null): void {
  const queen = q.state.queen;
  switch (code) {
    case StrategicAiAction.WAKE_QUEEN:
      wakeUpQueen(q);
      break;
    case StrategicAiAction.QUEEN_DEAD:
      queen.awake = false;
      break;
    case StrategicAiAction.KINGPIN_DEAD:
      break;
    case StrategicAiAction.SEND_TROOPS_TO_SAM:
      sendTroopsToSam(q, sector);
      break;
    case StrategicAiAction.ADD_MORE_ELITES:
      queen.extraElites = true;
      evolveQueenPriorityPhase(q, true);
      break;
    case StrategicAiAction.GIVE_KNOWLEDGE_OF_ALL_MERCS:
      queen.awareBattles = u8(byDifficultyLevel(q.army.policy.numAwareBattles, q.state.options.difficulty));
      break;
  }
}

export function strategicHandleQueenLosingControlOfSector(q: QueenContext, s: Sector): void {
  if (s.z) return;
  if (q.state.map.elements[strategicIndex(s)]?.enemyControlled) return;
  const queen = q.state.queen;
  const si = sectorInfo(q.state.map, s);
  queen.playerBattleVictories = u16(queen.playerBattleVictories + 1);
  if (queen.playerBattleVictories === WAKE_VICTORIES_BASE - q.state.options.difficulty) wakeUpQueen(q);
  if (si.garrisonId === NO_GARRISON) return;
  const now = q.state.clock.seconds;
  if (!si.timeLastPlayerLiberated) si.timeLastPlayerLiberated = now;
  else si.timeLastPlayerLiberated = u32(now - rollInt(q.random, queen.graceHours * HALF_HOUR_SECONDS));
  const gg = garrison(q, si.garrisonId);
  if (gg.pendingGroup) {
    const g = getGroup(q, gg.pendingGroup);
    if (g) reassignAIGroup(q, g);
    gg.pendingGroup = 0;
  }
  redirectEnemyGroupsMovingThroughSector(q, s);
}

export function strategicHandleMineThatRanOut(q: QueenContext, id: number): void {
  const sectors = MINE_RAN_OUT_SECTORS.get(id);
  if (!sectors) return;
  const queen = q.state.queen;
  for (const sectorOfGarrison of sectors) {
    const gi = q.state.map.sectors[sectorOfGarrison]?.garrisonId ?? NO_GARRISON;
    const comp = queen.compositions[queen.garrisons[gi]?.composition ?? -1];
    if (comp) comp.priority = i8(idiv(comp.priority, MINE_RAN_OUT_PRIORITY_DIVISOR));
  }
}

export function queenBasementTaken(q: QueenContext): void {
  q.state.queen.useAlternateQueenPosition = true;
}
