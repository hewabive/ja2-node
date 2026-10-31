// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Auto_Resolve.cc RemoveAutoResolveInterface, IsAnybodyWounded; Town_Militia.cc
// @src CheckOneMilitiaForPromotion; Tactical/Tactical_Save.cc AddDeadSoldierToUnLoadedSector;
// @src Tactical/Rotting_Corpses.cc ReduceAmmoDroppedByNonPlayerSoldiers; TileEngine/Isometric_Utils.cc RandomGridNo;
// @src the usBattlesFought count of every merc of the battle (2026-10-24).

import { ItemClass } from '../../../../content/items/items.ts';
import { WORLD_COLS, WORLD_ROWS } from '../../../../content/world/grid.ts';
import { gridNoOnVisibleWorldTile } from '../../../../content/world/render-bounds.ts';
import { idiv, u32, udiv } from '../../../../core/int.ts';
import { cloneObject, type ItemObject, ObjectFlags } from '../../../items/object.ts';
import type { RandomStream } from '../../../tactical/combat/context.ts';
import { Body, OKLIFE, type Soldier, SoldierClass, Team } from '../../../tactical/soldier.ts';
import { mercProfile } from './attack.ts';
import { type ArCell, type AutoresolveEnv, type AutoresolveState, BattleStatus, combatContext, updateRobotController } from './state.ts';

export const MilitiaRank = { GREEN: 0, REGULAR: 1, ELITE: 2 } as const;

const MILITIA_DEATH_LIFE = idiv(OKLIFE, 2);
const MS_PER_SECOND = 1000;
const DROP_SKIP_PERCENT = 75;
const DEATH_ANIMATIONS = ['GENERIC_HIT_DEATH', 'FALLBACK_HIT_DEATH', 'PRONE_HIT_DEATH', 'FLYBACK_HIT_DEATH'] as const;
const GREEN_PROMOTION = { minPoints: 2, percentPerPoint: 25 } as const;
const REGULAR_PROMOTION = { minPoints: 5, percentPerPoint: 10 } as const;

const MILITIA_RANK_OF_CLASS: Readonly<Record<number, number>> = {
  [SoldierClass.GREEN_MILITIA]: MilitiaRank.GREEN,
  [SoldierClass.REG_MILITIA]: MilitiaRank.REGULAR,
  [SoldierClass.ELITE_MILITIA]: MilitiaRank.ELITE,
};

export interface MilitiaCounts {
  count(rank: number): number;
  remove(rank: number): void;
  promote(rank: number): void;
}

export interface AutoresolveClosePort {
  readonly militia: MilitiaCounts;
  enemiesLeftInSector(): number;
  mercDied?(merc: Soldier): void;
  mercCaptured?(merc: Soldier): void;
  playerGroupArrivedSafely?(groupId: number, checkNpcs: boolean): void;
  endCaptureSequence?(): void;
  enemyKilled?(enemy: Soldier, groupId: number): void;
  eliminateAllEnemies?(): void;
  resetEnemyMovement?(): void;
}

export type DeathAnimation = (typeof DEATH_ANIMATIONS)[number];

export interface CorpseRecord {
  readonly soldier: Soldier;
  readonly gridNo: number;
  readonly level: number;
  readonly deathAnimation: DeathAnimation;
  readonly items: readonly ItemObject[];
}

export interface MilitiaPromotions {
  greenToRegular: number;
  regularToElite: number;
  greenToElite: number;
  total: number;
}

export interface AutoresolveCloseResult {
  readonly status: number;
  readonly warpSeconds: number;
  readonly bandageEvent: boolean;
  readonly mercsDied: readonly Soldier[];
  readonly mercsCaptured: readonly Soldier[];
  readonly mercsAtCenter: readonly Soldier[];
  readonly battlesFought: readonly Soldier[];
  readonly militiaDied: readonly number[];
  readonly promotions: MilitiaPromotions;
  readonly enemiesKilled: readonly { readonly soldier: Soldier; readonly groupId: number }[];
  readonly excessEliminated: boolean;
  readonly enemyMovementReset: boolean;
  readonly corpses: readonly CorpseRecord[];
  readonly playerKills: number;
}

export function randomGridNo(main: RandomStream, restrictedScroll: number): number {
  for (;;) {
    const x = main.int(WORLD_COLS);
    const y = main.int(WORLD_ROWS);
    const g = y * WORLD_COLS + x;
    if (gridNoOnVisibleWorldTile(restrictedScroll, g)) return g;
  }
}

const isRobot = (s: Soldier) => s.bodyType === Body.ROBOTNOWEAPON;

function droppedItem(env: AutoresolveEnv, s: Soldier, o: ItemObject): ItemObject | null {
  const main = env.rng.main;
  if (s.team !== Team.OUR) {
    if (main.int(100) < DROP_SKIP_PERCENT) {
      o.flags |= ObjectFlags.UNDROPPABLE;
      return null;
    }
    if (o.flags & ObjectFlags.UNDROPPABLE) return null;
    if (env.content.items.byIndex.get(o.item)?.itemClass === ItemClass.AMMO) o.count = 1 + main.int(o.count);
  }
  return cloneObject(o);
}

export function deadSoldierRecord(env: AutoresolveEnv, s: Soldier, gridNo: number): CorpseRecord {
  const items: ItemObject[] = [];
  if (!isRobot(s)) {
    for (const o of s.inv) {
      if (o.item === 0) continue;
      const dropped = droppedItem(env, s, o);
      if (dropped) items.push(dropped);
    }
  }
  const deathAnimation = DEATH_ANIMATIONS[env.rng.main.int(DEATH_ANIMATIONS.length)] as DeathAnimation;
  return { soldier: s, gridNo, level: s.level, deathAnimation, items };
}

function addDeadSoldier(env: AutoresolveEnv, corpses: CorpseRecord[], s: Soldier): void {
  const gridNo = randomGridNo(env.rng.main, env.world.lastMapRestrictedScroll);
  corpses.push(deadSoldierRecord(env, s, gridNo));
}

function promotionAllowed(
  main: RandomStream,
  points: number,
  rule: { readonly minPoints: number; readonly percentPerPoint: number },
): boolean {
  return points >= rule.minPoints && main.int(100) < rule.percentPerPoint * points;
}

export function checkOneMilitiaForPromotion(
  main: RandomStream,
  militia: MilitiaCounts,
  startRank: number,
  killPoints: number,
): { readonly rank: number; readonly promotions: number } {
  let rank = startRank;
  while (militia.count(rank) === 0) {
    if (rank === MilitiaRank.ELITE) return { rank, promotions: 0 };
    rank++;
  }
  let points = killPoints;
  let promotions = 0;
  if (rank === MilitiaRank.GREEN) {
    if (!promotionAllowed(main, points, GREEN_PROMOTION)) return { rank, promotions };
    militia.promote(MilitiaRank.GREEN);
    promotions++;
    points -= GREEN_PROMOTION.minPoints;
  }
  if (rank === MilitiaRank.GREEN || rank === MilitiaRank.REGULAR) {
    if (!promotionAllowed(main, points, REGULAR_PROMOTION)) return { rank, promotions };
    militia.promote(MilitiaRank.REGULAR);
    promotions++;
  }
  return { rank, promotions };
}

function countPromotion(p: MilitiaPromotions, rank: number, promotions: number): void {
  if (promotions === 1 && rank === MilitiaRank.GREEN) p.greenToRegular++;
  else if (promotions === 1 && rank === MilitiaRank.REGULAR) p.regularToElite++;
  else if (promotions === 2) p.greenToElite++;
  else return;
  p.total++;
}

const isCaptured = (status: number) => status === BattleStatus.SURRENDERED || status === BattleStatus.CAPTURED;

function closeMercs(env: AutoresolveEnv, ar: AutoresolveState, port: AutoresolveClosePort, corpses: CorpseRecord[]) {
  const died: Soldier[] = [];
  const captured: Soldier[] = [];
  const atCenter: Soldier[] = [];
  const ctx = combatContext(env, ar);
  for (const c of ar.mercs) {
    const s = c.soldier;
    if (s.life === 0) {
      port.mercDied?.(s);
      died.push(s);
      addDeadSoldier(env, corpses, s);
    } else if (isCaptured(ar.status)) {
      port.mercCaptured?.(s);
      captured.push(s);
    } else if (ar.status === BattleStatus.VICTORY) atCenter.push(s);
    const p = mercProfile(ctx, s);
    if (p) p.battlesFought++;
  }
  return { died, captured, atCenter };
}

function arrivePlayerGroups(ar: AutoresolveState, port: AutoresolveClosePort): void {
  if (ar.status !== BattleStatus.VICTORY) return;
  let first = true;
  let current = 0;
  for (const c of ar.mercs) {
    if (c.soldier.life < OKLIFE || c.groupId === current) continue;
    current = c.groupId;
    port.playerGroupArrivedSafely?.(c.groupId, first);
    first = false;
  }
}

function closeMilitia(env: AutoresolveEnv, ar: AutoresolveState, port: AutoresolveClosePort, corpses: CorpseRecord[]) {
  const died: number[] = [];
  const promotions: MilitiaPromotions = { greenToRegular: 0, regularToElite: 0, greenToElite: 0, total: 0 };
  for (const c of ar.militia) {
    const rank = MILITIA_RANK_OF_CLASS[c.soldier.soldierClass];
    if (rank === undefined) continue;
    if (c.soldier.life < MILITIA_DEATH_LIFE) {
      addDeadSoldier(env, corpses, c.soldier);
      port.militia.remove(rank);
      died.push(rank);
      continue;
    }
    const result = checkOneMilitiaForPromotion(env.rng.main, port.militia, rank, c.militiaKills);
    countPromotion(promotions, result.rank, result.promotions);
  }
  return { died, promotions };
}

function closeEnemies(env: AutoresolveEnv, ar: AutoresolveState, port: AutoresolveClosePort, corpses: CorpseRecord[]) {
  const killed: { soldier: Soldier; groupId: number }[] = [];
  for (const c of ar.enemies) {
    if (c.soldier.life >= OKLIFE) continue;
    port.enemyKilled?.(c.soldier, c.groupId);
    killed.push({ soldier: c.soldier, groupId: c.groupId });
    addDeadSoldier(env, corpses, c.soldier);
  }
  return killed;
}

const isWoundedCell = (c: ArCell) => c.soldier.bleeding !== 0 && c.soldier.life !== 0;

export function closeAutoresolve(env: AutoresolveEnv, ar: AutoresolveState, port: AutoresolveClosePort): AutoresolveCloseResult {
  const bandageEvent = ar.mercs.some(isWoundedCell);
  if (ar.robot >= 0) updateRobotController(env, ar);
  const corpses: CorpseRecord[] = [];
  const mercs = closeMercs(env, ar, port, corpses);
  arrivePlayerGroups(ar, port);
  if (isCaptured(ar.status)) port.endCaptureSequence?.();
  const militia = closeMilitia(env, ar, port, corpses);
  const enemiesKilled = closeEnemies(env, ar, port, corpses);
  let excessEliminated = false;
  let enemyMovementReset = false;
  if (ar.status === BattleStatus.VICTORY) {
    if (port.enemiesLeftInSector() > 0) {
      port.eliminateAllEnemies?.();
      excessEliminated = true;
    }
  } else {
    port.resetEnemyMovement?.();
    enemyMovementReset = true;
  }
  return {
    status: ar.status,
    warpSeconds: udiv(u32(ar.elapsedMs), MS_PER_SECOND),
    bandageEvent,
    mercsDied: mercs.died,
    mercsCaptured: mercs.captured,
    mercsAtCenter: mercs.atCenter,
    battlesFought: ar.mercs.map((c) => c.soldier),
    militiaDied: militia.died,
    promotions: militia.promotions,
    enemiesKilled,
    excessEliminated,
    enemyMovementReset,
    corpses,
    playerKills: ar.playerKills,
  };
}
