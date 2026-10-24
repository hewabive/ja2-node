// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/StrategicMap.cc GetSectorIDString (nothing for an unvisited underground sector, the mine's town
// @src and "Mine" when detailed), GetSectorLandTypeString (secrets and SAM sites first, the special facilities, the town,
// @src the creature lair underground, the traversability); src/game/Strategic/Strategic_Mines.cc GetIdOfMineForSector.
// @src See docs/21 §6.2, §6.3, docs/04 §6.33.

import { type Sector, sectorId, sectorShortString, strategicIndex } from '../content/strategic/sector-ids.ts';
import { type UiStrings, uiString } from '../content/text/strings.ts';
import type { CampaignSim } from '../sim/campaign/campaign-sim.ts';
import { mineIdForSector, townAssociatedWithMine } from '../sim/strategic/economy/mine-status.ts';
import { SectorFlag } from '../sim/strategic/forces/constants.ts';
import { isSecretFoundAt } from '../sim/strategic/map/control.ts';
import { getSectorFlagStatus } from '../sim/strategic/map/sectors.ts';

const LAND_TYPES = 'strategic-map-land-types';
const TOWN_NAMES = 'strategic-map-town-names';
const MINE_STRINGS = 'pwMineStrings';
const MINE_WORD = 0;
const NO_MINE = -1;
const TOWN_LAND_TYPE = 0;
const SAM_SITE_LAND_TYPE = 32;
const CREATURE_LAIR_LAND_TYPE = 35;
const BLANK_SECTOR = 0;
const THROUGH_STRATEGIC_MOVE = 4;

function landTypeString(labels: UiStrings, landType: number): string {
  return uiString(labels, LAND_TYPES, landType) ?? '';
}

export function sectorLandTypeString(campaign: CampaignSim, labels: UiStrings, s: Sector, detailed: boolean): string {
  const ctx = campaign.strategic;
  if (!ctx) return '';
  const id = sectorId(s);
  const content = ctx.content;
  const secret = s.z === 0 ? content.secrets.find((m) => m.sector === id) : undefined;
  if (secret) {
    const landType = isSecretFoundAt(ctx, id) ? secret.foundLandType : secret.secretLandType;
    if (landType !== TOWN_LAND_TYPE) return landTypeString(labels, secret.isSamSite && !detailed ? SAM_SITE_LAND_TYPE : landType);
  }
  if (s.z > 0 || detailed) {
    const facility = content.sectorDescriptions.find((d) => d.sector === id && d.z === s.z);
    if (facility) return landTypeString(labels, facility.landType);
  }
  const town = ctx.state.map.elements[strategicIndex(s)]?.nameId ?? BLANK_SECTOR;
  if (town !== BLANK_SECTOR) return uiString(labels, TOWN_NAMES, town) ?? '';
  if (s.z > 0) return landTypeString(labels, CREATURE_LAIR_LAND_TYPE);
  return landTypeString(labels, content.movementCosts.traversability[id]?.[THROUGH_STRATEGIC_MOVE] ?? 0);
}

export function sectorIdString(campaign: CampaignSim, labels: UiStrings, s: Sector, detailed: boolean): string {
  const ctx = campaign.strategic;
  if (s.z !== 0 && !(ctx && getSectorFlagStatus(ctx.state.map, s, SectorFlag.ALREADY_VISITED))) return '';
  const economy = campaign.economy;
  const mine = economy ? mineIdForSector(economy, s) : NO_MINE;
  let place = '';
  if (economy && mine !== NO_MINE) {
    place = uiString(labels, TOWN_NAMES, townAssociatedWithMine(economy, mine)) ?? '';
    if (detailed) place += ` ${uiString(labels, MINE_STRINGS, MINE_WORD) ?? ''}`;
  }
  if (place.length === 0) place = sectorLandTypeString(campaign, labels, s, detailed);
  return `${sectorShortString(s)}: ${place}`;
}
