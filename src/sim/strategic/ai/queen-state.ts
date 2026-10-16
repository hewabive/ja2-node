// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_AI.h ARMY_COMPOSITION, PATROL_GROUP, GARRISON_GROUP; Strategic_AI.cc globals;
// @src Strategic_Status.h STRATEGIC_STATUS; Meanwhile.cc uiMeanWhileFlags. See docs/17 §1.

import type { ArmyCompositionTemplate, PatrolTemplate } from '../../../content/strategic/army.ts';

export interface ArmyComposition {
  id: number;
  priority: number;
  elitePct: number;
  troopPct: number;
  adminPct: number;
  desired: number;
  start: number;
}

export interface GarrisonGroup {
  sector: number;
  composition: number;
  weight: number;
  pendingGroup: number;
}

export interface PatrolGroup {
  size: number;
  priority: number;
  points: number[];
  fillDayMod100: number;
  group: number;
  weight: number;
  pendingGroup: number;
}

export interface QueenState {
  awake: boolean;
  extraElites: boolean;
  massFortificationOrdered: boolean;
  firstBattleMeanwhilePending: boolean;
  useAlternateQueenPosition: boolean;
  forcePercentage: number;
  alertness: number;
  alertnessDecay: number;
  reinforcementPool: number;
  reinforcementPoints: number;
  requestPoints: number;
  awareBattles: number;
  priorityPhase: number;
  minGroupSize: number;
  graceHours: number;
  playerBattleVictories: number;
  saiVersion: number;
  compositions: ArmyComposition[];
  garrisons: GarrisonGroup[];
  patrols: PatrolGroup[];
  garrisonDenied: number[];
}

export const NUM_ENEMY_RANKS = 3;
export const NUM_WAYS_ENEMIES_KILLED = 3;

export interface StrategicStatus {
  flags: number;
  numCapturedForRescue: number;
  highestProgress: number;
  mercDeaths: number;
  manDaysPlayed: number;
  badReputation: number;
  enricoEmailFlags: number;
  insuranceInvestigations: number;
  unhiredMercDeaths: number;
  playerKills: number;
  enemiesKilled: number[][];
  weaponsDropped: Set<number> | null;
}

export interface MeanwhileState {
  flags: number;
  currentId: number;
}

export function createQueenState(): QueenState {
  return {
    awake: false,
    extraElites: false,
    massFortificationOrdered: false,
    firstBattleMeanwhilePending: false,
    useAlternateQueenPosition: false,
    forcePercentage: 0,
    alertness: 0,
    alertnessDecay: 0,
    reinforcementPool: 0,
    reinforcementPoints: 0,
    requestPoints: 0,
    awareBattles: 0,
    priorityPhase: 0,
    minGroupSize: 0,
    graceHours: 0,
    playerBattleVictories: 0,
    saiVersion: 0,
    compositions: [],
    garrisons: [],
    patrols: [],
    garrisonDenied: [],
  };
}

export function createStrategicStatus(): StrategicStatus {
  return {
    flags: 0,
    numCapturedForRescue: 0,
    highestProgress: 0,
    mercDeaths: 0,
    manDaysPlayed: 0,
    badReputation: 0,
    enricoEmailFlags: 0,
    insuranceInvestigations: 0,
    unhiredMercDeaths: 0,
    playerKills: 0,
    enemiesKilled: Array.from({ length: NUM_WAYS_ENEMIES_KILLED }, () => new Array<number>(NUM_ENEMY_RANKS).fill(0)),
    weaponsDropped: null,
  };
}

export function createMeanwhileState(): MeanwhileState {
  return { flags: 0, currentId: 0 };
}

export function compositionFromTemplate(t: ArmyCompositionTemplate): ArmyComposition {
  return {
    id: t.id,
    priority: t.priority,
    elitePct: t.elitePct,
    troopPct: t.troopPct,
    adminPct: t.adminPct,
    desired: t.desired,
    start: t.start,
  };
}

export function patrolFromTemplate(t: PatrolTemplate): PatrolGroup {
  return {
    size: t.size,
    priority: t.priority,
    points: [...t.points],
    fillDayMod100: t.fillDayMod100,
    group: 0,
    weight: 0,
    pendingGroup: 0,
  };
}

export function cloneQueenState(q: QueenState): QueenState {
  return {
    ...q,
    compositions: q.compositions.map((c) => ({ ...c })),
    garrisons: q.garrisons.map((g) => ({ ...g })),
    patrols: q.patrols.map((p) => ({ ...p, points: [...p.points] })),
    garrisonDenied: [...q.garrisonDenied],
  };
}
