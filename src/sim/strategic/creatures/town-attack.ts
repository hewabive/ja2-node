// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Creature_Spreading.cc ChooseTownSectorToAttack, CreatureAttackTown, DetermineCreatureTownComposition;
// @src src/externalized/strategic/CreatureLairModel.cc chooseTownSectorToAttack, getTownAttackDetails. See docs/17 §12.1, docs/19 §1.2.

import { type CreatureAttackSector, CreatureHabitat } from '../../../content/strategic/creature-lairs.ts';
import { type Sector, sameSector, sectorFromId, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { InsertionCode } from '../forces/constants.ts';
import type { RollSource } from '../forces/ports.ts';
import { findUndergroundSector, sectorInfo } from '../map/sectors.ts';
import { EventKind } from '../time/constants.ts';
import { addStrategicEvent } from '../time/event-queue.ts';
import { worldDay, worldTotalMinutes } from '../time/world-clock.ts';
import {
  activeLair,
  CREATURE_WEIGHTS_BY_HABITAT,
  CreatureBattleCode,
  type CreatureContext,
  CreatureWeightIndex,
  distributeCreaturesByWeight,
} from './creatures.ts';

const REPOST_DELAY_RANGE = 10;
const SPECIFIC_ATTACK_CREATURES = 5;
const MINE_EXIT_LEVEL = 1;

export interface TownAttackPorts {
  enemyInLoadedSector(): boolean;
  playerGroupsInSector(sector: Sector): boolean;
  loadedSector(): Sector | null;
  inTacticalScreen(): boolean;
  militiaInSector(sector: Sector): number;
  creaturesEatCivilians(sector: Sector, count: number): void;
  beginCreatureBattle(code: number): void;
}

export interface TownAttackContext extends CreatureContext {
  readonly ports: TownAttackPorts;
}

function chooseByChance(random: RollSource, attacks: readonly CreatureAttackSector[]): CreatureAttackSector | null {
  const total = attacks.reduce((n, a) => n + a.chance, 0);
  let roll = random.int(total);
  for (const a of attacks) {
    roll -= a.chance;
    if (roll < 0) return a;
  }
  return null;
}

function chooseTownSectorToAttack(ctx: TownAttackContext, sectorId: number, specific: boolean): void {
  const lair = activeLair(ctx);
  if (!lair) return;
  const details = specific
    ? (lair.attackSectors.find((a) => a.sector === sectorId) ?? null)
    : chooseByChance(ctx.random, lair.attackSectors);
  if (!details) return;
  const attack = ctx.state.creatures.attack;
  attack.sectorId = details.sector;
  attack.insertionCode = details.insertionCode;
  if (attack.insertionCode === InsertionCode.GRIDNO) attack.insertionGridNo = details.insertionGridNo;
}

function attackCode(ctx: TownAttackContext, sector: Sector): number | null {
  const p = ctx.ports;
  if (p.playerGroupsInSector(sector)) {
    const loaded = p.loadedSector();
    if (loaded && sameSector(loaded, sector))
      return p.inTacticalScreen() ? CreatureBattleCode.TACTICALLY_ADD : CreatureBattleCode.PRE_BATTLE_INTERFACE;
    return CreatureBattleCode.PRE_BATTLE_INTERFACE;
  }
  if (p.militiaInSector(sector)) return CreatureBattleCode.AUTORESOLVE;
  return null;
}

export function creatureAttackTown(ctx: TownAttackContext, sectorId: number, specific: boolean): void {
  const state = ctx.state;
  const attack = state.creatures.attack;
  if (ctx.ports.enemyInLoadedSector()) {
    addStrategicEvent(
      state.queue,
      EventKind.CREATURE_ATTACK,
      worldTotalMinutes(state.clock) + ctx.random.int(REPOST_DELAY_RANGE),
      sectorId,
    );
    return;
  }
  attack.battleCode = CreatureBattleCode.NONE;
  let target = sectorFromId(sectorId, MINE_EXIT_LEVEL);
  if (!specific) {
    const exit = findUndergroundSector(state.map, target);
    if (!exit?.numCreatures) {
      creatureAttackTown(ctx, sectorId, true);
      return;
    }
    attack.numAttacking = exit.numCreatures;
    exit.numCreatures = 0;
    chooseTownSectorToAttack(ctx, sectorId, false);
    target = sectorFromId(attack.sectorId, 0);
  } else {
    chooseTownSectorToAttack(ctx, sectorId, true);
    attack.numAttacking = SPECIFIC_ATTACK_CREATURES;
  }
  const sector: Sector = { x: target.x, y: target.y, z: 0 };
  const code = attackCode(ctx, sector);
  const day = worldDay(state.clock);
  const raided = state.map.sectors[sectorId];
  if (code === null) {
    if (state.map.elements[strategicIndex(sector)]?.enemyControlled === true) return;
    ctx.ports.creaturesEatCivilians(sector, attack.numAttacking);
    if (raided) raided.dayOfLastCreatureAttack = day;
    return;
  }
  attack.battleCode = code;
  if (raided) raided.dayOfLastCreatureAttack = day;
  ctx.ports.beginCreatureBattle(code);
}

export interface TownComposition {
  readonly youngMales: number;
  readonly youngFemales: number;
  readonly adultMales: number;
  readonly adultFemales: number;
}

export function determineCreatureTownComposition(random: Pick<RollSource, 'int'>, count: number): TownComposition {
  const d = distributeCreaturesByWeight(random, count, CREATURE_WEIGHTS_BY_HABITAT[CreatureHabitat.MINE_EXIT] ?? []);
  return {
    youngMales: d[CreatureWeightIndex.YOUNG_MALE] ?? 0,
    youngFemales: d[CreatureWeightIndex.YOUNG_FEMALE] ?? 0,
    adultMales: d[CreatureWeightIndex.ADULT_MALE] ?? 0,
    adultFemales: d[CreatureWeightIndex.ADULT_FEMALE] ?? 0,
  };
}

export function creatureAttackSector(ctx: Pick<CreatureContext, 'state'>): Sector {
  return sectorFromId(ctx.state.creatures.attack.sectorId, 0);
}

export function clearSurfaceCreatures(ctx: Pick<CreatureContext, 'state'>, sector: Sector): void {
  const info = sectorInfo(ctx.state.map, sector);
  info.numCreatures = 0;
  info.creaturesInBattle = 0;
}
