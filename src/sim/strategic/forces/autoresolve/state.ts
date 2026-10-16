// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Auto_Resolve.cc SOLDIERCELL, AUTORESOLVE_STRUCT, CELL_*, BATTLE_*, EnterAutoResolveMode,
// @src CalculateAutoResolveInfo, CalculateSoldierCells (logic part). See docs/19 §2.2–§2.3.

import type { CombatContext, RandomStream, StatChangedEvent } from '../../../tactical/combat/context.ts';
import type { TacticalContent } from '../../../tactical/content.ts';
import { wearsHeadGear } from '../../../tactical/inventory.ts';
import type { ProfileProgress } from '../../../tactical/profiles.ts';
import { Body, OKLIFE, type Soldier, SoldierClass } from '../../../tactical/soldier.ts';
import { EncounterCode } from '../constants.ts';

export const CellFlag = {
  MERC: 0x00000001,
  MILITIA: 0x00000002,
  ELITE: 0x00000004,
  TROOP: 0x00000008,
  ADMIN: 0x00000010,
  AF_CREATURE: 0x00000020,
  AM_CREATURE: 0x00000040,
  YF_CREATURE: 0x00000080,
  YM_CREATURE: 0x00000100,
  TEAMLEADER: 0x00000200,
  RETREATING: 0x00008000,
  RETREATED: 0x00010000,
  PROCESSED: 0x00040000,
  ASSIGNED: 0x00080000,
  EPC: 0x00100000,
  ROBOT: 0x00200000,
} as const;

export const CellGroup = {
  PLAYER: CellFlag.MERC | CellFlag.MILITIA,
  ENEMY: CellFlag.ELITE | CellFlag.TROOP | CellFlag.ADMIN,
  CREATURE: CellFlag.AF_CREATURE | CellFlag.AM_CREATURE | CellFlag.YF_CREATURE | CellFlag.YM_CREATURE,
  FEMALE_CREATURE: CellFlag.AF_CREATURE | CellFlag.YF_CREATURE,
  MALE_CREATURE: CellFlag.AM_CREATURE | CellFlag.YM_CREATURE,
} as const;

export const BattleStatus = { IN_PROGRESS: 0, VICTORY: 1, DEFEAT: 2, RETREAT: 3, SURRENDERED: 4, CAPTURED: 5 } as const;

export const MAX_AR_MERCS = 20;
export const MAX_AR_MILITIA = 20;
export const MAX_AR_ENEMIES = 32;
export const AR_SLICE_MS = 1000;
export const ENCOUNTER_DEFENCE_ADVANTAGE = 21;
export const NO_ROBOT = -1;
export const NO_CONTROLLER = -1;

export type CellSide = 'merc' | 'militia' | 'enemy';

export interface CellRef {
  readonly side: CellSide;
  readonly index: number;
}

export interface ArCell {
  readonly side: CellSide;
  readonly index: number;
  readonly soldier: Soldier;
  flags: number;
  attack: number;
  defence: number;
  nextAttack: number;
  readonly nextHit: number[];
  readonly hitDamage: number[];
  readonly attackers: (CellRef | null)[];
  weaponSlot: number;
  groupId: number;
  militiaKills: number;
}

export type ArEvent =
  | {
      readonly type: 'arAttack';
      readonly battleMs: number;
      readonly attacker: CellRef;
      readonly target: CellRef;
      readonly kind: ArAttackKind;
    }
  | { readonly type: 'arHit'; readonly battleMs: number; readonly target: CellRef; readonly damage: number; readonly life: number }
  | { readonly type: 'arMiss'; readonly battleMs: number; readonly target: CellRef }
  | { readonly type: 'arFell'; readonly battleMs: number; readonly cell: CellRef }
  | { readonly type: 'arDied'; readonly battleMs: number; readonly cell: CellRef; readonly killer: CellRef | null }
  | { readonly type: 'arRetreated'; readonly battleMs: number; readonly cell: CellRef }
  | { readonly type: 'arBattleOver'; readonly battleMs: number; readonly status: number }
  | { readonly type: 'arSound'; readonly battleMs: number; readonly sound: ArSound; readonly variant: number };

export type ArAttackKind = 'shot' | 'spit' | 'claw' | 'knife' | 'punch';
export type ArSound = 'miss' | 'impact' | 'swoosh' | 'claw' | 'smell';

export interface ArStatEvent extends StatChangedEvent {
  readonly battleMs: number;
}

export interface AutoresolveState {
  readonly sector: number;
  readonly encounter: number;
  status: number;
  elapsedMs: number;
  slices: number;
  readonly playerDefenceAdvantage: number;
  readonly enemyDefenceAdvantage: number;
  playerLeadership: number;
  enemyLeadership: number;
  playerAttack: number;
  playerDefence: number;
  enemyAttack: number;
  enemyDefence: number;
  aliveMercs: number;
  aliveCivs: number;
  aliveEnemies: number;
  readonly mercs: ArCell[];
  readonly militia: ArCell[];
  readonly enemies: ArCell[];
  readonly robot: number;
  robotController: number;
  readonly allowCapture: boolean;
  readonly captureNotPermittedDueToEPCs: boolean;
  playerRejectedSurrender: boolean;
  pendingSurrender: boolean;
  moraleEventsHandled: boolean;
  playerKills: number;
  readonly orders: RetreatOrder[];
  readonly events: ArEvent[];
  readonly statEvents: ArStatEvent[];
}

export interface RetreatOrder {
  readonly merc: number | null;
}

export interface ArRng {
  readonly pre: RandomStream;
  readonly main: RandomStream;
  readonly fx: RandomStream;
}

export function cosmeticOnMain(rng: ArRng): ArRng {
  return { pre: rng.pre, main: rng.main, fx: rng.main };
}

export interface AutoresolveHooks {
  surrender?(ar: AutoresolveState): 'accept' | 'reject' | null;
  beginCaptureSequence?(): void;
  killedEnemy?(merc: Soldier): void;
  controlsRobot?(merc: Soldier): boolean;
  battleRetreat?(ar: AutoresolveState): void;
}

export interface AutoresolveWorld {
  readonly day: number;
  readonly playerCapturedForRescue: boolean;
}

export interface AutoresolveEnv {
  readonly content: TacticalContent;
  readonly profiles: Map<number, ProfileProgress>;
  readonly rng: ArRng;
  readonly world: AutoresolveWorld;
  readonly hooks: AutoresolveHooks;
}

export interface MercCellInput {
  readonly soldier: Soldier;
  readonly epc?: boolean;
  readonly robot?: boolean;
  readonly groupId?: number;
}

export interface EnemyCellInput {
  readonly soldier: Soldier;
  readonly groupId?: number;
}

export interface AutoresolveInput {
  readonly sector: number;
  readonly encounter: number;
  readonly mercs: readonly MercCellInput[];
  readonly militia: readonly Soldier[];
  readonly enemies: readonly EnemyCellInput[];
}

export function defenceAdvantageFor(encounter: number): number {
  return encounter === EncounterCode.ENEMY_ENCOUNTER ? ENCOUNTER_DEFENCE_ADVANTAGE : 0;
}

const ENEMY_CLASS_FLAG: Readonly<Record<number, number>> = {
  [SoldierClass.ELITE]: CellFlag.ELITE,
  [SoldierClass.ARMY]: CellFlag.TROOP,
  [SoldierClass.ADMINISTRATOR]: CellFlag.ADMIN,
};

const CREATURE_BODY_FLAG: Readonly<Record<number, number>> = {
  [Body.ADULTFEMALEMONSTER]: CellFlag.AF_CREATURE,
  [Body.AM_MONSTER]: CellFlag.AM_CREATURE,
  [Body.YAF_MONSTER]: CellFlag.YF_CREATURE,
  [Body.YAM_MONSTER]: CellFlag.YM_CREATURE,
};

export function enemyCellFlags(encounter: number, s: Soldier): number {
  if (encounter === EncounterCode.CREATURE_ATTACK) return CREATURE_BODY_FLAG[s.bodyType] ?? CellFlag.YM_CREATURE;
  return ENEMY_CLASS_FLAG[s.soldierClass] ?? CellFlag.ADMIN;
}

function newCell(side: CellSide, index: number, soldier: Soldier, flags: number, groupId: number): ArCell {
  return {
    side,
    index,
    soldier,
    flags,
    attack: 0,
    defence: 0,
    nextAttack: 0,
    nextHit: [0, 0, 0],
    hitDamage: [0, 0, 0],
    attackers: [null, null, null],
    weaponSlot: 0,
    groupId,
    militiaKills: 0,
  };
}

function mercFlags(m: MercCellInput): number {
  if (m.robot) return CellFlag.MERC | CellFlag.ROBOT;
  return m.epc ? CellFlag.MERC | CellFlag.EPC : CellFlag.MERC;
}

export function createAutoresolveState(input: AutoresolveInput): AutoresolveState {
  if (input.mercs.length > MAX_AR_MERCS) throw new RangeError(`autoresolve takes at most ${MAX_AR_MERCS} merc cells`);
  if (input.militia.length > MAX_AR_MILITIA) throw new RangeError(`autoresolve takes at most ${MAX_AR_MILITIA} militia cells`);
  if (input.enemies.length > MAX_AR_ENEMIES) throw new RangeError(`autoresolve takes at most ${MAX_AR_ENEMIES} enemy cells`);
  const mercs = input.mercs.map((m, i) => newCell('merc', i, m.soldier, mercFlags(m), m.groupId ?? 0));
  const militia = input.militia.map((s, i) => newCell('militia', i, s, CellFlag.MILITIA, 0));
  const enemies = input.enemies.map((e, i) => newCell('enemy', i, e.soldier, enemyCellFlags(input.encounter, e.soldier), e.groupId ?? 0));
  const advantage = defenceAdvantageFor(input.encounter);
  return {
    sector: input.sector,
    encounter: input.encounter,
    status: BattleStatus.IN_PROGRESS,
    elapsedMs: 0,
    slices: 0,
    playerDefenceAdvantage: advantage,
    enemyDefenceAdvantage: 0,
    playerLeadership: 0,
    enemyLeadership: 0,
    playerAttack: 0,
    playerDefence: 0,
    enemyAttack: 0,
    enemyDefence: 0,
    aliveMercs: mercs.filter((c) => c.soldier.life !== 0).length,
    aliveCivs: militia.length,
    aliveEnemies: enemies.length,
    mercs,
    militia,
    enemies,
    robot: input.mercs.findIndex((m) => m.robot),
    robotController: NO_CONTROLLER,
    allowCapture: false,
    captureNotPermittedDueToEPCs: input.mercs.some((m) => m.epc || m.robot),
    playerRejectedSurrender: false,
    pendingSurrender: false,
    moraleEventsHandled: false,
    playerKills: 0,
    orders: [],
    events: [],
    statEvents: [],
  };
}

export function cellAt(ar: AutoresolveState, ref: CellRef): ArCell {
  const list = ref.side === 'merc' ? ar.mercs : ref.side === 'militia' ? ar.militia : ar.enemies;
  const cell = list[ref.index];
  if (!cell) throw new RangeError(`no ${ref.side} cell ${ref.index}`);
  return cell;
}

export const refOf = (c: ArCell): CellRef => ({ side: c.side, index: c.index });
export const sameCell = (a: CellRef | null, b: CellRef | null): boolean =>
  a === b || (a !== null && b !== null && a.side === b.side && a.index === b.index);
export const hasFlag = (c: ArCell, flag: number): boolean => (c.flags & flag) !== 0;
export const isMercCell = (c: ArCell): boolean => hasFlag(c, CellFlag.MERC);
export const isMilitiaCell = (c: ArCell): boolean => hasFlag(c, CellFlag.MILITIA);
export const isCreatureCell = (c: ArCell): boolean => hasFlag(c, CellGroup.CREATURE);

export function robotCell(ar: AutoresolveState): ArCell | null {
  return ar.robot === NO_ROBOT ? null : (ar.mercs[ar.robot] ?? null);
}

export function hasRobotController(ar: AutoresolveState): boolean {
  return ar.robotController !== NO_CONTROLLER;
}

function controlsRobot(env: AutoresolveEnv, ar: AutoresolveState, cell: ArCell, remote: number): boolean {
  if (hasFlag(cell, CellFlag.EPC | CellFlag.ROBOT) || cell.soldier.life < OKLIFE) return false;
  if (env.hooks.controlsRobot) return env.hooks.controlsRobot(cell.soldier);
  return ar.robot !== NO_ROBOT && wearsHeadGear(cell.soldier.inv, remote);
}

export function updateRobotController(env: AutoresolveEnv, ar: AutoresolveState): void {
  if (ar.robot === NO_ROBOT) return;
  const remote = env.content.items.byName.get('ROBOT_REMOTE_CONTROL')?.index ?? -1;
  const byId = [...ar.mercs].sort((a, b) => a.soldier.id - b.soldier.id);
  ar.robotController = byId.find((c) => controlsRobot(env, ar, c, remote))?.index ?? NO_CONTROLLER;
}

export function combatContext(env: AutoresolveEnv, ar: AutoresolveState): CombatContext {
  return {
    content: env.content,
    pre: env.rng.pre,
    rng: env.rng.main,
    fx: env.rng.fx,
    profiles: env.profiles,
    inCombat: false,
    turn: { attackBusyCount: 0 },
    events: { push: (e: StatChangedEvent) => ar.statEvents.push({ ...e, battleMs: ar.elapsedMs }) },
  };
}

export function emitEvent(ar: AutoresolveState, event: ArEvent): void {
  ar.events.push(event);
}
