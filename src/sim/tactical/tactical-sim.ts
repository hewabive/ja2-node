import { AnimFlags } from '../../content/anim/tables.ts';
import { handClass } from '../../content/items/items.ts';
import { isVisibleTile } from '../../content/world/grid.ts';
import type { TacticalWorld } from '../../content/world/tactical-world.ts';
import { Rng } from '../../core/rng.ts';
import type { CommandResult } from '../command.ts';
import type { SimEvent } from '../events.ts';
import {
  type AiControl,
  aiForSlot,
  applyDesiredDirectionEvents,
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
import type { TacticalContent } from './content.ts';
import { isDoorOpenAt } from './doors.ts';
import { InvSlot, itemIn } from './inventory.ts';
import { directionToward, getNewSoldierPath, stopMerc } from './movement.ts';
import { executeOverhead, type OverheadHooks } from './overhead.ts';
import { findBestPath, PathCopy } from './pathfinding.ts';
import { mostImportantNoiseHeard } from './perception/knowledge.ts';
import { allTeamsLookForAll } from './perception/sight.ts';
import { perceptionHooks, sightHooks } from './perception/wiring.ts';
import { apsToChangeStance, apsToLook, enoughPoints, ptsToMoveDirection } from './points.ts';
import { OKLIFE, type Soldier, Team } from './soldier.ts';
import { createTacticalState, type TacticalState, teamMembers } from './state.ts';
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
      minAPsToAttack: () => 0,
    };
    const clock = this.#clock;
    this.hooks = {
      beforePass: (state) => {
        handleRealtimeTurns(state, clock);
        handleEnemySightingPause(state);
        beginAiPass(state, ai);
      },
      ai: (state, s, slot) => aiForSlot(state, s, slot, ai),
      afterPass: applyDesiredDirectionEvents,
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
    if (t.inCombat && (t.turn.currentTeam !== Team.OUR || t.turn.attackBusyCount > 0)) return false;
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
