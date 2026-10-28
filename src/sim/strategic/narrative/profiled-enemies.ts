// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Create.cc OkayToUpgradeEliteToSpecialProfiledEnemy, gfProfiledEnemyAdded.

import { EncounterCode } from '../forces/constants.ts';
import { Fact } from './fact-ids.ts';
import { factValue, type NarrativeState, setFact } from './facts.ts';
import { Npc } from './npc-ids.ts';

const AVAILABLE = 1;
const USED = 2;

export interface UpgradableElite {
  profile: number;
  readonly onRoof: boolean;
}

function upgrade(n: NarrativeState, pp: UpgradableElite, fact: number, profile: number): boolean {
  if (factValue(n, fact) !== AVAILABLE || pp.onRoof) return false;
  setFact(n, fact, USED);
  pp.profile = profile;
  n.profiledEnemyAdded = true;
  return true;
}

export function okayToUpgradeEliteToSpecialProfiledEnemy(n: NarrativeState, encounterCode: number, pp: UpgradableElite): void {
  if (n.profiledEnemyAdded) return;
  if (encounterCode === EncounterCode.ENEMY_ENCOUNTER || encounterCode === EncounterCode.ENEMY_INVASION) return;
  if (!upgrade(n, pp, Fact.MIKE_AVAILABLE_TO_ARMY, Npc.MIKE)) upgrade(n, pp, Fact.IGGY_AVAILABLE_TO_ARMY, Npc.IGGY);
}
