// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/MapScreen.cc MapScreenHandle (entering: keep a 5-60 min mode but stop it, else X0),
// @src EndMapScreen (to tactical: X1); StrategicMap.cc CanGoToTacticalInSector; Tactical/Interface_Panels.cc
// @src GoToMapScreenFromTactical, AbandonBoxingCallback (the abandon-fight question as a flag).

import { type Sector, sameSector } from '../../content/strategic/sector-ids.ts';
import type { CommandResult } from '../command.ts';
import { Assignment } from '../strategic/forces/constants.ts';
import type { StrategicMerc } from '../strategic/forces/ports.ts';
import { CompressMode } from '../strategic/time/constants.ts';
import { CompressionStop, setGameTimeCompressionLevel, stopTimeCompression } from '../strategic/time/world-clock.ts';
import { setBoxingState } from '../tactical/narrative/boxing.ts';
import { BoxingState, boxingActive } from '../tactical/narrative/boxing-state.ts';
import type { CampaignSim } from './campaign-sim.ts';

const ABSENT = new Set<number>([Assignment.IN_TRANSIT, Assignment.ASSIGNMENT_POW, Assignment.ASSIGNMENT_DEAD]);
const ABANDON_FIGHT_TEXT = 'a boxing match is under way; send "abandonFight": true to abandon it and open the map';

function canGoToTactical(m: StrategicMerc, world: Sector): boolean {
  return m.life > 0 && !m.isVehicle && !m.betweenSectors && !ABSENT.has(m.assignment) && sameSector(m.sector, world);
}

export function openMapScreen(campaign: CampaignSim, abandonFight = false): CommandResult {
  const s = campaign.state;
  if (s.flow === 'strategic') return { ok: true };
  if (s.flow !== 'tactical') return { ok: false, reason: `the map cannot be opened during ${s.flow}` };
  const t = campaign.tactical?.state;
  if (t && boxingActive(t)) {
    if (!abandonFight) return { ok: false, reason: ABANDON_FIGHT_TEXT, data: { refusal: 'boxingInProgress' } };
    setBoxingState(t, BoxingState.NOT_BOXING);
  }
  enterMapScreen(campaign);
  return { ok: true };
}

export function enterMapScreen(campaign: CampaignSim): void {
  campaign.state.flow = 'strategic';
  const ctx = campaign.clockContext;
  if (ctx.clock.mode >= CompressMode.MIN5 && ctx.clock.mode <= CompressMode.MIN60) stopTimeCompression(ctx, CompressionStop.MAP_EXIT);
  else setGameTimeCompressionLevel(ctx, CompressMode.X0);
}

export function openTacticalScreen(campaign: CampaignSim): CommandResult {
  const s = campaign.state;
  if (s.flow === 'tactical') return { ok: true };
  const world = s.worldSector;
  if (s.flow !== 'strategic' || !world || !campaign.tactical) return { ok: false, reason: 'no sector is loaded' };
  if (!campaign.strategic?.mercs.all().some((m) => canGoToTactical(m, world)))
    return { ok: false, reason: 'no merc of yours is in the loaded sector' };
  returnToLoadedSector(campaign);
  return { ok: true };
}

export function returnToLoadedSector(campaign: CampaignSim): void {
  const s = campaign.state;
  const sectorClockMs = campaign.tactical?.state.clockMs;
  if (sectorClockMs !== undefined) {
    s.realMs = sectorClockMs;
    s.clock.driver.lastSecondMs = sectorClockMs;
  }
  s.flow = 'tactical';
  setGameTimeCompressionLevel(campaign.clockContext, CompressMode.X1);
}
