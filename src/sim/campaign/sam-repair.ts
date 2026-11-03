// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-03. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/SAM_Sites.cc UpdateSAMDoneRepair (the terminal graphic; the condition and the air control
// @src are strategic/ai/orders.ts).

import type { SamSite } from '../../content/strategic/map-tables.ts';
import { type Sector, sameSector, sectorId } from '../../content/strategic/sector-ids.ts';
import { type TileTables, tileIndexFromTypeSubIndex, typeIndex } from '../../content/world/tile-tables.ts';
import type { StrategicState } from '../strategic/state.ts';
import { addStructTileToHead, removeStructTile } from '../tactical/map-changes.ts';
import type { TacticalState } from '../tactical/state.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { addStructToUnloadedSector, removeStructFromUnloadedSector } from './unloaded-map.ts';

const SAM_TERMINAL_TYPE = 'EIGHTISTRUCT';
const DAMAGED_TERMINAL_BELOW_WORKING = 2;

export interface SamTerminal {
  readonly gridNo: number;
  readonly working: number;
  readonly damaged: number;
}

export function samTerminal(tables: TileTables, site: SamSite): SamTerminal {
  const working = tileIndexFromTypeSubIndex(tables, typeIndex(tables, SAM_TERMINAL_TYPE), site.graphicIndex);
  return { gridNo: site.gridNos[0], working, damaged: working - DAMAGED_TERMINAL_BELOW_WORKING };
}

export function repairSamTerminalInLoadedWorld(t: TacticalState, terminal: SamTerminal): void {
  removeStructTile(t, terminal.gridNo, terminal.damaged);
  addStructTileToHead(t, terminal.gridNo, terminal.working);
}

export function repairSamTerminalInUnloadedSector(state: StrategicState, terminal: SamTerminal, sector: Sector): void {
  removeStructFromUnloadedSector(state, terminal.gridNo, terminal.damaged, sector);
  addStructToUnloadedSector(state, terminal.gridNo, terminal.working, sector);
}

function loadedWorldOf(campaign: CampaignSim, sector: Sector): TacticalState | null {
  const world = campaign.state.worldSector;
  return world && sameSector(world, sector) ? (campaign.tactical?.state ?? null) : null;
}

export function repairSamTerminal(campaign: CampaignSim, sector: Sector): void {
  const site = campaign.strategic?.content.samSites.find((s) => s.sector === sectorId(sector));
  const tables = campaign.sectors?.setup.content.tileTables;
  if (!site || !tables) return;
  const terminal = samTerminal(tables, site);
  const t = loadedWorldOf(campaign, sector);
  if (t) repairSamTerminalInLoadedWorld(t, terminal);
  else repairSamTerminalInUnloadedSector(campaign.state, terminal, sector);
}
