import { scriptLoops } from '../../content/anim/script.ts';
import { AnimFlags } from '../../content/anim/tables.ts';
import { handClass, ItemClass, ItemCursor, NOTHING } from '../../content/items/items.ts';
import { isVisibleTile } from '../../content/world/grid.ts';
import type { TacticalWorld } from '../../content/world/tactical-world.ts';
import { Rng } from '../../core/rng.ts';
import type { CommandResult } from '../command.ts';
import type { SimEvent } from '../events.ts';
import type { ItemObject } from '../items/object.ts';
import { AiAction } from './ai/actions.ts';
import {
  type AiControl,
  actionDone,
  aiForSlot,
  beginAiPass,
  cancelAIAction,
  createAiControl,
  freeUpFromPendingAction,
  freeUpFromRoofClimb,
  freeUpFromStanceChange,
  freeUpFromTurning,
} from './ai/control.ts';
import { checkForChangingOrders, decideAlertStatus, setNewSituation } from './ai/decide.ts';
import { endAIGuysTurn, startNPCAI } from './ai/turn-based.ts';
import {
  AnimHeight,
  changeSoldierStance,
  endHeight,
  hasAnimFlag,
  height,
  setDesiredDirection,
  soldierGotoStationaryStance,
  states,
} from './animation.ts';
import { generateBuildings } from './buildings.ts';
import { calcTotalAPsToAttack, minAPsToAttack } from './combat/ap.ts';
import { attackOpcode, handleItem, ItemHandle } from './combat/attack.ts';
import {
  soldierToLocationChanceToGetThrough,
  soldierToSoldierBodyPartChanceToGetThrough,
  updateBullets,
  updateMissAnimations,
} from './combat/bullets.ts';
import { calcChanceToHitGun } from './combat/chance.ts';
import { deathOpcode, updateSkullReleases } from './combat/death.ts';
import { soldierCollapse } from './combat/hit.ts';
import { meleeChanceToHit } from './combat/melee.ts';
import { meleeSpot } from './combat/melee-reach.ts';
import { AimShot, WeaponMode } from './combat/types.ts';
import type { TacticalContent } from './content.ts';
import { isDoorOpenAt } from './doors.ts';
import { stepExplosions } from './explosions/explosion.ts';
import { HEIGHT_UNITS, stepThrownObjects } from './explosions/physics.ts';
import { checkForRunningIntoGas, updateGassedOnNewGridNo } from './explosions/smoke.ts';
import { explosivesBusy } from './explosions/state.ts';
import { calcMaxTossRange, calcThrownChanceToHit, throwOpcode } from './explosions/throwing.ts';
import { calculateLaunchItemChanceToGetThrough } from './explosions/trajectory.ts';
import { dequeueAllGameEvents } from './game-events.ts';
import { InvSlot, itemIn } from './inventory.ts';
import { handlePendingPickupOnArrival, itemOpcode, pickupCandidates, soldierDropItem, soldierPickupItem } from './item-actions.ts';
import { initLighting, NORMAL_LIGHTLEVEL_DAY } from './lighting/lighting.ts';
import { directionToward, getNewSoldierPath, stopMerc } from './movement.ts';
import { executeOverhead, type OverheadHooks } from './overhead.ts';
import { findBestPath, PathCopy } from './pathfinding.ts';
import { mostImportantNoiseHeard } from './perception/knowledge.ts';
import { allTeamsLookForAll } from './perception/sight.ts';
import { perceptionHooks, sightHooks } from './perception/wiring.ts';
import { AP, apsToChangeStance, apsToLook, deductPoints, enoughPoints, ptsToMoveDirection } from './points.ts';
import {
  apsToClimbRoof,
  beginSoldierClimbDownRoof,
  beginSoldierClimbUpRoof,
  findHigherLevel,
  findLowerLevel,
  roofOpcode,
} from './roofs.ts';
import { OKLIFE, type Soldier, Team } from './soldier.ts';
import { createTacticalState, type TacticalState, teamMembers, whoIsThere } from './state.ts';
import { endTurn, handleEnemySightingPause, handleRealtimeTurns, type RealtimeClock, selectSoldier } from './turns/turns.ts';
import { type ItemSnapshot, Visibility } from './world-items.ts';

export interface SoldierSnapshot {
  readonly id: number;
  readonly team: number;
  readonly name: string;
  readonly bodyType: number;
  readonly gridNo: number;
  readonly x: number;
  readonly y: number;
  readonly level: number;
  readonly direction: number;
  readonly animation: number;
  readonly frame: number;
  readonly palettes: readonly [string, string, string, string];
  readonly hand: string;
  readonly ap?: number;
  readonly life?: number;
  readonly lifeMax?: number;
  readonly breath?: number;
}

export interface CombatSnapshot {
  readonly team: number;
  readonly round: number;
  readonly interrupt: boolean;
}

const AIM_PARTS: Readonly<Record<string, number>> = {
  random: AimShot.RANDOM,
  head: AimShot.HEAD,
  torso: AimShot.TORSO,
  legs: AimShot.LEGS,
};

const ATTACK_REFUSALS: Readonly<Record<number, string>> = {
  [ItemHandle.UNCONSCIOUS]: 'soldier cannot act',
  [ItemHandle.NOAPS]: 'not enough APs for this attack',
  [ItemHandle.NOAMMO]: 'out of ammo',
  [ItemHandle.BROKEN]: 'the weapon does not work',
  [ItemHandle.CANNOT_GETTO_LOCATION]: 'cannot reach the target',
};

const NOT_ADJACENT =
  'a melee target must stand next to the soldier (a knife reaches the four side tiles, fists all eight); walking up to it is not supported';

const MELEE_CHANCE_TO_GET_THROUGH = 100;
const SANDBOX_WORLD_HOUR = 12;

const isMeleeItemClass = (cls: number) => cls === ItemClass.BLADE || (cls & (ItemClass.NONE | ItemClass.PUNCH)) !== 0;
const isThrowItemClass = (cls: number) => cls === ItemClass.GRENADE || cls === ItemClass.THROWN || cls === ItemClass.LAUNCHER;

export interface TacticalCommand {
  readonly type: string;
  readonly [key: string]: unknown;
}

export class TacticalSim {
  readonly state: TacticalState;
  readonly world: TacticalWorld;
  readonly mapPath: string;
  readonly ai: AiControl;
  readonly hooks: OverheadHooks;
  #tick = 0;
  readonly #clock: RealtimeClock = { lastTurnMs: 0, lastDecayMs: 0 };

  constructor(world: TacticalWorld, content: TacticalContent, seed: number) {
    this.world = world;
    this.mapPath = world.mapPath;
    this.state = createTacticalState(
      { ...world, mapDoors: new Map(world.map.doors.map((d) => [d.gridNo, d])) },
      content,
      Rng.fromSeed(seed),
    );
    const t = this.state;
    this.ai = createAiControl({
      awareOfOpposition: (state, team) => state.perception.awareOfOpposition[team] === true,
      mostImportantNoiseHeard: (state, s) => mostImportantNoiseHeard(state, s),
    });
    const ai = this.ai;
    t.hooks = sightHooks({
      ...t.hooks,
      collapse: soldierCollapse,
      opcode: (state, s, code) =>
        attackOpcode(state, s, code) ??
        deathOpcode(state, s, code) ??
        itemOpcode(state, s, code) ??
        roofOpcode(state, s, code) ??
        throwOpcode(state, s, code),
      turnFinished: freeUpFromTurning,
      stanceFreeUp: freeUpFromStanceChange,
      pendingAction: handlePendingPickupOnArrival,
      runningIntoGas: checkForRunningIntoGas,
      enteredGridNo: updateGassedOnNewGridNo,
      endAiGuysTurn: (state, s) => endAIGuysTurn(state, s, ai),
    });
    t.perceptionHooks = perceptionHooks(t, { checkForChangingOrders, setNewSituation: (s) => setNewSituation(t, s) });
    t.turnHooks = {
      startNPCAI: (state, s) => startNPCAI(state, s, ai),
      cancelAIAction,
      decideAlertStatus: (state, s) => decideAlertStatus(state, s, ai.hooks),
      setNewSituation,
      checkForChangingOrders: (_state, s) => checkForChangingOrders(s),
      minAPsToAttack,
      suppressedStanceChange: (state, s, stance) => {
        cancelAIAction(state, s);
        s.ai.action = AiAction.CHANGE_STANCE;
        s.ai.actionData = stance;
        s.ai.actionInProgress = true;
      },
      freeUpFromAttacking: actionDone,
      aiAttack: (state, s, target, level) => handleItem(state, s, target, level, itemIn(s.inv, InvSlot.HAND)),
      freeUpFromPendingAction,
      actionDone,
      freeUpFromRoofClimb,
      aiPickup: (state, s, g, item) => soldierPickupItem(state, s, g, 0, item ? [item] : null),
      aiDropHandItem: (state, s) => soldierDropItem(state, s, InvSlot.HAND),
    };
    const clock = this.#clock;
    this.hooks = {
      beforePass: (state) => {
        stepThrownObjects(state);
        updateBullets(state);
        stepExplosions(state);
        updateMissAnimations(state);
        updateSkullReleases(state);
        handleRealtimeTurns(state, clock);
        handleEnemySightingPause(state);
        beginAiPass(state, ai);
      },
      ai: (state, s, slot) => aiForSlot(state, s, slot, ai),
      afterPass: dequeueAllGameEvents,
    };
    generateBuildings(t);
    initLighting(t, world.map, SANDBOX_WORLD_HOUR, NORMAL_LIGHTLEVEL_DAY);
  }

  get tick(): number {
    return this.#tick;
  }

  isBusy(s: Soldier): boolean {
    const content = this.state.content;
    const frozen = s.noAPToFinishMove && hasAnimFlag(content, s.state, AnimFlags.MOVING | AnimFlags.SPECIALMOVE);
    if (frozen) return false;
    return (
      !hasAnimFlag(content, s.state, AnimFlags.STATIONARY) ||
      !scriptLoops(content.scripts, s.state) ||
      hasAnimFlag(content, s.state, AnimFlags.STANCECHANGEANIM) ||
      s.desiredDirection !== s.direction ||
      s.inNonInterruptibleAnimation ||
      s.delayedMovement !== 0 ||
      s.pendingAnimation !== -1 ||
      s.pendingPickup !== null ||
      s.tempObject !== null
    );
  }

  isIdle(): boolean {
    const t = this.state;
    if (t.turn.attackBusyCount > 0 || t.bullets.length > 0 || t.gameEvents.length > 0 || explosivesBusy(t.explosives)) return false;
    if (t.inCombat && t.turn.currentTeam !== Team.OUR) return false;
    return !teamMembers(t, Team.OUR).some((s) => this.isBusy(s));
  }

  interruptOpen(): boolean {
    const t = this.state;
    return t.inCombat && t.turn.currentTeam === Team.OUR && t.turn.intList.length > 0;
  }

  hasPendingDecision(): boolean {
    return this.interruptOpen() && this.isIdle();
  }

  canAct(s: Soldier): string | null {
    const t = this.state;
    if (!s.placed || s.team !== Team.OUR) return 'no such soldier of yours';
    if (s.life < OKLIFE) return 'soldier cannot act';
    if (!t.inCombat) return null;
    if (t.turn.currentTeam !== Team.OUR) return 'it is not your turn';
    if (t.turn.attackBusyCount > 0) return 'an attack is still resolving';
    if (s.moved) return 'soldier has no move this turn';
    const other = teamMembers(t, Team.OUR).find((x) => x !== s && this.isBusy(x));
    if (other) return `soldier ${other.id} is still acting`;
    return null;
  }

  lookAround(): void {
    allTeamsLookForAll(this.state);
  }

  step(): void {
    executeOverhead(this.state, this.hooks);
    this.#tick++;
  }

  drainEvents(): SimEvent[] {
    const events = this.state.events.splice(0).map((e) => ({ ...e, tick: this.#tick }) as SimEvent);
    return events;
  }

  soldier(id: unknown): Soldier | null {
    return typeof id === 'number' ? (this.state.soldiers[id] ?? null) : null;
  }

  dispatch(cmd: TacticalCommand): CommandResult {
    switch (cmd.type) {
      case 'move':
        return this.#move(cmd);
      case 'turn':
        return this.#turn(cmd);
      case 'stance':
        return this.#stance(cmd);
      case 'endTurn':
        return this.#endTurn();
      case 'attack':
        return this.#attack(cmd);
      case 'estimateAttack':
        return this.#estimateAttack(cmd);
      case 'pickUp':
        return this.#pickUp(cmd);
      case 'drop':
        return this.#drop(cmd);
      case 'climb':
        return this.#climb(cmd);
      case 'stop': {
        const s = this.soldier(cmd.soldier);
        if (!s || s.team !== Team.OUR) return { ok: false, reason: 'no such soldier of yours' };
        stopMerc(this.state, s);
        s.finalDestination = s.gridNo;
        return { ok: true };
      }
      default:
        return { ok: false, reason: `unknown command ${cmd.type}` };
    }
  }

  visibleItems(): ItemSnapshot[] {
    const items = this.state.content.items;
    return this.state.worldItems
      .filter((wi) => wi.visible === Visibility.VISIBLE)
      .map((wi) => ({
        gridNo: wi.gridNo,
        level: wi.level,
        item: items.byIndex.get(wi.object.item)?.name ?? String(wi.object.item),
        count: wi.object.count,
        status: wi.object.status[0] ?? 0,
      }))
      .sort((a, b) => a.gridNo - b.gridNo || a.level - b.level);
  }

  #pickUp(cmd: TacticalCommand): CommandResult {
    const t = this.state;
    const s = this.soldier(cmd.soldier);
    if (!s) return { ok: false, reason: 'no such soldier of yours' };
    const refusal = this.canAct(s);
    if (refusal) return { ok: false, reason: refusal };
    const g = cmd.gridNo === undefined ? s.gridNo : cmd.gridNo;
    if (typeof g !== 'number' || !Number.isInteger(g) || !isVisibleTile(g)) return { ok: false, reason: 'gridNo must be a visible tile' };
    if (!hasAnimFlag(t.content, s.state, AnimFlags.STATIONARY)) return { ok: false, reason: 'stop the soldier first' };
    const zLevel = cmd.zLevel === 1 ? 1 : 0;
    const candidates = pickupCandidates(t, s, g, zLevel);
    if (candidates.length === 0) return { ok: false, reason: 'nothing to pick up there' };
    let selection = null;
    if (cmd.items !== undefined) {
      if (!Array.isArray(cmd.items) || cmd.items.length === 0) return { ok: false, reason: 'items must be a non-empty list of indices' };
      const picked = cmd.items.map((k: unknown) => (typeof k === 'number' ? candidates[k] : undefined));
      if (picked.some((wi) => wi === undefined)) return { ok: false, reason: `item indices must be 0..${candidates.length - 1}` };
      selection = picked as typeof candidates;
    }
    if (!enoughPoints(t.inCombat, s, AP.PICKUP_ITEM)) return { ok: false, reason: `not enough APs: ${AP.PICKUP_ITEM} needed` };
    selectSoldier(t, s);
    if (!soldierPickupItem(t, s, g, zLevel, selection)) return { ok: false, reason: 'no path' };
    return { ok: true };
  }

  #drop(cmd: TacticalCommand): CommandResult {
    const t = this.state;
    const s = this.soldier(cmd.soldier);
    if (!s) return { ok: false, reason: 'no such soldier of yours' };
    const refusal = this.canAct(s);
    if (refusal) return { ok: false, reason: refusal };
    const slot = cmd.slot === undefined || cmd.slot === 'hand' ? InvSlot.HAND : cmd.slot;
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot >= s.inv.length)
      return { ok: false, reason: 'slot must be 0..18 or "hand"' };
    if (itemIn(s.inv, slot) === NOTHING) return { ok: false, reason: 'that slot is empty' };
    if (!hasAnimFlag(t.content, s.state, AnimFlags.STATIONARY)) return { ok: false, reason: 'stop the soldier first' };
    if (!enoughPoints(t.inCombat, s, AP.PICKUP_ITEM)) return { ok: false, reason: `not enough APs: ${AP.PICKUP_ITEM} needed` };
    selectSoldier(t, s);
    deductPoints(t.inCombat, s, AP.PICKUP_ITEM, 0);
    soldierDropItem(t, s, slot);
    return { ok: true };
  }

  #climb(cmd: TacticalCommand): CommandResult {
    const t = this.state;
    const s = this.soldier(cmd.soldier);
    if (!s) return { ok: false, reason: 'no such soldier of yours' };
    const refusal = this.canAct(s);
    if (refusal) return { ok: false, reason: refusal };
    if (!hasAnimFlag(t.content, s.state, AnimFlags.STATIONARY)) return { ok: false, reason: 'stop the soldier first' };
    const down = s.level > 0;
    if ((down ? findLowerLevel(t, s) : findHigherLevel(t, s)) < 0)
      return { ok: false, reason: down ? 'no free ground next to the roof edge' : 'no roof edge next to the soldier' };
    const ap = apsToClimbRoof(t, s, down);
    if (!enoughPoints(t.inCombat, s, ap)) return { ok: false, reason: `not enough APs: ${ap} needed` };
    selectSoldier(t, s);
    if (!(down ? beginSoldierClimbDownRoof(t, s) : beginSoldierClimbUpRoof(t, s))) return { ok: false, reason: 'cannot climb here' };
    return { ok: true };
  }

  #movementMode(s: Soldier, mode: unknown): number {
    const st = states(this.state.content.animations);
    switch (mode) {
      case 'run':
        return st.RUNNING;
      case 'walk':
        return st.WALKING;
      case 'swat':
        return st.SWATTING;
      case 'crawl':
        return st.CRAWLING;
    }
    const stance = endHeight(this.state.content, s.state);
    return stance === AnimHeight.PRONE ? st.CRAWLING : stance === AnimHeight.CROUCH ? st.SWATTING : st.WALKING;
  }

  #move(cmd: TacticalCommand): CommandResult {
    const t = this.state;
    const s = this.soldier(cmd.soldier);
    if (!s) return { ok: false, reason: 'no such soldier of yours' };
    const refusal = this.canAct(s);
    if (refusal) return { ok: false, reason: refusal };
    const to = cmd.to;
    if (typeof to !== 'number' || !Number.isInteger(to) || !isVisibleTile(to))
      return { ok: false, reason: 'destination must be a visible gridNo' };
    s.uiMovementMode = this.#movementMode(s, cmd.mode);
    s.pathStored = false;
    if (t.inCombat) {
      const route = findBestPath(t.pathEnv, s, to, s.level, { copy: PathCopy.ROUTE });
      if (route.length === 0) return { ok: false, reason: 'no path' };
      const ctx = { env: t.pathEnv, content: t.content, inCombat: t.inCombat };
      const first =
        ptsToMoveDirection(ctx, s, route.steps[0] ?? 0, s.uiMovementMode) +
        apsToChangeStance(t.content, s, height(t.content, s.uiMovementMode));
      if (!enoughPoints(t.inCombat, s, first)) {
        s.contPathLocation = to;
        s.goodContPath = true;
        return { ok: false, reason: `not enough APs: the first step costs ${first}, ${s.actionPoints} left` };
      }
    }
    selectSoldier(t, s);
    if (s.noAPToFinishMove) s.noAPToFinishMove = false;
    if (!getNewSoldierPath(t, s, to, s.uiMovementMode, 1, s.noAPToFinishMove)) return { ok: false, reason: 'no path' };
    return { ok: true };
  }

  #turn(cmd: TacticalCommand): CommandResult {
    const t = this.state;
    const s = this.soldier(cmd.soldier);
    if (!s) return { ok: false, reason: 'no such soldier of yours' };
    const refusal = this.canAct(s);
    if (refusal) return { ok: false, reason: refusal };
    const direction =
      typeof cmd.toward === 'number' && isVisibleTile(cmd.toward) ? directionToward(s.gridNo, cmd.toward) : (cmd.direction as number);
    if (typeof direction !== 'number' || !Number.isInteger(direction) || direction < 0 || direction > 7)
      return { ok: false, reason: 'give direction 0..7 or toward: gridNo' };
    if (direction === s.direction) return { ok: false, reason: 'already facing that way' };
    if (!enoughPoints(t.inCombat, s, apsToLook(t.content, s))) return { ok: false, reason: 'not enough APs to turn' };
    if (s.noAPToFinishMove) soldierGotoStationaryStance(t, s);
    selectSoldier(t, s);
    setDesiredDirection(t, s, direction);
    return { ok: true };
  }

  #stance(cmd: TacticalCommand): CommandResult {
    const t = this.state;
    const s = this.soldier(cmd.soldier);
    if (!s) return { ok: false, reason: 'no such soldier of yours' };
    const refusal = this.canAct(s);
    if (refusal) return { ok: false, reason: refusal };
    const wanted =
      cmd.stance === 'stand'
        ? AnimHeight.STAND
        : cmd.stance === 'crouch'
          ? AnimHeight.CROUCH
          : cmd.stance === 'prone'
            ? AnimHeight.PRONE
            : -1;
    if (wanted < 0) return { ok: false, reason: 'stance must be stand, crouch or prone' };
    if (endHeight(t.content, s.state) === wanted) return { ok: false, reason: 'already in that stance' };
    if (t.inCombat) {
      const ap = apsToChangeStance(t.content, s, wanted);
      if (!enoughPoints(t.inCombat, s, ap)) return { ok: false, reason: `not enough APs: ${ap} needed` };
      changeSoldierStance(t, s, wanted);
      s.finalDestination = s.gridNo;
      s.goodContPath = false;
    } else if (hasAnimFlag(t.content, s.state, AnimFlags.STATIONARY)) changeSoldierStance(t, s, wanted);
    else return { ok: false, reason: 'stop the soldier before changing stance in real time' };
    const st = states(t.content.animations);
    s.uiMovementMode = wanted === AnimHeight.STAND ? st.WALKING : wanted === AnimHeight.CROUCH ? st.SWATTING : st.CRAWLING;
    selectSoldier(t, s);
    return { ok: true };
  }

  #attackSetup(cmd: TacticalCommand): { s: Soldier; target: number; level: number; melee: boolean; thrown: boolean } | { error: string } {
    const t = this.state;
    const s = this.soldier(cmd.soldier);
    if (!s?.placed || s.team !== Team.OUR) return { error: 'no such soldier of yours' };
    const target = cmd.target;
    if (typeof target !== 'number' || !Number.isInteger(target) || !isVisibleTile(target))
      return { error: 'target must be a visible gridNo' };
    const level = cmd.level ?? 0;
    if (level !== 0 && level !== 1) return { error: 'level must be 0 or 1' };
    const aimTime = cmd.aimTime ?? 0;
    if (typeof aimTime !== 'number' || !Number.isInteger(aimTime) || aimTime < 0 || aimTime > 4) return { error: 'aimTime must be 0..4' };
    const hand = itemIn(s.inv, InvSlot.HAND);
    const def = t.content.items.byIndex.get(hand);
    const melee = def !== undefined && isMeleeItemClass(def.itemClass);
    const thrown = def !== undefined && isThrowItemClass(def.itemClass);
    if (!def || (def.itemClass !== ItemClass.GUN && !melee && !thrown))
      return { error: 'soldier has no gun, knife, grenade, launcher or free hand' };
    if (cmd.burst === true && (melee || thrown || !(def.weapon?.shotsPerBurst ?? 0))) return { error: 'this weapon cannot fire bursts' };
    if (thrown && def.cursor === ItemCursor.TOSS && aimTime !== 0) return { error: 'throws cannot be aimed' };
    const victim = whoIsThere(t, target, level);
    if (melee && (!victim || level !== s.level)) return { error: 'a melee attack needs a soldier on the target tile at the same level' };
    const part = AIM_PARTS[String(cmd.bodyPart ?? 'random')];
    if (part === undefined) return { error: 'bodyPart must be head, torso, legs or random' };
    s.aimTime = aimTime;
    s.aimShotLocation = victim && endHeight(t.content, victim.state) !== AnimHeight.PRONE ? part : AimShot.RANDOM;
    s.weaponMode = cmd.burst === true ? WeaponMode.BURST : WeaponMode.NORMAL;
    s.doBurst = cmd.burst === true ? 1 : 0;
    s.attackingHand = InvSlot.HAND;
    s.attackingWeapon = hand;
    s.targetLevel = level;
    s.targetCubeLevel = 0;
    return { s, target, level, melee, thrown };
  }

  #attack(cmd: TacticalCommand): CommandResult {
    const t = this.state;
    const s0 = this.soldier(cmd.soldier);
    if (s0) {
      const refusal = this.canAct(s0);
      if (refusal) return { ok: false, reason: refusal };
    }
    const setup = this.#attackSetup(cmd);
    if ('error' in setup) return { ok: false, reason: setup.error };
    const { s, target, level, melee } = setup;
    if (target === s.gridNo) return { ok: false, reason: 'cannot attack own tile' };
    if (melee) {
      if (!meleeSpot(t, s, target, level)) return { ok: false, reason: NOT_ADJACENT };
      if (!enoughPoints(t.inCombat, s, calcTotalAPsToAttack(t, s, target, true, s.aimTime)))
        return { ok: false, reason: ATTACK_REFUSALS[ItemHandle.NOAPS] ?? 'not enough APs' };
    }
    if (s.noAPToFinishMove) soldierGotoStationaryStance(t, s);
    const result = handleItem(t, s, target, level, s.attackingWeapon);
    if (result !== ItemHandle.OK) return { ok: false, reason: ATTACK_REFUSALS[result] ?? `attack refused (${result})` };
    selectSoldier(t, s);
    return { ok: true };
  }

  #estimateAttack(cmd: TacticalCommand): CommandResult {
    const t = this.state;
    const s = this.soldier(cmd.soldier);
    if (!s) return { ok: false, reason: 'no such soldier of yours' };
    const saved = { ...s, inv: s.inv };
    const setup = this.#attackSetup(cmd);
    if ('error' in setup) return { ok: false, reason: setup.error };
    const { target, level, melee, thrown } = setup;
    const victim = whoIsThere(t, target, level);
    if (thrown && t.content.items.byIndex.get(s.attackingWeapon)?.cursor === ItemCursor.TOSS) {
      const throwEstimate = this.#estimateThrow(s, target, level, victim);
      Object.assign(s, {
        aimTime: saved.aimTime,
        attackingHand: saved.attackingHand,
        attackingWeapon: saved.attackingWeapon,
        targetLevel: saved.targetLevel,
      });
      return { ok: true, data: throwEstimate };
    }
    const apCost = calcTotalAPsToAttack(t, s, victim ? victim.gridNo : target, true, s.aimTime);
    const blade = t.content.items.byIndex.get(s.attackingWeapon)?.itemClass === ItemClass.BLADE;
    const chanceToHit =
      melee && victim
        ? meleeChanceToHit(t, s, victim, s.aimTime, blade)
        : calcChanceToHitGun(t, s, target, s.aimTime, s.aimShotLocation, false);
    const chanceToGetThrough = melee
      ? MELEE_CHANCE_TO_GET_THROUGH
      : victim
        ? soldierToSoldierBodyPartChanceToGetThrough(t, s, victim, s.aimShotLocation)
        : soldierToLocationChanceToGetThrough(t, s, target, level, 0, null);
    const reach = melee ? { inReach: meleeSpot(t, s, target, level) !== null } : {};
    Object.assign(s, {
      aimTime: saved.aimTime,
      aimShotLocation: saved.aimShotLocation,
      weaponMode: saved.weaponMode,
      doBurst: saved.doBurst,
      attackingHand: saved.attackingHand,
      attackingWeapon: saved.attackingWeapon,
      targetLevel: saved.targetLevel,
      targetCubeLevel: saved.targetCubeLevel,
      dontChargeReadyAPs: saved.dontChargeReadyAPs,
      ctgtTarget: saved.ctgtTarget,
    });
    return { ok: true, data: { apCost, actionPoints: s.actionPoints, chanceToHit, chanceToGetThrough, ...reach } };
  }

  #estimateThrow(s: Soldier, target: number, level: number, victim: Soldier | null): Record<string, unknown> {
    const t = this.state;
    const hand = s.inv[InvSlot.HAND] as ItemObject;
    const landing = calculateLaunchItemChanceToGetThrough(t, s, hand, target, level, level * HEIGHT_UNITS, true, true);
    return {
      apCost: minAPsToAttack(t, s, victim ? victim.gridNo : target, true),
      actionPoints: s.actionPoints,
      chanceToHit: landing.ok ? calcThrownChanceToHit(t, s, landing.gridNo, 0) : 0,
      pathClear: landing.ok,
      landsAt: landing.gridNo,
      maxRange: calcMaxTossRange(t, s, hand.item, true),
    };
  }

  #endTurn(): CommandResult {
    const t = this.state;
    if (!t.inCombat) return { ok: false, reason: 'not in turn-based combat' };
    if (t.turn.currentTeam !== Team.OUR) return { ok: false, reason: 'it is not your turn' };
    if (t.turn.attackBusyCount > 0) return { ok: false, reason: 'an attack is still resolving' };
    const busy = teamMembers(t, Team.OUR).find((x) => this.isBusy(x));
    if (busy) return { ok: false, reason: `soldier ${busy.id} is still acting` };
    endTurn(t, Team.OUR + 1);
    return { ok: true };
  }

  openDoors(): number[] {
    return [...this.state.doorStatus.entries()]
      .filter(([g]) => isDoorOpenAt(this.state, g))
      .map(([g]) => g)
      .sort((a, b) => a - b);
  }

  snapshot(filter: (s: Soldier) => boolean = () => true): SoldierSnapshot[] {
    return this.state.soldiers
      .filter((s) => s?.placed && filter(s))
      .map((s) => ({
        id: s.id,
        team: s.team,
        name: s.name,
        bodyType: s.bodyType,
        gridNo: s.gridNo,
        x: s.x,
        y: s.y,
        level: s.level,
        direction: s.direction,
        animation: s.state,
        frame: s.frame,
        palettes: [s.palettes.hair, s.palettes.skin, s.palettes.vest, s.palettes.pants] as const,
        hand: handClass(this.state.content.items, itemIn(s.inv, InvSlot.HAND)),
        ...(s.team === Team.OUR ? { ap: s.actionPoints, life: s.life, lifeMax: s.lifeMax, breath: s.breath } : {}),
      }));
  }

  combatView(): CombatSnapshot | null {
    const t = this.state;
    return t.inCombat ? { team: t.turn.currentTeam, round: t.turn.round, interrupt: this.interruptOpen() } : null;
  }
}
