// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-15. See LICENSE (SFI-SCLA).
// @src src/game/SaveLoadGame.cc LoadSavedGame (CheckSquadMovementGroups, CallAvailableTeamEnemiesToAmbush; the version
// @src fix-ups UpdateRefuelSiteAvailability and CalcAproximateAmountPaidToSpeck, 2026-11-16);
// @src TacticalAI/Knowledge.cc CallAvailableTeamEnemiesToAmbush.

import { EncounterCode } from '../strategic/forces/constants.ts';
import { updateRefuelSiteAvailability } from '../strategic/forces/helicopter.ts';
import { checkSquadMovementGroups } from '../strategic/forces/squads.ts';
import { callAvailableEnemiesTo } from '../tactical/doors/door-traps.ts';
import type { TacticalState } from '../tactical/state.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { calcApproximateAmountPaidToSpeck } from './laptop/merc-site.ts';

const NO_CENTER_GRIDNO = -1;
const LAST_VERSION_WITH_STALE_REFUEL_SITES = 89;
const FIRST_VERSION_COUNTING_SPECK_PAYMENTS = 91;

function isAmbush(encounterCode: number): boolean {
  return encounterCode === EncounterCode.ENEMY_AMBUSH || encounterCode === EncounterCode.BLOODCAT_AMBUSH;
}

export function callAvailableTeamEnemiesToAmbush(t: TacticalState, encounterCode: number): void {
  if (!isAmbush(encounterCode)) return;
  const center = t.world.map?.info.centerGridNo ?? NO_CENTER_GRIDNO;
  if (center === NO_CENTER_GRIDNO) return;
  callAvailableEnemiesTo(t, center);
}

function runVersionFixUps(campaign: CampaignSim, version: number): void {
  if (version <= LAST_VERSION_WITH_STALE_REFUEL_SITES && campaign.strategic) updateRefuelSiteAvailability(campaign.strategic);
  if (version < FIRST_VERSION_COUNTING_SPECK_PAYMENTS && campaign.laptop) calcApproximateAmountPaidToSpeck(campaign.laptop);
}

export function runNativeLoadHooks(campaign: CampaignSim, version: number): void {
  runVersionFixUps(campaign, version);
  if (campaign.strategic) checkSquadMovementGroups(campaign.strategic);
  const t = campaign.tactical?.state;
  if (t) callAvailableTeamEnemiesToAmbush(t, campaign.state.encounter.code);
}
