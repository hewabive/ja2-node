// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/MapScreen.cc DrawCharacterInfo (the second assignment line: bTrainStat, fFixingRobot,
// @src bVehicleUnderRepairID; the salary by bTypeOfLastContract), DisplayCharacterList (fDoneAssignmentAndNothingToDoFlag),
// @src CanChangeSleepStatusForSoldier; Strategic/Map_Screen_Interface_TownMine_Info.cc AddTextToTownBox (control),
// @src AddTextToMineBox (status order, production, ore type), AddCommonInfoToBox (control of town and found SAM sectors,
// @src the training percentage); Strategic/Map_Screen_Interface_Map.cc ShowItemsOnMap, DrawMapIndexBigMap (found secrets),
// @src ShowTownText; Tactical/Tactical_Save.cc GetNumberOfVisibleWorldItemsFromSectorStructureForSector;
// @src Laptop/Finances.cc GetProjectedTotalDailyIncome; Strategic/Map_Screen_Interface_Bottom.cc AllowedToTimeCompress;
// @src Strategic/Game_Clock.cc (giTimeCompressMode, gfGamePaused, gfLockPauseState). See docs/28 §7, §12.1 G9–G12.

import { MineType } from '../content/strategic/economy-content.ts';
import { type Sector, sectorFromId, sectorShortString } from '../content/strategic/sector-ids.ts';
import { idiv } from '../core/int.ts';
import type {
  ClockView,
  MineStatusView,
  StrategicMercView,
  StrategicMineView,
  StrategicTownControlView,
  StrategicUndergroundView,
} from '../protocol/view.ts';
import type { CampaignSim } from '../sim/campaign/campaign-sim.ts';
import { canChangeSleepStatusForSoldier } from '../sim/strategic/economy/conditions.ts';
import { Assignment, FIRST_TOWN, NUM_TOWNS } from '../sim/strategic/economy/constants.ts';
import {
  maxDailyRemovalFromMine,
  maxPeriodicRemovalFromMine,
  mineEntrance,
  mineStatus,
  playerControlsMine,
  townAssociatedWithMine,
} from '../sim/strategic/economy/mine-status.ts';
import { predictDailyIncomeFromAMine, predictIncomeFromPlayerMines } from '../sim/strategic/economy/mines.ts';
import type { CrewMember, EconomyContext } from '../sim/strategic/economy/ports.ts';
import { sectorsUnderControl, townSize } from '../sim/strategic/economy/towns.ts';
import { SectorFlag } from '../sim/strategic/forces/constants.ts';
import type { StrategicContext } from '../sim/strategic/forces/ports.ts';
import { isSecretFoundAt } from '../sim/strategic/map/control.ts';
import { getSectorFlagStatus } from '../sim/strategic/map/sectors.ts';
import { isTimeBeingCompressed, worldDay, worldHour, worldMinute } from '../sim/strategic/time/world-clock.ts';

const NO_VEHICLE = -1;
const TRAINING_ASSIGNMENTS: ReadonlySet<number> = new Set([Assignment.TRAIN_SELF, Assignment.TRAIN_TEAMMATE, Assignment.TRAIN_BY_OTHER]);

const sectorName = (s: Sector) => (s.z ? `${sectorShortString(s)}-${s.z}` : sectorShortString(s));

export function clockView(campaign: CampaignSim): ClockView {
  const c = campaign.state.clock;
  const refusal = campaign.compressionRefusalToken();
  return {
    day: worldDay(c),
    hour: worldHour(c),
    minute: worldMinute(c),
    compressing: isTimeBeingCompressed(c),
    mode: c.mode,
    paused: c.paused,
    playerPaused: c.playerPause,
    pauseLocked: c.pauseLocked,
    canCompress: refusal === null,
    ...(refusal ? { compressRefusal: refusal } : {}),
  };
}

function assignmentDetail(m: CrewMember): Partial<StrategicMercView> {
  if (TRAINING_ASSIGNMENTS.has(m.assignment)) return { trainStat: m.trainStat };
  if (m.assignment !== Assignment.REPAIR) return {};
  if (m.fixingRobot) return { repairRobot: true };
  return m.vehicleUnderRepair !== NO_VEHICLE ? { repairVehicle: m.vehicleUnderRepair } : {};
}

export function mercMapFields(economy: EconomyContext | null, id: number, salary: number | null): Partial<StrategicMercView> {
  const m = economy?.crew.get(id);
  if (!m) return {};
  return {
    idle: m.nothingToDo,
    ...assignmentDetail(m),
    canChangeSleep: canChangeSleepStatusForSoldier(m),
    ...(salary === null ? {} : { salary }),
    bleeding: m.bleeding,
    collapsed: m.collapsed,
  };
}

export function townControlViews(economy: EconomyContext | null): StrategicTownControlView[] | null {
  if (!economy) return null;
  const views: StrategicTownControlView[] = [];
  for (let town = FIRST_TOWN; town < NUM_TOWNS; town++) {
    const size = townSize(economy, town);
    if (size > 0) views.push({ town, control: idiv(sectorsUnderControl(economy, town) * 100, size) });
  }
  return views;
}

function mineStatusName(economy: EconomyContext, mine: number): MineStatusView {
  const status = mineStatus(economy, mine);
  if (status.empty) return 'abandoned';
  if (status.shutDown) return 'shutDown';
  return status.runningOut ? 'runningOut' : 'producing';
}

export function mineViews(economy: EconomyContext | null): StrategicMineView[] | null {
  if (!economy) return null;
  return economy.state.economy.mines.map((status, mine) => ({
    mine,
    sector: sectorName(mineEntrance(economy, mine)),
    town: townAssociatedWithMine(economy, mine),
    status: mineStatusName(economy, mine),
    ore: status.mineType === MineType.GOLD ? 'gold' : 'silver',
    playerControls: playerControlsMine(economy, mine),
    predictedDailyIncome: predictDailyIncomeFromAMine(economy, mine),
    maxDailyRemoval: maxDailyRemovalFromMine(economy, mine),
    maxPeriodicRemoval: maxPeriodicRemovalFromMine(economy, mine),
  }));
}

export function projectedDailyIncome(economy: EconomyContext | null): number | null {
  return economy ? predictIncomeFromPlayerMines(economy) : null;
}

export function secretsFound(ctx: StrategicContext): string[] {
  return ctx.content.secrets.filter((s) => isSecretFoundAt(ctx, s.sector)).map((s) => sectorName(sectorFromId(s.sector)));
}

export function undergroundViews(ctx: StrategicContext): StrategicUndergroundView[] {
  return ctx.state.map.underground
    .filter((u) => getSectorFlagStatus(ctx.state.map, u.sector, SectorFlag.ALREADY_VISITED))
    .map((u) => ({ sector: sectorName(u.sector), items: u.visibleItems }));
}
