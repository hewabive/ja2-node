// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_AI.cc LoadStrategicAI (load-time recomputation), ValidateGroup;
// @src Strategic_Status.cc LoadStrategicStatusFromSaveGameFile; SaveLoadGame.cc LoadGeneralInfo (meanwhile flags). See docs/17 §1.4, §4.3.

import type { SavedStrategicAiSections } from '../../../content/formats/savegame-strategic-ai.ts';
import { NUM_ARMY_COMPOSITIONS } from '../../../content/strategic/army.ts';
import { isValidSector, sameSector } from '../../../content/strategic/sector-ids.ts';
import { EnemyIntention } from '../forces/constants.ts';
import { type Group, removeGroup } from '../forces/groups.ts';
import { updateAirspaceControl } from '../map/control.ts';
import type { QueenContext } from './context.ts';
import { evolveQueenPriorityPhase } from './evaluate.ts';
import { reassignAIGroup, removeGroupFromStrategicAILists, repollSAIGroup } from './orders.ts';

export interface StrategicAiImportOptions {
  readonly runLoadHooks: boolean;
}

function compositionCount(sections: SavedStrategicAiSections): number {
  return sections.ai.garrisons.reduce((n, g) => Math.max(n, g.composition + 1), NUM_ARMY_COMPOSITIONS);
}

function importQueen(q: QueenContext, sections: SavedStrategicAiSections): void {
  const ai = sections.ai;
  Object.assign(q.state.queen, {
    awake: ai.awake,
    extraElites: ai.extraElites,
    massFortificationOrdered: ai.massFortificationOrdered,
    firstBattleMeanwhilePending: ai.firstBattleMeanwhilePending,
    useAlternateQueenPosition: ai.useAlternateQueenPosition,
    forcePercentage: ai.forcePercentage,
    alertness: ai.alertness,
    alertnessDecay: ai.alertnessDecay,
    reinforcementPool: ai.reinforcementPool,
    reinforcementPoints: ai.reinforcementPoints,
    requestPoints: ai.requestPoints,
    awareBattles: ai.awareBattles,
    priorityPhase: ai.priorityPhase,
    minGroupSize: ai.minGroupSize,
    graceHours: ai.graceHours,
    playerBattleVictories: ai.playerBattleVictories,
    saiVersion: ai.saiVersion,
    compositions: ai.compositions.slice(0, compositionCount(sections)).map((c) => ({ ...c })),
    garrisons: ai.garrisons.map((g) => ({ ...g })),
    patrols: ai.patrols.map((p) => ({ ...p, points: [...p.points] })),
    garrisonDenied: [...ai.garrisonDenied],
  });
}

function importStatus(q: QueenContext, sections: SavedStrategicAiSections): void {
  const s = sections.status;
  Object.assign(q.state.status, {
    flags: s.flags,
    numCapturedForRescue: s.numCapturedForRescue,
    highestProgress: s.highestProgress,
    mercDeaths: s.mercDeaths,
    manDaysPlayed: s.manDaysPlayed,
    badReputation: s.badReputation,
    enricoEmailFlags: s.enricoEmailFlags,
    insuranceInvestigations: s.insuranceInvestigations,
    unhiredMercDeaths: s.unhiredMercDeaths,
    playerKills: s.playerKills,
    enemiesKilled: s.enemiesKilled.map((row) => [...row]),
  });
  Object.assign(q.state.map.activity, {
    lastDayOfPlayerActivity: s.lastDayOfPlayerActivity,
    newSectorsVisitedToday: s.newSectorsVisitedToday,
    daysOfInactivity: s.daysOfInactivity,
  });
  q.state.meanwhile.flags = sections.meanwhileFlags;
}

function validateLoadedGroup(q: QueenContext, g: Group): void {
  if (!isValidSector(g.sector)) {
    removeGroupFromStrategicAILists(q, g.id);
    removeGroup(q, g);
    return;
  }
  const intention = g.enemy?.intention;
  if (isValidSector(g.next) || g.player || intention === EnemyIntention.STAGING || intention === EnemyIntention.REINFORCEMENTS) return;
  removeGroupFromStrategicAILists(q, g.id);
  reassignAIGroup(q, g);
}

export function runStrategicAiLoadHooks(q: QueenContext): void {
  updateAirspaceControl(q);
  evolveQueenPriorityPhase(q, true);
  const world = q.state.worldSector;
  for (const g of [...q.state.forces.groups]) {
    if (g.player || g.betweenSectors || !q.state.forces.groups.includes(g)) continue;
    if (world && world.z === 0 && sameSector(g.sector, world)) continue;
    repollSAIGroup(q, g);
    if (q.state.forces.groups.includes(g)) validateLoadedGroup(q, g);
  }
}

export function importStrategicAi(q: QueenContext, sections: SavedStrategicAiSections, options: StrategicAiImportOptions): void {
  importQueen(q, sections);
  importStatus(q, sections);
  if (options.runLoadHooks) runStrategicAiLoadHooks(q);
}
