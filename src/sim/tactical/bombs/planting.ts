// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Handle_Items.cc HandleItem (the remote cursor's branch without the x-ray device, the bomb
// @src cursor's walk onto the tile, the detonator box at its end), HandleSoldierDropBomb, HandleSoldierUseRemote,
// @src StartBombMessageBox, BombMessageBoxCallBack; Soldier_Control.cc EVENT_SoldierBeginDropBomb,
// @src EVENT_SoldierBeginUseDetonator; externalized/Soldier.cc handlePendingAction (MERC_DROPBOMB); Soldier_Ani.cc codes
// @src 483 and 484; Points.cc GetTotalAPsToDropBomb; Handle_UI.cc UIMouseOnValidAttackLocation (BOMBCURS),
// @src SelectedMercCanAffordAttack (BOMBCURS) and Turn_Based_Input.cc's NO_PATH before them.

import type { OpOutcome } from '../../../content/anim/script.ts';
import { ItemCursor } from '../../../content/items/items.ts';
import { i8, i16, idiv } from '../../../core/int.ts';
import { deleteObject, findAttachment, type ItemObject } from '../../items/object.ts';
import { actionModeCursor, isDetonatorAttached, itemCursorOf } from '../action-cursor.ts';
import { anim } from '../anim-states.ts';
import { AnimHeight, height, initNewSoldierAnim, soldierGotoStationaryStance } from '../animation.ts';
import { StatCause, statChange } from '../combat/experience.ts';
import { SkillCheckReason, skillCheck } from '../combat/skill-check.ts';
import { ItemHandle } from '../combat/types.ts';
import { igniteExplosionXY } from '../explosions/explosion.ts';
import { apsToMovePlusAction } from '../give.ts';
import { InvSlot } from '../inventory.ts';
import { getNewSoldierPath } from '../movement.ts';
import { pressStatueRemote } from '../narrative/statue.ts';
import { newOKDestination } from '../pathfinding.ts';
import { AP, deductPoints, enoughPoints } from '../points.ts';
import { StatKind } from '../profiles.ts';
import { openTacticalPrompt, type TacticalPrompt, TacticalPromptKind } from '../prompts.ts';
import { effectiveExpLevel, effectiveExplosive } from '../skills.ts';
import type { Soldier } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { addItemToPool, Visibility, WorldItemFlags } from '../world-items.ts';
import { armBomb, setPlacedBySoldier } from './bomb-object.ts';
import { setOffBombsByFrequency } from './bomb-queue.ts';
import { MineFlag, setMineFlag } from './mine-flags.ts';

const DROP_BOMB_CODE = 483;
const USE_REMOTE_CODE = 484;
const PLANTED_GAIN = 25;
const FUMBLED_GAIN = 10;
const SETTING_FUMBLE_LIMIT = -20;
const SETTING_FUMBLE_SPREAD = 3;
const MAX_PLANTED_TRAP = 10;
const EXPLOSIVES_PER_TRAP_LEVEL = 20;
const EXPERIENCE_PER_TRAP_LEVEL = 3;
const PRESSURE_SETTING = 0;
const ON_THE_GROUND = 0;

export type PlantBombRefusal = 'notABomb' | 'noPath' | 'badTile' | 'notEnoughAP';

function itemIndex(t: TacticalState, name: string): number {
  return t.content.items.byName.get(name)?.index ?? -2;
}

function itemName(t: TacticalState, item: number): string {
  return t.content.items.byIndex.get(item)?.name ?? String(item);
}

function handObject(s: Soldier): ItemObject {
  return s.inv[InvSlot.HAND] as ItemObject;
}

export function apsToDropBomb(t: TacticalState, s: Soldier, g: number): number {
  return apsToMovePlusAction(t, s, g, AP.DROP_BOMB);
}

export function bombTileRefusal(t: TacticalState, s: Soldier, g: number, isEpc: boolean): 'notABomb' | 'badTile' | null {
  if (actionModeCursor(t, s, isEpc) !== ItemCursor.BOMB) return 'notABomb';
  if (g !== s.gridNo && !newOKDestination(t.pathEnv, s, g, true, s.level)) return 'badTile';
  return null;
}

export function plantBombRefusal(t: TacticalState, s: Soldier, g: number, isEpc: boolean): PlantBombRefusal | null {
  if (actionModeCursor(t, s, isEpc) !== ItemCursor.BOMB) return 'notABomb';
  const aps = t.inCombat ? apsToDropBomb(t, s, g) : null;
  if (aps === 0) return 'noPath';
  const tile = bombTileRefusal(t, s, g, isEpc);
  if (tile) return tile;
  return aps !== null && !enoughPoints(t.inCombat, s, aps) ? 'notEnoughAP' : null;
}

export function dropsBomb(t: TacticalState, s: Soldier, handItem: number): boolean {
  const cursor = itemCursorOf(t, handItem);
  if (cursor === ItemCursor.BOMB) return true;
  const attacking = s.inv[s.attackingHand];
  return cursor === ItemCursor.INVALID && attacking !== undefined && isDetonatorAttached(t, attacking);
}

export function handleDropBombItem(t: TacticalState, s: Soldier, g: number): number {
  s.pendingActionData2 = g;
  if (s.gridNo === g) {
    soldierBeginDropBomb(t, s);
    return ItemHandle.OK;
  }
  s.pendingDropBomb = true;
  if (getNewSoldierPath(t, s, g, s.uiMovementMode, 0, true)) return ItemHandle.OK;
  s.pendingDropBomb = false;
  return ItemHandle.CANNOT_GETTO_LOCATION;
}

export function handleRemoteItem(t: TacticalState, s: Soldier, g: number): number {
  if (!enoughPoints(t.inCombat, s, AP.USE_REMOTE)) return ItemHandle.NOAPS;
  deductPoints(t.inCombat, s, AP.USE_REMOTE, 0);
  s.pendingActionData2 = g;
  soldierBeginUseDetonator(t, s);
  return ItemHandle.OK;
}

function attachmentIndexIsTruthy(index: number): boolean {
  return index !== 0;
}

export function detonatorBoxAtTheEnd(t: TacticalState, s: Soldier, handItem: number): boolean {
  if (itemCursorOf(t, handItem) !== ItemCursor.INVALID) return false;
  const hand = handObject(s);
  return (
    findAttachment(hand, itemIndex(t, 'DETONATOR')) !== -1 || attachmentIndexIsTruthy(findAttachment(hand, itemIndex(t, 'REMDETONATOR')))
  );
}

function standing(t: TacticalState, s: Soldier): boolean {
  return height(t.content, s.state) === AnimHeight.STAND;
}

export function soldierBeginDropBomb(t: TacticalState, s: Soldier): void {
  if (standing(t, s)) {
    initNewSoldierAnim(t, s, anim(t.content, 'PLANT_BOMB'), 0, false);
    return;
  }
  handleSoldierDropBomb(t, s, s.pendingActionData2);
  soldierGotoStationaryStance(t, s);
}

function soldierBeginUseDetonator(t: TacticalState, s: Soldier): void {
  if (standing(t, s)) initNewSoldierAnim(t, s, anim(t.content, 'USE_REMOTE'), 0, false);
  else startBombMessageBox(t, s, s.pendingActionData2);
}

export function handlePendingDropBombOnArrival(t: TacticalState, s: Soldier): boolean {
  if (!s.pendingDropBomb) return false;
  s.pendingDropBomb = false;
  soldierBeginDropBomb(t, s);
  return true;
}

function plantedTrapLevel(t: TacticalState, s: Soldier): number {
  const level = idiv(effectiveExplosive(s), EXPLOSIVES_PER_TRAP_LEVEL) + idiv(effectiveExpLevel(t, s), EXPERIENCE_PER_TRAP_LEVEL);
  return Math.min(level, MAX_PLANTED_TRAP);
}

function placeArmedBomb(t: TacticalState, s: Soldier, g: number, visible: number): void {
  const o = handObject(s);
  o.trap = i8(plantedTrapLevel(t, s));
  setPlacedBySoldier(o, s.id);
  t.events.push({ type: 'bombPlanted', soldier: s.id, gridNo: g, item: itemName(t, o.item) });
  addItemToPool(t, g, o, visible, s.level, WorldItemFlags.ARMED_BOMB, ON_THE_GROUND);
  deleteObject(o);
}

export function handleSoldierDropBomb(t: TacticalState, s: Soldier, g: number): void {
  const o = handObject(s);
  if (isDetonatorAttached(t, o)) {
    startBombMessageBox(t, s, g);
    return;
  }
  if (!armBomb(t, o, PRESSURE_SETTING)) return;
  statChange(t, s, StatKind.EXPLOSIVES, PLANTED_GAIN, StatCause.SUCCESS);
  setMineFlag(t, g, MineFlag.PLAYER);
  placeArmedBomb(t, s, g, Visibility.BURIED);
}

export function startBombMessageBox(t: TacticalState, s: Soldier, g: number): void {
  const o = handObject(s);
  if (o.item === itemIndex(t, 'REMOTETRIGGER')) {
    pressStatueRemote(t, s);
    return;
  }
  if (o.item === itemIndex(t, 'REMOTEBOMBTRIGGER'))
    openTacticalPrompt(t, { kind: TacticalPromptKind.REMOTE_FREQUENCY, soldier: s, gridNo: g });
  else if (findAttachment(o, itemIndex(t, 'DETONATOR')) !== -1)
    openTacticalPrompt(t, { kind: TacticalPromptKind.BOMB_SETTING, soldier: s, gridNo: g, detonator: 'timed' });
  else if (findAttachment(o, itemIndex(t, 'REMDETONATOR')) !== -1)
    openTacticalPrompt(t, { kind: TacticalPromptKind.BOMB_SETTING, soldier: s, gridNo: g, detonator: 'remote' });
}

function plantingCheck(t: TacticalState, s: Soldier): number {
  const remote = findAttachment(handObject(s), itemIndex(t, 'REMDETONATOR')) !== -1;
  return skillCheck(t, s, remote ? SkillCheckReason.PLANTING_REMOTE_BOMB : SkillCheckReason.PLANTING_BOMB, 0);
}

function fumbledSetting(t: TacticalState, setting: number): number {
  return setting === 0 ? 1 : i8(setting + t.rng.int(SETTING_FUMBLE_SPREAD) - 1);
}

function blowUpInHand(t: TacticalState, s: Soldier): void {
  const z = t.world.level.heights[s.gridNo] ?? 0;
  t.events.push({ type: 'bombFumbled', soldier: s.id, gridNo: s.gridNo });
  igniteExplosionXY(t, null, i16(Math.trunc(s.x)), i16(Math.trunc(s.y)), z, s.gridNo, handObject(s).item, s.level);
}

function plantWithSetting(t: TacticalState, s: Soldier, g: number, chosen: number): void {
  const check = plantingCheck(t, s);
  let setting = chosen;
  if (check >= 0) statChange(t, s, StatKind.EXPLOSIVES, PLANTED_GAIN, StatCause.SUCCESS);
  else {
    statChange(t, s, StatKind.EXPLOSIVES, FUMBLED_GAIN, StatCause.FAILURE);
    if (check < SETTING_FUMBLE_LIMIT) {
      blowUpInHand(t, s);
      return;
    }
    setting = fumbledSetting(t, setting);
  }
  if (armBomb(t, handObject(s), setting)) placeArmedBomb(t, s, g, Visibility.VISIBLE);
}

type BombBoxPrompt = Extract<TacticalPrompt, { readonly kind: 'bombSetting' | 'remoteFrequency' }>;

export function answerBombMessageBox(t: TacticalState, prompt: BombBoxPrompt, choice: number): void {
  const s = prompt.soldier;
  if (handObject(s).item === itemIndex(t, 'REMOTEBOMBTRIGGER')) {
    t.events.push({ type: 'remoteUsed', soldier: s.id, result: 'bombs', frequency: choice });
    setOffBombsByFrequency(t, s, choice);
    return;
  }
  plantWithSetting(t, s, prompt.gridNo, choice);
}

export function bombOpcode(t: TacticalState, s: Soldier, code: number): OpOutcome | null {
  if (code === DROP_BOMB_CODE) handleSoldierDropBomb(t, s, s.pendingActionData2);
  else if (code === USE_REMOTE_CODE) startBombMessageBox(t, s, s.pendingActionData2);
  else return null;
  return 'continue';
}
