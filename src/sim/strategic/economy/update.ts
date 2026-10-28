// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Assignments.cc UpdateAssignments, BuildSectorsWithSoldiersList, RecordSleepStatusForPastHour,
// @src IsThereASoldierInThisSector; Strategic/Hourly_Update.cc HandleHourlyUpdate, HandleQuarterHourUpdate, UpdateRegenCounters;
// @src Strategic/Game_Event_Hook.cc (HOURLY_UPDATE, QUARTER_HOUR_UPDATE, SETUP_MINE_INCOME, HANDLE_MINE_INCOME,
// @src CHECK_IF_MINE_CLEARED, BANDAGE_BLEEDING_MERCS, ENRICO_MAIL).

import { MAP_WORLD_X, MAP_WORLD_Y } from '../../../content/strategic/sector-ids.ts';
import { EventKind } from '../time/constants.ts';
import type { EventDispatch } from '../time/dispatch.ts';
import { worldHour } from '../time/world-clock.ts';
import { reEvaluateEveryonesNothingToDo } from './assignment-done.ts';
import { SECTORS_WITH_SOLDIERS_Z_LEVELS } from './constants.ts';
import {
  bandageBleedingDyingPatientsBeingTreated,
  checkForAndHandleHospitalPatients,
  handleDoctorsInSector,
  sectorsWithSoldiersKey,
  updatePatientsWhoAreDoneHealing,
} from './doctor.ts';
import { handleEnricoEmail } from './inactivity.ts';
import { clearSectorListForCompletedTrainingOfMilitia, handleContinueOfTownTraining } from './militia.ts';
import { handleIncomeFromMines, hourlyMinesUpdate, postEventsForMineProduction } from './mines.ts';
import type { EconomyContext } from './ports.ts';
import { handleRepairmenInSector } from './repair.ts';
import { handleNaturalHealing, handleRestFatigueAndSleepStatus } from './rest.ts';
import { handleTrainingInSector, reportTrainersTraineesWithoutPartners } from './training.ts';

const REGEN_UPDATE_EVERY_HOURS = 6;

export function buildSectorsWithSoldiers(ctx: EconomyContext): Set<number> {
  return new Set(ctx.crew.all().map((s) => sectorsWithSoldiersKey(s.sector)));
}

export function recordSleepStatusForPastHour(ctx: EconomyContext): Set<number> {
  return new Set(
    ctx.crew
      .all()
      .filter((s) => s.asleep)
      .map((s) => s.id),
  );
}

export function updateAssignments(ctx: EconomyContext): void {
  const sectorsWithSoldiers = buildSectorsWithSoldiers(ctx);
  const sleptPastHour = recordSleepStatusForPastHour(ctx);
  handleNaturalHealing(ctx);
  checkForAndHandleHospitalPatients(ctx, sectorsWithSoldiers);
  reportTrainersTraineesWithoutPartners(ctx);
  clearSectorListForCompletedTrainingOfMilitia(ctx);
  handleRestFatigueAndSleepStatus(ctx);
  for (let x = 0; x < MAP_WORLD_X; x++) {
    for (let y = 0; y < MAP_WORLD_Y; y++) {
      for (let z = 0; z < SECTORS_WITH_SOLDIERS_Z_LEVELS; z++) {
        const sector = { x, y, z };
        if (!sectorsWithSoldiers.has(sectorsWithSoldiersKey(sector))) continue;
        handleDoctorsInSector(ctx, sector, sleptPastHour);
        handleRepairmenInSector(ctx, sector, sleptPastHour);
        handleTrainingInSector(ctx, sector, sleptPastHour);
      }
    }
  }
  updatePatientsWhoAreDoneHealing(ctx);
  handleContinueOfTownTraining(ctx);
  reEvaluateEveryonesNothingToDo(ctx);
}

export function handleHourlyUpdate(ctx: EconomyContext): void {
  if (ctx.state.didGameJustStart) return;
  const slots = ctx.slots;
  updateAssignments(ctx);
  slots.updateBuddyAndHatedCounters?.();
  slots.hourlyMoraleUpdate?.();
  slots.hourlyCamouflageUpdate?.();
  hourlyMinesUpdate(ctx);
  slots.hourlyProgressUpdate?.();
  slots.hourlyQuestUpdate?.();
  slots.hourlyLarryUpdate?.();
  slots.hourlyCheckIfSlayAloneSoHeCanLeave?.();
  slots.payOffSkyriderDebtIfAny?.();
  if (worldHour(ctx.state.clock) % REGEN_UPDATE_EVERY_HOURS === 0) slots.updateRegenCounters?.();
}

export function handleQuarterHourUpdate(ctx: EconomyContext): void {
  if (ctx.state.didGameJustStart) return;
  ctx.slots.decayTacticalMoraleModifiers?.();
}

export function registerEconomyEvents<S>(dispatch: EventDispatch<S>, ctx: EconomyContext): void {
  dispatch.register(EventKind.HOURLY_UPDATE, () => handleHourlyUpdate(ctx));
  dispatch.register(EventKind.QUARTER_HOUR_UPDATE, () => handleQuarterHourUpdate(ctx));
  dispatch.register(EventKind.SETUP_MINE_INCOME, () => postEventsForMineProduction(ctx));
  dispatch.register(EventKind.HANDLE_MINE_INCOME, () => handleIncomeFromMines(ctx));
  dispatch.register(EventKind.CHECK_IF_MINE_CLEARED, () => hourlyMinesUpdate(ctx));
  dispatch.register(EventKind.BANDAGE_BLEEDING_MERCS, () => bandageBleedingDyingPatientsBeingTreated(ctx));
  dispatch.register(EventKind.ENRICO_MAIL, () => handleEnricoEmail(ctx));
}
