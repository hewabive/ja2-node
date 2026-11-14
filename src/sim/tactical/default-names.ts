// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-13. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Create.cc TacticalCopySoldierFromCreateStruct (the default names by team, class and
// @src body; the name of the create struct never reaches the soldier); Tactical/Interface_Dialogue.cc
// @src NPC_ACTION_REMOVE_MERC_FOR_MARRIAGE (a civilian without a profile who keeps a merc's nickname).

import { Body, NO_PROFILE, type Soldier, SoldierClass, Team } from './soldier.ts';

export const NO_NAME = '';

export type DefaultSoldierName = 'enemy' | 'militia' | 'civilian' | 'miner' | 'crow' | 'creature' | 'bloodcat';

type NamedBody = Pick<Soldier, 'profile' | 'team' | 'soldierClass' | 'bodyType'>;

function civilianName(soldierClass: number, bodyType: number): DefaultSoldierName {
  if (soldierClass === SoldierClass.MINER) return 'miner';
  return bodyType === Body.CROW ? 'crow' : 'civilian';
}

function teamName(s: NamedBody): DefaultSoldierName | null {
  switch (s.team) {
    case Team.ENEMY:
      return 'enemy';
    case Team.MILITIA:
      return 'militia';
    case Team.CIV:
      return civilianName(s.soldierClass, s.bodyType);
    case Team.CREATURE:
      return s.bodyType === Body.BLOODCAT ? 'bloodcat' : 'creature';
    default:
      return null;
  }
}

export function namedByTeam(s: NamedBody): boolean {
  return s.profile === NO_PROFILE && teamName(s) !== null;
}

export function defaultSoldierName(s: NamedBody & Pick<Soldier, 'name'>): DefaultSoldierName | null {
  return s.profile === NO_PROFILE && s.name === NO_NAME ? teamName(s) : null;
}
