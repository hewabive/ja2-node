import { AnimFlags } from '../../content/anim/tables.ts';
import { handClass, ItemClass } from '../../content/items/items.ts';
import { isVisibleTile } from '../../content/world/grid.ts';
import type { TacticalWorld } from '../../content/world/tactical-world.ts';
import { Rng } from '../../core/rng.ts';
import type { CommandResult } from '../command.ts';
import type { SimEvent } from '../events.ts';
import { AiAction } from './ai/actions.ts';
import {
  type AiControl,
  actionDone,
  aiForSlot,
  beginAiPass,
  cancelAIAction,
  createAiControl,
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
import { calcTotalAPsToAttack, minAPsToAttack } from './combat/ap.ts';
import { attackOpcode, handleGunAttack, ItemHandle } from './combat/attack.ts';
import {
  soldierToLocationChanceToGetThrough,
  soldierToSoldierBodyPartChanceToGetThrough,
  updateBullets,
  updateMissAnimations,
} from './combat/bullets.ts';
import { calcChanceToHitGun } from './combat/chance.ts';
import { deathOpcode, updateSkullReleases } from './combat/death.ts';
import { soldierCollapse } from './combat/hit.ts';
import { AimShot, WeaponMode } from './combat/types.ts';
import type { TacticalContent } from './content.ts';
import { isDoorOpenAt } from './doors.ts';
import { dequeueAllGameEvents } from './game-events.ts';
import { InvSlot, itemIn } from './inventory.ts';
import { directionToward, getNewSoldierPath, stopMerc } from './movement.ts';
import { executeOverhead, type OverheadHooks } from './overhead.ts';
import { findBestPath, PathCopy } from './pathfinding.ts';
import { mostImportantNoiseHeard } from './perception/knowledge.ts';
import { allTeamsLookForAll } from './perception/sight.ts';
import { perceptionHooks, sightHooks } from './perception/wiring.ts';
import { apsToChangeStance, apsToLook, enoughPoints, ptsToMoveDirection } from './points.ts';
import { OKLIFE, type Soldier, Team } from './soldier.ts';
import { createTacticalState, type TacticalState, teamMembers, whoIsThere } from './state.ts';
import { endTurn, handleEnemySightingPause, handleRealtimeTurns, type RealtimeClock, selectSoldier } from './turns/turns.ts';

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
};

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
      opcode: (state, s, code) => attackOpcode(state, s, code) ?? deathOpcode(state, s, code),
      turnFinished: freeUpFromTurning,
      stanceChanged: freeUpFromStanceChange,
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
    };
    const clock = this.#clock;
    this.hooks = {
      beforePass: (state) => {
        updateBullets(state);
        updateMissAnimations(state);
        updateSkullReleases(state);
        handleRealtimeTurns(state, clock);
        handleEnemySightingPause(state);
        beginAiPass(state, ai);
      },
      ai: (state, s, slot) => aiForSlot(state, s, slot, ai),
      afterPass: dequeueAllGameEvents,
    };
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
      hasAnimFlag(content, s.state, AnimFlags.STANCECHANGEANIM) ||
      s.desiredDirection !== s.direction ||
      s.inNonInterruptibleAnimation ||
      s.delayedMovement !== 0 ||
      s.pendingAnimation !== -1 ||
      s.continueMoveAfterStanceChange !== 0
    );
  }

  isIdle(): boolean {
    const t = this.state;
    if (t.turn.attackBusyCount > 0 || t.bullets.length > 0 || t.gameEvents.length > 0) return false;
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

  #attackSetup(cmd: TacticalCommand): { s: Soldier; target: number; level: number } | { error: string } {
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
    if (!def || def.itemClass !== ItemClass.GUN) return { error: 'soldier has no gun in hand' };
    if (cmd.burst === true && !(def.weapon?.shotsPerBurst ?? 0)) return { error: 'this gun cannot fire bursts' };
    const victim = whoIsThere(t, target, level);
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
    return { s, target, level };
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
    const { s, target, level } = setup;
    if (target === s.gridNo) return { ok: false, reason: 'cannot shoot at own tile' };
    if (s.noAPToFinishMove) soldierGotoStationaryStance(t, s);
    const result = handleGunAttack(t, s, target, level, s.attackingWeapon);
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
    const { target, level } = setup;
    const victim = whoIsThere(t, target, level);
    const apCost = calcTotalAPsToAttack(t, s, victim ? victim.gridNo : target, true, s.aimTime);
    const chanceToHit = calcChanceToHitGun(t, s, target, s.aimTime, s.aimShotLocation, false);
    const chanceToGetThrough = victim
      ? soldierToSoldierBodyPartChanceToGetThrough(t, s, victim, s.aimShotLocation)
      : soldierToLocationChanceToGetThrough(t, s, target, level, 0, null);
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
    return { ok: true, data: { apCost, actionPoints: s.actionPoints, chanceToHit, chanceToGetThrough } };
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
