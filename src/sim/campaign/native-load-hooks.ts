// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-15. See LICENSE (SFI-SCLA).
// @src src/game/SaveLoadGame.cc LoadSavedGame (CheckSquadMovementGroups, CallAvailableTeamEnemiesToAmbush);
// @src TacticalAI/Knowledge.cc CallAvailableTeamEnemiesToAmbush.

import { EncounterCode } from '../strategic/forces/constants.ts';
import { checkSquadMovementGroups } from '../strategic/forces/squads.ts';
import { callAvailableEnemiesTo } from '../tactical/doors/door-traps.ts';
import type { TacticalState } from '../tactical/state.ts';
import type { CampaignSim } from './campaign-sim.ts';

const NO_CENTER_GRIDNO = -1;

function isAmbush(encounterCode: number): boolean {
  return encounterCode === EncounterCode.ENEMY_AMBUSH || encounterCode === EncounterCode.BLOODCAT_AMBUSH;
}

export function callAvailableTeamEnemiesToAmbush(t: TacticalState, encounterCode: number): void {
  if (!isAmbush(encounterCode)) return;
  const center = t.world.map?.info.centerGridNo ?? NO_CENTER_GRIDNO;
  if (center === NO_CENTER_GRIDNO) return;
  callAvailableEnemiesTo(t, center);
}

export function runNativeLoadHooks(campaign: CampaignSim): void {
  if (campaign.strategic) checkSquadMovementGroups(campaign.strategic);
  const t = campaign.tactical?.state;
  if (t) callAvailableTeamEnemiesToAmbush(t, campaign.state.encounter.code);
}
