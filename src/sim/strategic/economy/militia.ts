// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Town_Militia.cc TownMilitiaTrainingCompleted, StrategicAddMilitiaToSector,
// @src StrategicPromoteMilitiaInSector, StrategicRemoveMilitiaFromSector, CheckOneMilitiaForPromotion, HandleMilitiaDefections,
// @src InitFriendlyTownSectorServer, ServeNextFriendlySectorInTown, HandleInterfaceMessageForCostOfTrainingMilitia,
// @src HandleInterfaceMessageForContinuingTrainingMilitia, PayMilitiaTrainingYesNoBoxCallback, MilitiaTrainingRejected,
// @src HandleMilitiaStatusInCurrentMapBeforeLoadingNewMap, HandleCompletionOfTownTrainingByGroupWithTrainer,
// @src ClearSectorListForCompletedTrainingOfMilitia, HandleContinueOfTownTraining, BuildListOfUnpaidTrainableSectors,
// @src StartTrainingInAllUnpaidTrainableSectors, ContinueTrainingInThisSector, PayForTrainingInSector,
// @src ResetDoneFlagForAllMilitiaTrainersInSector, SoldierClassToMilitiaRank; Strategic/Assignments.cc TrainTownInSector;
// @src Tactical/Militia_Control.cc HandleMilitiaPromotions; Map_Screen_Interface.cc
// @src ResetAssignmentsForMercsTrainingUnpaidSectorsInSelectedList, ResetAssignmentOfMercsThatWereTrainingMilitiaInThisSector.
// See docs/18 §1.

import { type Sector, sameSector, sectorFromId, sectorId } from '../../../content/strategic/sector-ids.ts';
import { u8 } from '../../../core/int.ts';
import { addTransaction, FinanceCode } from '../../campaign/finances.ts';
import { addCharacterToAnySquad } from '../forces/squads.ts';
import { sectorInfo } from '../map/sectors.ts';
import { stopTimeCompression, worldTotalMinutes } from '../time/world-clock.ts';
import { assignmentDone } from './assignment-done.ts';
import { canCharacterTrainMilitia } from './conditions.ts';
import {
  Assignment,
  MAX_ALLOWABLE_MILITIA_PER_SECTOR,
  MILITIA_TRAINING_COST,
  MILITIA_TRAINING_SQUAD_SIZE,
  MilitiaRank,
  SoldierClass,
  StatAmt,
  StatCause,
  Town,
} from './constants.ts';
import type { RejectReason } from './events.ts';
import { incrementTownLoyalty } from './loyalty.ts';
import {
  countAllMilitiaInSector,
  isAreaFullOfMilitia,
  militiaInSectorOfRank,
  sectorHasSufficientLoyaltyToTrainMilitia,
} from './militia-rules.ts';
import type { CrewMember, EconomyContext } from './ports.ts';
import type { MilitiaContinuePrompt, MilitiaPaymentPrompt } from './state.ts';
import { sectorOursAndPeaceful, townOf } from './towns.ts';

const LEADERSHIP_CHANCE_DIVISOR = 200;
const PERCENT_COMPLETE = 100;
const HUNDREDTHS = 100;
const GREEN_PROMOTION_MIN_KILL_POINTS = 2;
const GREEN_PROMOTION_CHANCE_PER_POINT = 25;
const REGULAR_PROMOTION_MIN_KILL_POINTS = 5;
const REGULAR_PROMOTION_CHANCE_PER_POINT = 10;
const DEFECTION_CHANCE: readonly number[] = [50, 75, 90];

export function strategicAddMilitiaToSector(ctx: EconomyContext, s: { x: number; y: number }, rank: number, count: number): void {
  const info = sectorInfo(ctx.state.map, s);
  info.militia[rank] = u8((info.militia[rank] ?? 0) + count);
}

export function strategicPromoteMilitiaInSector(ctx: EconomyContext, s: { x: number; y: number }, rank: number, count: number): void {
  const info = sectorInfo(ctx.state.map, s);
  if ((info.militia[rank] ?? 0) < count) return;
  info.militia[rank] = u8((info.militia[rank] ?? 0) - count);
  info.militia[rank + 1] = u8((info.militia[rank + 1] ?? 0) + count);
}

export function strategicRemoveMilitiaFromSector(ctx: EconomyContext, s: { x: number; y: number }, rank: number, count: number): void {
  const info = sectorInfo(ctx.state.map, s);
  if ((info.militia[rank] ?? 0) < count) return;
  info.militia[rank] = u8((info.militia[rank] ?? 0) - count);
}

export function soldierClassToMilitiaRank(soldierClass: number): number | null {
  if (soldierClass === SoldierClass.GREEN_MILITIA) return MilitiaRank.GREEN;
  if (soldierClass === SoldierClass.REG_MILITIA) return MilitiaRank.REGULAR;
  if (soldierClass === SoldierClass.ELITE_MILITIA) return MilitiaRank.ELITE;
  return null;
}

function friendlyTownSectors(ctx: EconomyContext, town: number, skip: Sector): Sector[] {
  const out: Sector[] = [];
  for (const ts of ctx.townSectors) {
    if (ts.town === Town.BLANK) break;
    const s = sectorFromId(ts.sector);
    if (townOf(ctx, s) !== town || sameSector(s, skip)) continue;
    if (sectorOursAndPeaceful(ctx, s)) out.push(s);
  }
  return out;
}

function firstFriendlyNeighbour(ctx: EconomyContext, town: number, sector: Sector, accept: (s: Sector) => boolean): Sector | null {
  if (town === Town.BLANK) return null;
  return friendlyTownSectors(ctx, town, sector).find(accept) ?? null;
}

export function townMilitiaTrainingCompleted(ctx: EconomyContext, trainer: CrewMember, sector: Sector): number {
  const town = townOf(ctx, sector);
  ctx.state.economy.strategicMilitiaChangesMade = true;
  let trained = 0;
  while (trained < MILITIA_TRAINING_SQUAD_SIZE) {
    if (countAllMilitiaInSector(ctx, sector) < MAX_ALLOWABLE_MILITIA_PER_SECTOR) {
      strategicAddMilitiaToSector(ctx, sector, MilitiaRank.GREEN, 1);
    } else {
      const roomy = firstFriendlyNeighbour(ctx, town, sector, (n) => countAllMilitiaInSector(ctx, n) < MAX_ALLOWABLE_MILITIA_PER_SECTOR);
      if (roomy) strategicAddMilitiaToSector(ctx, roomy, MilitiaRank.GREEN, 1);
      else if (militiaInSectorOfRank(ctx, sector, MilitiaRank.GREEN) > 0)
        strategicPromoteMilitiaInSector(ctx, sector, MilitiaRank.GREEN, 1);
      else {
        const green = firstFriendlyNeighbour(ctx, town, sector, (n) => militiaInSectorOfRank(ctx, n, MilitiaRank.GREEN) > 0);
        if (!green) break;
        strategicPromoteMilitiaInSector(ctx, green, MilitiaRank.GREEN, 1);
      }
    }
    trained++;
  }
  if (trained > 0 && town !== Town.BLANK) incrementTownLoyalty(ctx, town, ctx.economy.loyalty.amounts.BONUS_FOR_TOWN_TRAINING ?? 0);
  ctx.events.push({ type: 'militiaTrained', sector: sectorId(sector), trained });
  assignmentDone(ctx, trainer, true, false);
  for (const m of ctx.crew.all())
    if (m.assignment === Assignment.TRAIN_TOWN && sameSector(m.sector, trainer.sector)) assignmentDone(ctx, m, false, false);
  return trained;
}

export function trainTownInSector(ctx: EconomyContext, trainer: CrewMember, sector: Sector, points: number): boolean {
  const info = sectorInfo(ctx.state.map, sector);
  ctx.crew.statChange(trainer.id, StatAmt.LEADERSHIP, 1 + Math.trunc(points / LEADERSHIP_CHANCE_DIVISOR), StatCause.SUCCESS);
  info.militiaTrainingPercentDone = u8(info.militiaTrainingPercentDone + Math.trunc(points / HUNDREDTHS));
  info.militiaTrainingHundredths = u8(info.militiaTrainingHundredths + (points % HUNDREDTHS));
  if (info.militiaTrainingHundredths >= HUNDREDTHS) {
    info.militiaTrainingPercentDone = u8(info.militiaTrainingPercentDone + 1);
    info.militiaTrainingHundredths = u8(info.militiaTrainingHundredths - HUNDREDTHS);
  }
  if (info.militiaTrainingPercentDone < PERCENT_COMPLETE) return false;
  info.militiaTrainingPercentDone = 0;
  info.militiaTrainingHundredths = 0;
  info.militiaTrainingPaid = false;
  townMilitiaTrainingCompleted(ctx, trainer, sector);
  return true;
}

export function unpaidTrainableSectors(ctx: EconomyContext, soldiers: readonly CrewMember[]): number[] {
  const sectors: number[] = [];
  for (const s of soldiers) {
    if (!canCharacterTrainMilitia(ctx, s)) continue;
    const id = sectorId(s.sector);
    if (sectorInfo(ctx.state.map, s.sector).militiaTrainingPaid) continue;
    if (!sectors.includes(id)) sectors.push(id);
  }
  return sectors;
}

function resetDoneFlagForAllMilitiaTrainersInSector(ctx: EconomyContext, sector: number): void {
  for (const m of ctx.crew.all()) {
    if (m.assignment !== Assignment.TRAIN_TOWN || sectorId(m.sector) !== sector || m.sector.z !== 0) continue;
    m.nothingToDo = false;
    m.doneQuoteSaid = false;
  }
}

export function payForTrainingInSector(ctx: EconomyContext, sector: number): void {
  const record = addTransaction(
    ctx.state.finances,
    FinanceCode.TRAIN_TOWN_MILITIA,
    sector,
    worldTotalMinutes(ctx.state.clock),
    -MILITIA_TRAINING_COST,
  );
  sectorInfo(ctx.state.map, sectorFromId(sector)).militiaTrainingPaid = true;
  resetDoneFlagForAllMilitiaTrainersInSector(ctx, sector);
  ctx.events.push({ type: 'moneyChanged', code: record.code, amount: record.amount, balance: record.balanceAfter });
}

function rejectTraining(ctx: EconomyContext, soldiers: CrewMember[], reason: RejectReason): void {
  for (const m of soldiers) {
    addCharacterToAnySquad(ctx, m.id);
    stopTimeCompression(ctx.clock);
  }
  ctx.events.push({ type: 'militiaTrainingRejected', soldiers: soldiers.map((m) => m.id), reason });
}

function trainersOfUnpaidSectors(ctx: EconomyContext): CrewMember[] {
  return ctx.crew.all().filter((m) => m.assignment === Assignment.TRAIN_TOWN && !sectorInfo(ctx.state.map, m.sector).militiaTrainingPaid);
}

function trainersInSector(ctx: EconomyContext, sector: Sector): CrewMember[] {
  return ctx.crew.all().filter((m) => m.assignment === Assignment.TRAIN_TOWN && sameSector(m.sector, sector));
}

export type MilitiaPaymentOutcome = 'paid' | 'alreadyPaid' | 'declined' | 'cannotAfford' | 'pending';

export interface MilitiaPaymentFlow {
  readonly setAssignmentForList: () => void;
}

export function startMilitiaPaymentFlow(
  ctx: EconomyContext,
  trainer: CrewMember,
  selected: readonly CrewMember[],
  flow: MilitiaPaymentFlow,
): MilitiaPaymentOutcome {
  const sectors = unpaidTrainableSectors(ctx, [trainer, ...selected.filter((m) => m.id !== trainer.id)]);
  const cost = MILITIA_TRAINING_COST * sectors.length;
  if (ctx.state.finances.balance < cost) {
    rejectTraining(ctx, trainersOfUnpaidSectors(ctx), 'cannotAfford');
    return 'cannotAfford';
  }
  const prompt: MilitiaPaymentPrompt = {
    kind: 'militiaPayment',
    trainer: trainer.id,
    soldiers: selected.map((m) => m.id),
    sectors,
    cost,
    balance: ctx.state.finances.balance,
  };
  const answer = ctx.decisions.militiaPayment(prompt);
  if (answer === 'defer') {
    ctx.state.economy.prompts.push(prompt);
    ctx.events.push({ type: 'prompt', prompt });
    stopTimeCompression(ctx.clock);
    return 'pending';
  }
  return answerMilitiaPayment(ctx, prompt, answer === 'yes', flow);
}

export function answerMilitiaPayment(
  ctx: EconomyContext,
  prompt: MilitiaPaymentPrompt,
  yes: boolean,
  flow: MilitiaPaymentFlow,
): MilitiaPaymentOutcome {
  removePrompt(ctx, prompt);
  if (!yes) {
    stopTimeCompression(ctx.clock);
    rejectTraining(ctx, trainersOfUnpaidSectors(ctx), 'declined');
    return 'declined';
  }
  if (ctx.state.finances.balance < prompt.cost) {
    stopTimeCompression(ctx.clock);
    rejectTraining(ctx, trainersOfUnpaidSectors(ctx), 'cannotAfford');
    return 'cannotAfford';
  }
  flow.setAssignmentForList();
  const trainer = ctx.crew.get(prompt.trainer);
  const selected = prompt.soldiers.flatMap((id) => ctx.crew.get(id) ?? []);
  const sectors = trainer ? unpaidTrainableSectors(ctx, [trainer, ...selected.filter((m) => m.id !== trainer.id)]) : prompt.sectors;
  for (const sector of sectors) payForTrainingInSector(ctx, sector);
  return 'paid';
}

function removePrompt(ctx: EconomyContext, prompt: MilitiaPaymentPrompt | MilitiaContinuePrompt): void {
  const at = ctx.state.economy.prompts.indexOf(prompt);
  if (at >= 0) ctx.state.economy.prompts.splice(at, 1);
}

export type ContinueOutcome = 'continued' | 'declined' | RejectReason | 'pending';

export function handleInterfaceMessageForContinuingTrainingMilitia(ctx: EconomyContext, trainer: CrewMember): ContinueOutcome {
  const sector = trainer.sector;
  const reject = (reason: RejectReason): ContinueOutcome => {
    rejectTraining(ctx, trainersInSector(ctx, sector), reason);
    return reason;
  };
  if (!sectorHasSufficientLoyaltyToTrainMilitia(ctx, sector)) return reject('loyaltyTooLow');
  if (isAreaFullOfMilitia(ctx, sector)) return reject('militiaFull');
  if (ctx.state.finances.balance < MILITIA_TRAINING_COST) return reject('cannotAfford');
  const prompt: MilitiaContinuePrompt = {
    kind: 'militiaContinue',
    trainer: trainer.id,
    sector: sectorId(sector),
    cost: MILITIA_TRAINING_COST,
  };
  const answer = ctx.decisions.militiaContinue(prompt);
  if (answer === 'defer') {
    ctx.state.economy.prompts.push(prompt);
    ctx.events.push({ type: 'prompt', prompt });
    stopTimeCompression(ctx.clock);
    return 'pending';
  }
  return answerMilitiaContinue(ctx, prompt, answer === 'yes');
}

export function answerMilitiaContinue(ctx: EconomyContext, prompt: MilitiaContinuePrompt, yes: boolean): ContinueOutcome {
  removePrompt(ctx, prompt);
  const sector = sectorFromId(prompt.sector);
  const trainer = ctx.crew.get(prompt.trainer);
  const trainerSector = trainer ? trainer.sector : sector;
  if (!yes) {
    stopTimeCompression(ctx.clock);
    rejectTraining(ctx, trainersInSector(ctx, trainerSector), 'declined');
    return 'declined';
  }
  if (ctx.state.finances.balance < prompt.cost) {
    stopTimeCompression(ctx.clock);
    rejectTraining(ctx, trainersInSector(ctx, trainerSector), 'cannotAfford');
    return 'cannotAfford';
  }
  payForTrainingInSector(ctx, sectorId(trainerSector));
  return 'continued';
}

export function handleContinueOfTownTraining(ctx: EconomyContext): void {
  const list = ctx.state.economy.militiaTrainingCompletedBy.splice(0);
  for (const id of list) {
    const trainer = ctx.crew.get(id);
    if (trainer) handleInterfaceMessageForContinuingTrainingMilitia(ctx, trainer);
  }
}

export function clearSectorListForCompletedTrainingOfMilitia(ctx: EconomyContext): void {
  ctx.state.economy.militiaTrainingCompletedBy = [];
}

export interface PromotionResult {
  readonly rank: number;
  readonly promotions: number;
}

export function checkOneMilitiaForPromotion(ctx: EconomyContext, sector: Sector, startRank: number, killPoints: number): PromotionResult {
  const info = sectorInfo(ctx.state.map, sector);
  let rank = startRank;
  while ((info.militia[rank] ?? 0) === 0) {
    if (rank === MilitiaRank.ELITE) return { rank, promotions: 0 };
    rank++;
  }
  let points = killPoints;
  let promotions = 0;
  if (rank === MilitiaRank.GREEN) {
    if (points < GREEN_PROMOTION_MIN_KILL_POINTS || !ctx.random.chance(GREEN_PROMOTION_CHANCE_PER_POINT * points))
      return { rank, promotions };
    strategicPromoteMilitiaInSector(ctx, sector, MilitiaRank.GREEN, 1);
    promotions++;
    points -= GREEN_PROMOTION_MIN_KILL_POINTS;
  }
  if (rank === MilitiaRank.GREEN || rank === MilitiaRank.REGULAR) {
    if (points >= REGULAR_PROMOTION_MIN_KILL_POINTS && ctx.random.chance(REGULAR_PROMOTION_CHANCE_PER_POINT * points)) {
      strategicPromoteMilitiaInSector(ctx, sector, MilitiaRank.REGULAR, 1);
      promotions++;
    }
  }
  return { rank, promotions };
}

export interface MilitiaInBattle {
  readonly soldierClass: number;
  readonly inSector: boolean;
  readonly life: number;
  militiaKills: number;
}

export function handleMilitiaPromotions(ctx: EconomyContext, sector: Sector, militia: readonly MilitiaInBattle[]): void {
  const counters = ctx.state.economy.militiaPromotions;
  counters.total = 0;
  counters.greenToElite = 0;
  counters.greenToRegular = 0;
  counters.regularToElite = 0;
  for (const m of militia) {
    if (!m.inSector || m.life <= 0 || m.militiaKills === 0) continue;
    const rank = soldierClassToMilitiaRank(m.soldierClass);
    if (rank === null) continue;
    const result = checkOneMilitiaForPromotion(ctx, sector, rank, m.militiaKills);
    if (result.promotions === 0) continue;
    if (result.rank === MilitiaRank.ELITE) continue;
    counters.total++;
    if (result.promotions === 2) counters.greenToElite++;
    else if (result.rank === MilitiaRank.GREEN) counters.greenToRegular++;
    else counters.regularToElite++;
    m.militiaKills = 0;
  }
  if (counters.total > 0)
    ctx.events.push({
      type: 'militiaPromoted',
      greenToRegular: counters.greenToRegular,
      regularToElite: counters.regularToElite,
      greenToElite: counters.greenToElite,
    });
}

export function handleMilitiaDefections(ctx: EconomyContext, sector: Sector): void {
  let removed = 0;
  for (let rank = MilitiaRank.GREEN; rank <= MilitiaRank.ELITE; rank++) {
    const count = militiaInSectorOfRank(ctx, sector, rank);
    for (let k = 0; k < count; k++) {
      if (ctx.random.int(100) < (DEFECTION_CHANCE[rank] ?? 0)) {
        strategicRemoveMilitiaFromSector(ctx, sector, rank, 1);
        removed++;
      }
    }
  }
  ctx.events.push({ type: 'militiaDefected', sector: sectorId(sector), removed });
}

export interface UnloadMilitiaStatus {
  readonly militiaFriendly: boolean;
  readonly automaticallyStartAutoResolve: boolean;
  readonly militia: readonly MilitiaInBattle[];
}

export function handleMilitiaStatusBeforeLoadingNewMap(ctx: EconomyContext, worldSector: Sector, status: UnloadMilitiaStatus): boolean {
  if (!status.militiaFriendly) {
    handleMilitiaDefections(ctx, worldSector);
    return true;
  }
  if (!status.automaticallyStartAutoResolve) handleMilitiaPromotions(ctx, worldSector, status.militia);
  return false;
}
