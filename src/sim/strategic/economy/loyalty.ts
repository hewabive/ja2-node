// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Strategic_Town_Loyalty.cc InitTownLoyalty, StartTownLoyaltyIfFirstTime, SetTownLoyalty,
// @src IncrementTownLoyalty, DecrementTownLoyalty, UpdateTownLoyaltyRating, HandleGlobalLoyaltyEvent,
// @src AffectAllTownsLoyaltyByDistanceFrom, CheckIfEntireTownHasBeenLiberated, CheckIfEntireTownHasBeenLost,
// @src IncrementTownLoyaltyEverywhere, DecrementTownLoyaltyEverywhere, ReduceLoyaltyForRebelsBetrayed,
// @src HandleTownLoyaltyForNPCRecruitment, MaximizeLoyaltyForDeidrannaKilled; Strategic/Player_Command.cc
// @src SetThisSectorAsPlayerControlled, SetThisSectorAsEnemyControlled (loyalty, morale, mine and theft effects, the
// @src notice for an important sector).

import { type Sector, sectorFromId, sectorId, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { i16, idiv, imod, u8, u32 } from '../../../core/int.ts';
import { SectorFlag } from '../forces/constants.ts';
import { createNewPlayerGroupDepartingFromSector, numEnemiesInAnySector, removeGroup } from '../forces/groups.ts';
import { stratPathRulesForGroup } from '../forces/movement.ts';
import type { LiberationEvent, StrategicContext } from '../forces/ports.ts';
import { samIdOfSector } from '../map/control.ts';
import { findStratPath } from '../map/pathing.ts';
import { getSectorFlagStatus, updateLastDayOfPlayerActivity } from '../map/sectors.ts';
import { checkFact } from '../narrative/check-fact.ts';
import { economyFactContext } from '../narrative/economy-facts.ts';
import { Fact } from '../narrative/fact-ids.ts';
import { worldDay } from '../time/world-clock.ts';
import {
  FIRST_TOWN,
  GAIN_PTS_PER_LOYALTY_PT,
  HOSTILE_OMERTA_LOYALTY_RATING,
  LOYALTY_CHUNK,
  LOYALTY_EVENT_DISTANCE_THRESHOLD,
  LoyaltyEvent,
  MAX_LOYALTY_VALUE,
  MoraleEvent,
  NUM_TOWNS,
  Town,
  UNREACHED_DISTANCE,
} from './constants.ts';
import { militiaTrainingAllowedInSector } from './militia-rules.ts';
import { mineIndexForSector, queenHasRegainedMineSector, totalLeftInMine } from './mine-status.ts';
import type { EconomyContext } from './ports.ts';
import { notifyPlayerWhenEnemyTakesControlOfImportantSector } from './sector-loss.ts';
import { createTownLoyalty } from './state.ts';
import { isTownUnderCompleteControl, isTownUnderCompleteEnemyControl, townOf } from './towns.ts';

const HISTORY_LIBERATED_TOWN = 18;
const SEC_J9 = 153;
const SEC_K4 = 163;
const HARD_DIFFICULTY = 3;
const LIBERATION_GRACE_DAYS_HARD = 4;
const LIBERATION_GRACE_DAYS = 2;
const UNDERGROUND_DISTANCE_FACTOR = 2;
const PERCENT_PER_NEAR_SECTOR = 25;
const PERCENT_PER_FAR_SECTOR = 10;
const MAX_FAR_REDUCTION = -100;
const SENTIMENT_SCALE = 5;
const THEFT_CHANCE_PER_ENEMY = 5;
const MAX_THEFT_CHANCE = 90;
const MULTIPLIER_LOCAL_RPC_HIRED = 25;
const REBELS_BETRAYED_DIVISOR = 3;

export function isLoyaltyTown(town: number): boolean {
  return town >= FIRST_TOWN && town < NUM_TOWNS;
}

export function initTownLoyalty(ctx: EconomyContext): void {
  ctx.state.economy.towns = Array.from({ length: NUM_TOWNS }, createTownLoyalty);
}

function sentiment(ctx: EconomyContext, town: number): number {
  return ctx.economy.loyalty.rebelSentiment[town] ?? 0;
}

export function usesLoyalty(ctx: EconomyContext, town: number): boolean {
  return ctx.economy.loyalty.usesLoyalty[town] === true;
}

function loyaltyOf(ctx: EconomyContext, town: number) {
  const t = ctx.state.economy.towns[town];
  if (!t) throw new RangeError(`no town ${town}`);
  return t;
}

function reportRating(ctx: EconomyContext, town: number, before: number): void {
  const rating = loyaltyOf(ctx, town).rating;
  if (rating !== before) ctx.events.push({ type: 'loyaltyChanged', town, rating });
}

export function startTownLoyaltyIfFirstTime(ctx: EconomyContext, town: number): void {
  const t = loyaltyOf(ctx, town);
  if (t.started || !usesLoyalty(ctx, town)) return;
  const before = t.rating;
  t.rating = sentiment(ctx, town);
  const facts = economyFactContext(ctx);
  if (!checkFact(facts, Fact.MIGUEL_READ_LETTER, 0) || checkFact(facts, Fact.REBELS_HATE_PLAYER, 0)) {
    t.rating = town === Town.OMERTA ? 0 : idiv(t.rating, 2);
  }
  t.change = 0;
  t.started = true;
  reportRating(ctx, town, before);
}

export function setTownLoyalty(ctx: EconomyContext, town: number, rating: number): void {
  if (!usesLoyalty(ctx, town)) return;
  const t = loyaltyOf(ctx, town);
  const before = t.rating;
  t.rating = u8(rating);
  t.change = 0;
  t.started = true;
  reportRating(ctx, town, before);
}

function updateTownLoyaltyRating(ctx: EconomyContext, town: number): void {
  const t = loyaltyOf(ctx, town);
  const delta = idiv(t.change, GAIN_PTS_PER_LOYALTY_PT);
  if (delta > 0) {
    const max = town === Town.OMERTA && ctx.hooks.rebelsHostile() ? HOSTILE_OMERTA_LOYALTY_RATING : MAX_LOYALTY_VALUE;
    if (t.rating + delta >= max) {
      t.rating = max;
      t.change = 0;
    } else {
      t.rating = u8(t.rating + delta);
      t.change = imod(t.change, GAIN_PTS_PER_LOYALTY_PT);
    }
  } else if (delta < 0) {
    if (t.rating + delta < 0) {
      t.rating = 0;
      t.change = 0;
    } else {
      t.rating = u8(t.rating + delta);
      t.change = imod(t.change, GAIN_PTS_PER_LOYALTY_PT);
    }
  }
}

export function incrementTownLoyalty(ctx: EconomyContext, town: number, amount: number): void {
  const t = loyaltyOf(ctx, town);
  if (!t.started) return;
  const before = t.rating;
  let remaining = u32(idiv(u32(u32(amount) * SENTIMENT_SCALE * sentiment(ctx, town)), 100));
  while (remaining) {
    const chunk = Math.min(remaining, LOYALTY_CHUNK);
    t.change = i16(t.change + chunk);
    updateTownLoyaltyRating(ctx, town);
    remaining -= chunk;
  }
  reportRating(ctx, town, before);
}

export function decrementTownLoyalty(ctx: EconomyContext, town: number, amount: number): void {
  const t = loyaltyOf(ctx, town);
  if (!t.started) return;
  const before = t.rating;
  let remaining = u32(idiv(u32(u32(amount) * 100), SENTIMENT_SCALE * sentiment(ctx, town)));
  while (remaining) {
    const chunk = Math.min(remaining, LOYALTY_CHUNK);
    t.change = i16(t.change - chunk);
    updateTownLoyaltyRating(ctx, town);
    remaining -= chunk;
  }
  reportRating(ctx, town, before);
}

const BASIC_COST_FOR_CIV_MURDER = 10 * GAIN_PTS_PER_LOYALTY_PT;
const MULTIPLIER_FOR_MURDER_BY_MONSTER = 2;

export function adjustLoyaltyForCivsEatenByMonsters(ctx: EconomyContext, sector: Sector, howMany: number): void {
  const town = townOf(ctx, sector);
  if (town === Town.BLANK) return;
  decrementTownLoyalty(ctx, town, u32(howMany * BASIC_COST_FOR_CIV_MURDER * MULTIPLIER_FOR_MURDER_BY_MONSTER));
}

export function incrementTownLoyaltyEverywhere(ctx: EconomyContext, amount: number): void {
  for (let town = FIRST_TOWN; town < NUM_TOWNS; town++) incrementTownLoyalty(ctx, town, amount);
}

export function decrementTownLoyaltyEverywhere(ctx: EconomyContext, amount: number): void {
  for (let town = FIRST_TOWN; town < NUM_TOWNS; town++) decrementTownLoyalty(ctx, town, amount);
}

export function globalEventAmount(ctx: EconomyContext, event: number): number {
  const def = ctx.economy.loyalty.globalEvents[event];
  if (!def) throw new RangeError(`unknown global loyalty event ${event}`);
  return def.amount;
}

export function handleGlobalLoyaltyEvent(ctx: EconomyContext, event: number, sector: Sector): void {
  const town = sector.z === 0 ? townOf(ctx, sector) : Town.BLANK;
  if (town === Town.SAN_MONA) return;
  if (event === LoyaltyEvent.BATTLE_WON || event === LoyaltyEvent.QUEEN_BATTLE_WON) ctx.hooks.checkConditionsForTriggeringCreatureQuest();
  affectAllTownsLoyaltyByDistanceFrom(ctx, globalEventAmount(ctx, event), sector);
}

export function shortestTownDistances(ctx: EconomyContext, sector: Sector): number[] {
  const distances = new Array<number>(NUM_TOWNS).fill(UNREACHED_DISTANCE);
  const g = createNewPlayerGroupDepartingFromSector(ctx, sector);
  const rules = stratPathRulesForGroup(ctx, g);
  const from = strategicIndex(sector);
  for (const ts of ctx.townSectors) {
    const current = distances[ts.town] ?? UNREACHED_DISTANCE;
    if (current <= 0) continue;
    const d = findStratPath(from, strategicIndex(sectorFromId(ts.sector)), rules).length;
    if (d < current) distances[ts.town] = d;
  }
  removeGroup(ctx, g);
  return distances;
}

export function distancePercentAdjustment(distance: number): number {
  if (distance < LOYALTY_EVENT_DISTANCE_THRESHOLD) return PERCENT_PER_NEAR_SECTOR * (LOYALTY_EVENT_DISTANCE_THRESHOLD - distance);
  if (distance > LOYALTY_EVENT_DISTANCE_THRESHOLD)
    return Math.max(MAX_FAR_REDUCTION, -PERCENT_PER_FAR_SECTOR * (distance - LOYALTY_EVENT_DISTANCE_THRESHOLD));
  return 0;
}

export function affectAllTownsLoyaltyByDistanceFrom(ctx: EconomyContext, change: number, sector: Sector): void {
  const distances = shortestTownDistances(ctx, sector);
  for (let town = FIRST_TOWN; town < NUM_TOWNS; town++) {
    if (!loyaltyOf(ctx, town).started) continue;
    let distance = distances[town] ?? UNREACHED_DISTANCE;
    if (sector.z !== 0) distance *= UNDERGROUND_DISTANCE_FACTOR;
    const adjusted = idiv(change * (100 + distancePercentAdjustment(distance)), 100);
    if (adjusted > 0) incrementTownLoyalty(ctx, town, adjusted);
    else if (adjusted < 0) decrementTownLoyalty(ctx, town, -adjusted);
  }
}

export function checkIfEntireTownHasBeenLiberated(ctx: EconomyContext, town: number, sector: Sector): void {
  const t = loyaltyOf(ctx, town);
  if (t.liberatedAlready || !isTownUnderCompleteControl(ctx, town)) return;
  if (militiaTrainingAllowedInSector(ctx, sector)) {
    handleGlobalLoyaltyEvent(ctx, LoyaltyEvent.LIBERATE_WHOLE_TOWN, sector);
    ctx.hooks.history(HISTORY_LIBERATED_TOWN, town, sector);
    ctx.hooks.meanwhile('townLiberation', town);
  }
  const grace = ctx.state.options.difficulty >= HARD_DIFFICULTY ? LIBERATION_GRACE_DAYS_HARD : LIBERATION_GRACE_DAYS;
  updateLastDayOfPlayerActivity(ctx.state.map, worldDay(ctx.state.clock) + grace);
  t.liberatedAlready = true;
}

export function checkIfEntireTownHasBeenLost(ctx: EconomyContext, town: number, sector: Sector): void {
  if (militiaTrainingAllowedInSector(ctx, sector) && isTownUnderCompleteEnemyControl(ctx, town) && loyaltyOf(ctx, town).liberatedAlready)
    ctx.hooks.meanwhile('townLoss', town);
}

function mineWithOreLeft(ctx: EconomyContext, sector: Sector): number {
  const mine = mineIndexForSector(ctx, sectorId(sector));
  return mine !== -1 && totalLeftInMine(ctx, mine) > 0 ? mine : -1;
}

export function onSectorLiberated(ctx: EconomyContext, event: LiberationEvent): void {
  const { sector, townId, samId } = event;
  if (isLoyaltyTown(townId)) {
    ctx.hooks.moraleEvent(MoraleEvent.TOWN_LIBERATED, sector);
    handleGlobalLoyaltyEvent(ctx, LoyaltyEvent.GAIN_TOWN_SECTOR, sector);
    checkIfEntireTownHasBeenLiberated(ctx, townId, sector);
  }
  if (mineWithOreLeft(ctx, sector) !== -1) {
    ctx.hooks.moraleEvent(MoraleEvent.MINE_LIBERATED, sector);
    handleGlobalLoyaltyEvent(ctx, LoyaltyEvent.GAIN_MINE, sector);
  }
  if (samId !== -1) {
    ctx.hooks.meanwhile('samLiberation', samId);
    ctx.hooks.moraleEvent(MoraleEvent.SAM_SITE_LIBERATED, sector);
    handleGlobalLoyaltyEvent(ctx, LoyaltyEvent.GAIN_SAM, sector);
  }
}

export function theftChance(ctx: StrategicContext, sector: Sector): number {
  return Math.min(MAX_THEFT_CHANCE, u8(THEFT_CHANCE_PER_ENEMY * numEnemiesInAnySector(ctx, sector)));
}

export function onSectorTakenByEnemy(ctx: EconomyContext, sector: Sector, wasPlayerControlled: boolean): void {
  if (wasPlayerControlled) {
    const id = sectorId(sector);
    const town = townOf(ctx, sector);
    if (isLoyaltyTown(town) && sector.z === 0 && id !== SEC_J9 && id !== SEC_K4) {
      ctx.hooks.moraleEvent(MoraleEvent.TOWN_LOST, sector);
      handleGlobalLoyaltyEvent(ctx, LoyaltyEvent.LOSE_TOWN_SECTOR, sector);
      checkIfEntireTownHasBeenLost(ctx, town, sector);
    }
    const mine = mineWithOreLeft(ctx, sector);
    if (mine !== -1) {
      queenHasRegainedMineSector(ctx, mine);
      ctx.hooks.moraleEvent(MoraleEvent.MINE_LOST, sector);
      handleGlobalLoyaltyEvent(ctx, LoyaltyEvent.LOSE_MINE, sector);
    }
    if (samIdOfSector(ctx, sector) !== -1) {
      ctx.hooks.moraleEvent(MoraleEvent.SAM_SITE_LOST, sector);
      handleGlobalLoyaltyEvent(ctx, LoyaltyEvent.LOSE_SAM, sector);
    }
    notifyPlayerWhenEnemyTakesControlOfImportantSector(ctx, sector);
  }
  if (getSectorFlagStatus(ctx.state.map, sector, SectorFlag.ALREADY_VISITED))
    ctx.hooks.removeRandomItemsInSector(sector, theftChance(ctx, sector));
}

export function reduceLoyaltyForRebelsBetrayed(ctx: EconomyContext): void {
  for (let town = FIRST_TOWN; town < NUM_TOWNS; town++) {
    const t = loyaltyOf(ctx, town);
    if (town === Town.OMERTA) {
      if (t.rating > HOSTILE_OMERTA_LOYALTY_RATING) setTownLoyalty(ctx, town, HOSTILE_OMERTA_LOYALTY_RATING);
    } else setTownLoyalty(ctx, town, idiv(t.rating, REBELS_BETRAYED_DIVISOR));
  }
}

export function handleTownLoyaltyForNpcRecruitment(ctx: EconomyContext, sector: Sector, homeTown: number, townAttachment: number): void {
  const town = townOf(ctx, sector);
  if (town === Town.BLANK || town !== homeTown) return;
  incrementTownLoyalty(ctx, town, u32(MULTIPLIER_LOCAL_RPC_HIRED * townAttachment));
}

export function maximizeLoyaltyForDeidrannaKilled(ctx: EconomyContext): void {
  for (let town = FIRST_TOWN; town < NUM_TOWNS; town++) if (usesLoyalty(ctx, town)) setTownLoyalty(ctx, town, MAX_LOYALTY_VALUE);
}
