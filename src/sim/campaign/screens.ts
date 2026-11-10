// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/MapScreen.cc MapScreenHandle (entering: keep a 5-60 min mode but stop it, else X0; the
// @src loaded sector selected, or the start sector with nobody hired, 2026-11-09),
// @src EndMapScreen (with the game screen pending, the way back to the loaded sector and the placement GUI's load: X1,
// @src the pause lock and a pause the player did not set lifted; with nothing pending, EnterSector's own call for any
// @src other load from the map: compression stopped with its mode kept, so the tactical clock stands, and the lock
// @src lifted, 2026-11-03, 2026-11-10); StrategicMap.cc CanGoToTacticalInSector;
// @src Tactical/Interface_Panels.cc GoToMapScreenFromTactical, AbandonBoxingCallback (the abandon-fight question as a
// @src flag); GameScreen.cc EnterTacticalScreen and the forced reselect of MainGameScreenHandle on a return to the
// @src loaded sector (2026-10-31);
// @src GameScreen.cc InternalLeaveTacticalScreen (the timer and the unload of a sector nobody of ours is left in, and
// @src CheckForDisabledRegionRemove, 2026-11-03); Map_Screen_Interface_Bottom.cc HandleExitsFromMapScreen (the
// @src SyncStrategicTurnTimes of MAP_EXIT_TO_TACTICAL's SetCurrentWorldSector), Strategic_Turns.cc guiLastTacticalRealTime
// @src on the JA2 clock that never goes back (2026-11-05); Map_Screen_Interface_Bottom.cc AllowedToExitFromMapscreenTo (the
// @src checks of MAP_EXIT_TO_TACTICAL, 2026-11-06); Meanwhile.cc DoneFadeOutMeanwhileOnceDone (InternalLeaveTacticalScreen to the map
// @src with no world loaded, 2026-11-09).

import { type Sector, sameSector, sectorFromId } from '../../content/strategic/sector-ids.ts';
import type { CommandResult } from '../command.ts';
import { Assignment } from '../strategic/forces/constants.ts';
import type { StrategicMerc } from '../strategic/forces/ports.ts';
import { CompressMode } from '../strategic/time/constants.ts';
import {
  CompressionStop,
  setGameTimeCompressionLevel,
  stopTimeCompression,
  unLockPauseState,
  unPauseGame,
} from '../strategic/time/world-clock.ts';
import { setAutoBandagePending } from '../tactical/auto-bandage.ts';
import { setBoxingState } from '../tactical/narrative/boxing.ts';
import { BoxingState, boxingActive } from '../tactical/narrative/boxing-state.ts';
import { refuse, refused } from '../tactical/refusal.ts';
import { enterTacticalScreen } from '../tactical/selection.ts';
import { rewindRealtimeTurnStamps, syncStrategicTurnTimes } from '../tactical/turns/turns.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { syncInterfaceLockPause } from './interface-lock-pause.ts';
import { mapScreenExitRefusalOf } from './map-screen-exits.ts';
import { forgetSomeoneElseInSector } from './someone-else-in-sector.ts';

const ABSENT = new Set<number>([Assignment.IN_TRANSIT, Assignment.ASSIGNMENT_POW, Assignment.ASSIGNMENT_DEAD]);
const ABANDON_FIGHT_TEXT = 'a boxing match is under way; send "abandonFight": true to abandon it and open the map';

function canGoToTactical(m: StrategicMerc, world: Sector): boolean {
  return m.life > 0 && !m.isVehicle && !m.betweenSectors && !ABSENT.has(m.assignment) && sameSector(m.sector, world);
}

export function openMapScreen(campaign: CampaignSim, abandonFight = false): CommandResult {
  const s = campaign.state;
  if (s.flow === 'strategic') return { ok: true };
  if (s.flow !== 'tactical') return refuse('notInTactical', `the map cannot be opened during ${s.flow}`);
  const t = campaign.tactical?.state;
  if (t && boxingActive(t)) {
    if (!abandonFight) return refuse('boxingInProgress', ABANDON_FIGHT_TEXT);
    setBoxingState(t, BoxingState.NOT_BOXING);
  }
  leaveTacticalScreen(campaign);
  return { ok: true };
}

export function leaveTacticalScreen(campaign: CampaignSim): void {
  if (campaign.state.flow !== 'tactical') return;
  leaveTacticalScreenForTheMap(campaign);
}

export function leaveTacticalScreenForTheMap(campaign: CampaignSim): void {
  setAutoBandagePending(campaign.state.sectorFlow.autoBandage, false);
  const battle = campaign.state.battle;
  battle.lostBattleUnloadAtMs = null;
  forgetSomeoneElseInSector(battle);
  if (!battle.autoStart) campaign.sectors?.checkAndHandleUnloadingOfCurrentWorld();
  enterMapScreen(campaign);
  syncInterfaceLockPause(campaign);
}

export function enterMapScreen(campaign: CampaignSim): void {
  campaign.state.flow = 'strategic';
  const ctx = campaign.clockContext;
  if (ctx.clock.mode >= CompressMode.MIN5 && ctx.clock.mode <= CompressMode.MIN60) stopTimeCompression(ctx, CompressionStop.MAP_EXIT);
  else setGameTimeCompressionLevel(ctx, CompressMode.X0);
  selectSectorOnMapEntry(campaign);
}

function selectSectorOnMapEntry(campaign: CampaignSim): void {
  const strategic = campaign.strategic;
  if (!strategic) return;
  const s = campaign.state;
  const world = campaign.tactical ? s.worldSector : null;
  if (strategic.mercs.all().length === 0) s.map.selectedSector = sectorFromId(strategic.content.policy.startSector);
  else if (world) s.map.selectedSector = { ...world };
}

export function openTacticalScreen(campaign: CampaignSim): CommandResult {
  const s = campaign.state;
  if (s.flow === 'tactical') return { ok: true };
  const world = s.worldSector;
  if (s.flow !== 'strategic' || !world || !campaign.tactical) return refuse('noSector', 'no sector is loaded');
  const exit = mapScreenExitRefusalOf(campaign);
  if (exit) return refused(exit);
  if (!campaign.strategic?.mercs.all().some((m) => canGoToTactical(m, world)))
    return refuse('noMercThere', 'no merc of yours is in the loaded sector');
  syncStrategicTurnTimes(campaign.tactical.state.realtimeClock, s.realMs);
  returnToLoadedSector(campaign);
  return { ok: true };
}

export function returnToLoadedSector(campaign: CampaignSim): void {
  const s = campaign.state;
  const t = campaign.tactical?.state;
  const entering = s.flow !== 'tactical';
  const fromMap = s.flow === 'strategic';
  if (t) {
    rewindRealtimeTurnStamps(t.realtimeClock, s.realMs - t.clockMs);
    s.realMs = t.clockMs;
    s.clock.driver.lastSecondMs = t.clockMs;
  }
  s.flow = 'tactical';
  if (fromMap) endMapScreen(campaign, true);
  if (t && entering) enterTacticalScreen(t);
}

export function endMapScreen(campaign: CampaignSim, tacticalScreenPending: boolean): void {
  const ctx = campaign.clockContext;
  if (tacticalScreenPending) setGameTimeCompressionLevel(ctx, CompressMode.X1, 'tactical');
  else stopTimeCompression(ctx, CompressionStop.MAP_EXIT);
  unLockPauseState(ctx.clock);
  if (tacticalScreenPending && !ctx.clock.playerPause) unPauseGame(ctx.clock);
}
