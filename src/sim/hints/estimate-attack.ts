// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/UI_Cursors.cc GetActionModeCursor, HandleNonActivatedTargetCursor (the reload cursors, the chance
// @src to get through below OK_CHANCE_TO_GET_THROUGH, InRange), HandleNonActivatedTossCursor (the launchable attachment, the
// @src under-barrel launcher in attached mode, CalculateLaunchItemChanceToGetThrough with the landing level);
// @src Weapons.cc InRange; LOS.h OK_CHANCE_TO_GET_THROUGH. See docs/28 §2.4, §6.1.

import { ItemClass, ItemCursor, NOTHING } from '../../content/items/items.ts';
import { CELL_X_SIZE, isVisibleTile } from '../../content/world/grid.ts';
import { createItem, findAttachment, type ItemObject } from '../items/object.ts';
import { withTemporaryFields } from '../knowledge/guard.ts';
import type { KnowledgeWorld } from '../knowledge/knowledge-world.ts';
import { AnimHeight, endHeight } from '../tactical/animation.ts';
import { calcTotalAPsToAttack, enoughAmmo, minAPsToThrow } from '../tactical/combat/ap.ts';
import { soldierToLocationChanceToGetThrough, soldierToSoldierBodyPartChanceToGetThrough } from '../tactical/combat/bullets.ts';
import { calcChanceToHitGun, gunRange, rangeInUnits } from '../tactical/combat/chance.ts';
import { meleeSpot } from '../tactical/combat/melee-reach.ts';
import { findAmmoToReload } from '../tactical/combat/reload.ts';
import { AimShot, WeaponMode } from '../tactical/combat/types.ts';
import { HEIGHT_UNITS } from '../tactical/explosions/physics.ts';
import { calcMaxTossRange, calcThrownChanceToHit } from '../tactical/explosions/throwing.ts';
import { calculateLaunchItemChanceToGetThrough } from '../tactical/explosions/trajectory.ts';
import { consistentWeaponMode } from '../tactical/hand-item.ts';
import { InvSlot, NO_SLOT } from '../tactical/inventory.ts';
import { tacticalPanelEnv } from '../tactical/inventory-commands.ts';
import { apsToAutoReload } from '../tactical/inventory-panel.ts';
import { movementModeState } from '../tactical/movement-mode.ts';
import { uncontrolledRobot } from '../tactical/narrative/robot.ts';
import { Body, NOWHERE, OKBREATH, type Soldier } from '../tactical/soldier.ts';
import type { WeaponModeView } from '../tactical/soldier-view.ts';
import { type TacticalState, whoIsThere } from '../tactical/state.ts';
import { actingSoldier } from './soldier-check.ts';
import { type HintRequestBase, type HintResult, hintData, refuseHint } from './types.ts';

export const OK_CHANCE_TO_GET_THROUGH = 10;
const MELEE_CHANCE_TO_GET_THROUGH = 100;
const AIM_LEVELS = 5;
const MAX_AIM = AIM_LEVELS - 1;

export type AttackCursor = 'target' | 'punch' | 'knife' | 'toss' | 'trajectory' | 'aid' | 'bomb' | 'remote' | 'invalid' | 'other';

export interface AmmoState {
  readonly empty: boolean;
  readonly canReload: boolean;
  readonly reloadAp: number;
}

export interface EstimateAttack {
  readonly cursor: AttackCursor;
  readonly weaponMode: WeaponModeView;
  readonly apCost: number;
  readonly apCostByAim: readonly number[];
  readonly actionPoints: number;
  readonly chanceToHit: number | null;
  readonly chanceToGetThrough: number;
  readonly inRange: boolean;
  readonly ammo: AmmoState;
  readonly inReach?: boolean;
  readonly pathClear?: boolean;
  readonly landsAt?: number;
  readonly landsOnLevel?: number;
  readonly maxRange?: number;
}

export interface EstimateAttackRequest extends HintRequestBase {
  readonly soldier?: unknown;
  readonly target?: unknown;
  readonly level?: unknown;
  readonly aimTime?: unknown;
  readonly bodyPart?: unknown;
  readonly burst?: unknown;
  readonly weaponMode?: unknown;
  readonly mode?: unknown;
}

const AIM_PARTS: Readonly<Record<string, number>> = {
  random: AimShot.RANDOM,
  head: AimShot.HEAD,
  torso: AimShot.TORSO,
  legs: AimShot.LEGS,
};

const WEAPON_MODE_NAMES: Readonly<Record<number, WeaponModeView>> = {
  [WeaponMode.NORMAL]: 'single',
  [WeaponMode.BURST]: 'burst',
  [WeaponMode.ATTACHED]: 'launcher',
};

const CURSOR_NAMES: Readonly<Record<number, AttackCursor>> = {
  [ItemCursor.INVALID]: 'invalid',
  [ItemCursor.PUNCH]: 'punch',
  [ItemCursor.TARGET]: 'target',
  [ItemCursor.KNIFE]: 'knife',
  [ItemCursor.AID]: 'aid',
  [ItemCursor.TOSS]: 'toss',
  [ItemCursor.REMOTE]: 'remote',
  [ItemCursor.BOMB]: 'bomb',
  [ItemCursor.TRAJECTORY]: 'trajectory',
};

const isMeleeItemClass = (cls: number) => cls === ItemClass.BLADE || (cls & (ItemClass.NONE | ItemClass.PUNCH)) !== 0;
const isVehicle = (s: Soldier) => s.bodyType >= Body.HUMVEE && s.bodyType <= Body.JEEP;
const NO_AMMO_STATE: AmmoState = { empty: false, canReload: false, reloadAp: 0 };

function itemIndex(t: TacticalState, name: string): number {
  return t.content.items.byName.get(name)?.index ?? -2;
}

function actionModeCursor(t: TacticalState, s: Soldier, isEpc: boolean): number {
  if (isEpc && s.bodyType !== Body.ROBOTNOWEAPON) return ItemCursor.INVALID;
  if (isVehicle(s) || uncontrolledRobot(t, s)) return ItemCursor.INVALID;
  if (s.weaponMode === WeaponMode.ATTACHED) return ItemCursor.TRAJECTORY;
  const hand = s.inv[InvSlot.HAND] as ItemObject;
  if (hand.item === NOTHING) return ItemCursor.PUNCH;
  let cursor = t.content.items.byIndex.get(hand.item)?.cursor ?? ItemCursor.INVALID;
  if (
    cursor === ItemCursor.INVALID &&
    (findAttachment(hand, itemIndex(t, 'DETONATOR')) !== -1 || findAttachment(hand, itemIndex(t, 'REMDETONATOR')) !== -1)
  )
    cursor = ItemCursor.BOMB;
  if (s.breath < OKBREATH && s.collapsed) cursor = ItemCursor.INVALID;
  return cursor;
}

function inRange(t: TacticalState, s: Soldier, g: number): boolean {
  const hand = s.inv[InvSlot.HAND] as ItemObject;
  const cls = t.content.items.byIndex.get(hand.item)?.itemClass;
  if (cls !== ItemClass.GUN && cls !== ItemClass.THROWING_KNIFE) return false;
  const range = rangeInUnits(s.gridNo, g);
  if (cls === ItemClass.THROWING_KNIFE) return range <= calcMaxTossRange(t, s, itemIndex(t, 'THROWING_KNIFE'), true) * CELL_X_SIZE;
  return range <= gunRange(t.content.items, hand);
}

function ammoState(t: TacticalState, s: Soldier, cursor: number): AmmoState {
  const hand = s.inv[InvSlot.HAND] as ItemObject;
  const cls = t.content.items.byIndex.get(hand.item)?.itemClass;
  const checks = cursor === ItemCursor.TRAJECTORY || (cursor === ItemCursor.TARGET && cls !== ItemClass.THROWING_KNIFE);
  if (!checks || enoughAmmo(t, s, InvSlot.HAND)) return NO_AMMO_STATE;
  const canReload = findAmmoToReload(t.content.items, s, InvSlot.HAND, NO_SLOT) !== NO_SLOT;
  return { empty: true, canReload, reloadAp: canReload ? apsToAutoReload(tacticalPanelEnv(t), s) : 0 };
}

function launchedObject(t: TacticalState, s: Soldier): ItemObject {
  const hand = s.inv[InvSlot.HAND] as ItemObject;
  const items = t.content.items;
  let launched: ItemObject = hand;
  const explosive = hand.attachments.find((a) => a.item !== NOTHING && items.byIndex.get(a.item)?.explosive);
  if (explosive) launched = createItem(items, explosive.item, explosive.status);
  if (s.weaponMode === WeaponMode.ATTACHED) {
    const slot = findAttachment(hand, itemIndex(t, 'UNDER_GLAUNCHER'));
    if (slot !== -1) launched = createItem(items, itemIndex(t, 'UNDER_GLAUNCHER'), hand.attachments[slot]?.status ?? 0);
  }
  return launched;
}

function aimCosts(t: TacticalState, s: Soldier, g: number): number[] {
  return Array.from({ length: AIM_LEVELS }, (_, aim) => calcTotalAPsToAttack(t, s, g, true, aim));
}

function estimateThrow(
  t: TacticalState,
  s: Soldier,
  g: number,
  level: number,
  aim: number,
  trajectory: boolean,
  base: EstimateBase,
): EstimateAttack {
  const ammo = trajectory ? ammoState(t, s, ItemCursor.TRAJECTORY) : NO_AMMO_STATE;
  const apCostByAim = trajectory ? aimCosts(t, s, g) : Array.from({ length: AIM_LEVELS }, () => minAPsToThrow(t, s, g));
  const launched = launchedObject(t, s);
  const landing =
    s.gridNo === g
      ? { ok: true, gridNo: g, level }
      : calculateLaunchItemChanceToGetThrough(t, s, launched, g, level, level * HEIGHT_UNITS, trajectory, true);
  const hand = s.inv[InvSlot.HAND] as ItemObject;
  return {
    ...base,
    apCost: apCostByAim[aim] ?? 0,
    apCostByAim,
    chanceToHit: landing.ok ? calcThrownChanceToHit(t, s, landing.gridNo, aim) : 0,
    chanceToGetThrough: landing.ok ? MELEE_CHANCE_TO_GET_THROUGH : 0,
    inRange: true,
    ammo,
    pathClear: landing.ok,
    landsAt: landing.gridNo,
    landsOnLevel: landing.level,
    maxRange: calcMaxTossRange(t, s, hand.item, trajectory),
  };
}

interface EstimateBase {
  readonly cursor: AttackCursor;
  readonly weaponMode: WeaponModeView;
  readonly actionPoints: number;
}

function estimateStrike(
  t: TacticalState,
  s: Soldier,
  target: number,
  level: number,
  aim: number,
  cursor: number,
  base: EstimateBase,
): EstimateAttack {
  const victim = whoIsThere(t, target, level);
  const hand = s.inv[InvSlot.HAND] as ItemObject;
  const def = t.content.items.byIndex.get(hand.item);
  const melee = hand.item === NOTHING || (def !== undefined && isMeleeItemClass(def.itemClass));
  if (melee && (!victim || level !== s.level)) return nobodyToStrike(t, s, cursor, base);
  const aimedAt = victim ? victim.gridNo : target;
  const apCostByAim = aimCosts(t, s, aimedAt);
  const chanceToHit = melee ? null : calcChanceToHitGun(t, s, target, aim, s.aimShotLocation, false);
  const chanceToGetThrough = melee
    ? MELEE_CHANCE_TO_GET_THROUGH
    : victim
      ? soldierToSoldierBodyPartChanceToGetThrough(t, s, victim, s.aimShotLocation)
      : soldierToLocationChanceToGetThrough(t, s, target, level, s.targetCubeLevel, null);
  return {
    ...base,
    apCost: apCostByAim[aim] ?? 0,
    apCostByAim,
    chanceToHit,
    chanceToGetThrough,
    inRange: melee ? true : inRange(t, s, target),
    ammo: ammoState(t, s, cursor),
    ...(melee ? { inReach: meleeSpot(t, s, target, level) !== null } : {}),
  };
}

function nobodyToStrike(t: TacticalState, s: Soldier, cursor: number, base: EstimateBase): EstimateAttack {
  return {
    ...base,
    apCost: 0,
    apCostByAim: [],
    chanceToHit: null,
    chanceToGetThrough: MELEE_CHANCE_TO_GET_THROUGH,
    inRange: true,
    ammo: ammoState(t, s, cursor),
    inReach: false,
  };
}

const ATTACK_CURSORS: ReadonlySet<number> = new Set([
  ItemCursor.TARGET,
  ItemCursor.PUNCH,
  ItemCursor.KNIFE,
  ItemCursor.TOSS,
  ItemCursor.TRAJECTORY,
]);

function attackRefusal(cursor: number, aim: number) {
  if (!ATTACK_CURSORS.has(cursor)) return refuseHint('noWeapon', 'soldier has no gun, knife, grenade, launcher or free hand');
  if (cursor === ItemCursor.TOSS && aim !== 0) return refuseHint('throwNoAim', 'throws cannot be aimed');
  return null;
}

function weaponModeOf(t: TacticalState, s: Soldier, req: EstimateAttackRequest): number {
  if (req.burst === true || req.weaponMode === 'burst') return WeaponMode.BURST;
  if (req.weaponMode === 'launcher') return WeaponMode.ATTACHED;
  if (req.weaponMode === 'single' || req.burst === false) return WeaponMode.NORMAL;
  return consistentWeaponMode(t.content.items, s);
}

export function estimateAttack(world: KnowledgeWorld, req: EstimateAttackRequest): HintResult<EstimateAttack> {
  const acting = actingSoldier(world, req.soldier);
  if ('refusal' in acting) return acting.refusal;
  const { state: t, soldier: s } = acting;
  const target = req.target;
  if (typeof target !== 'number' || !Number.isInteger(target) || !isVisibleTile(target))
    return refuseHint('badTarget', 'target must be a visible gridNo');
  const level = req.level ?? 0;
  if (level !== 0 && level !== 1) return refuseHint('badLevel', 'level must be 0 or 1');
  const aim = req.aimTime ?? 0;
  if (typeof aim !== 'number' || !Number.isInteger(aim) || aim < 0 || aim > MAX_AIM) return refuseHint('badAim', 'aimTime must be 0..4');
  const part = AIM_PARTS[String(req.bodyPart ?? 'random')];
  if (part === undefined) return refuseHint('badBodyPart', 'bodyPart must be head, torso, legs or random');
  const hand = s.inv[InvSlot.HAND] as ItemObject;
  const mode = weaponModeOf(t, s, req);
  const def = t.content.items.byIndex.get(hand.item);
  if (mode === WeaponMode.BURST && !(def?.weapon?.shotsPerBurst ?? 0)) return refuseHint('noBurst', 'this weapon cannot fire bursts');
  if (mode === WeaponMode.ATTACHED && findAttachment(hand, itemIndex(t, 'UNDER_GLAUNCHER')) === -1)
    return refuseHint('noLauncher', 'the weapon has no attached grenade launcher');
  const victim = whoIsThere(t, target, level);
  const isEpc = world.tactical?.soldierView(s.id)?.kind === 'epc';
  return withTemporaryFields(
    s,
    {
      aimTime: aim,
      uiMovementMode: movementModeState(t.content, s, req.mode),
      reverse: false,
      aimShotLocation: victim && endHeight(t.content, victim.state) !== AnimHeight.PRONE ? part : AimShot.RANDOM,
      weaponMode: mode,
      doBurst: mode === WeaponMode.BURST ? 1 : 0,
      attackingHand: InvSlot.HAND,
      attackingWeapon: hand.item,
      targetLevel: level,
      targetCubeLevel: 0,
      walkToAttackGridNo: NOWHERE,
      walkToAttackCost: 0,
      dontChargeReadyAPs: false,
      ctgtTarget: null,
    },
    () => {
      const cursor = actionModeCursor(t, s, isEpc);
      const refusal = attackRefusal(cursor, aim);
      if (refusal) return refusal;
      const base: EstimateBase = {
        cursor: CURSOR_NAMES[cursor] ?? 'other',
        weaponMode: WEAPON_MODE_NAMES[mode] ?? 'single',
        actionPoints: s.actionPoints,
      };
      if (cursor === ItemCursor.TOSS || cursor === ItemCursor.TRAJECTORY)
        return hintData(estimateThrow(t, s, target, level, aim, cursor === ItemCursor.TRAJECTORY, base));
      return hintData(estimateStrike(t, s, target, level, aim, cursor, base));
    },
  );
}
