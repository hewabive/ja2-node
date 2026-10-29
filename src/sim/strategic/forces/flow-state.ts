import type { Sector } from '../../../content/strategic/sector-ids.ts';

export interface TacticalTraversal {
  active: boolean;
  groupId: number;
  chosenSoldier: number;
}

export interface MovementFlowState {
  waitingForInput: boolean;
  pendingSimultaneousGroup: number | null;
  groupPrompting: number | null;
  initPrebattleGroup: number | null;
  numGroupsArrivedSimultaneously: number;
  tacticalTraversal: TacticalTraversal;
  undergroundTacticalTraversal: boolean;
  randomizingPatrolGroup: boolean;
  disableMapInterfaceDueToBattle: boolean;
  exitingVehicleToSquad: boolean;
}

export const PreBattleNotice = {
  BLOODCAT_BATTLE: 'bloodcatBattle',
  INVASION: 'invasion',
  UNCONSCIOUS_MERCS_ATTACKED: 'unconsciousMercsAttacked',
} as const;
export type PreBattleNotice = (typeof PreBattleNotice)[keyof typeof PreBattleNotice];

export interface PreBattleHandoff {
  readonly battleGroupId: number;
  readonly dialogGroupId: number | null;
  readonly sector: Sector;
  readonly encounterCode: number;
  readonly notice: PreBattleNotice | null;
  readonly speakerCandidates: readonly number[];
  readonly combatAbleMerc: boolean;
  readonly aliveMerc: boolean;
  readonly militiaPresent: boolean;
  readonly bloodcatAmbush: boolean;
  readonly tacticalTraversal: boolean;
}

export interface SimultaneousArrivalPrompt {
  readonly groupId: number;
  readonly sector: Sector;
  readonly nearbyGroups: number;
  readonly bloodcats: boolean;
}

export interface EncounterState {
  code: number;
  explicitCode: number;
  highPotentialForAmbush: boolean;
  autoAmbush: boolean;
  cantRetreatInPBI: boolean;
  delayAutoResolveStart: boolean;
  usePersistentPBI: boolean;
  battleGroup: number | null;
  pendingEnemies: boolean;
  preBattle: PreBattleHandoff | null;
  simultaneousArrival: SimultaneousArrivalPrompt | null;
}

export function createMovementFlowState(): MovementFlowState {
  return {
    waitingForInput: false,
    pendingSimultaneousGroup: null,
    groupPrompting: null,
    initPrebattleGroup: null,
    numGroupsArrivedSimultaneously: 0,
    tacticalTraversal: { active: false, groupId: 0, chosenSoldier: -1 },
    undergroundTacticalTraversal: false,
    randomizingPatrolGroup: false,
    disableMapInterfaceDueToBattle: false,
    exitingVehicleToSquad: false,
  };
}

export function createEncounterState(): EncounterState {
  return {
    code: 0,
    explicitCode: 0,
    highPotentialForAmbush: false,
    autoAmbush: false,
    cantRetreatInPBI: false,
    delayAutoResolveStart: false,
    usePersistentPBI: false,
    battleGroup: null,
    pendingEnemies: false,
    preBattle: null,
    simultaneousArrival: null,
  };
}
