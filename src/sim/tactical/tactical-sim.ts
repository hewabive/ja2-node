import { AnimFlags } from '../../content/anim/tables.ts';
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
  createAiControl,
  freeUpFromStanceChange,
  freeUpFromTurning,
} from './ai/control.ts';
import { hasAnimFlag, states } from './animation.ts';
import type { TacticalContent } from './content.ts';
import { isDoorOpenAt } from './doors.ts';
import { getNewSoldierPath, stopMerc } from './movement.ts';
import { executeOverhead, type OverheadHooks } from './overhead.ts';
import { type Soldier, Team } from './soldier.ts';
import { createTacticalState, type TacticalState } from './state.ts';

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

  constructor(world: TacticalWorld, content: TacticalContent, seed: number) {
    this.world = world;
    this.mapPath = world.mapPath;
    this.state = createTacticalState(
      { ...world, mapDoors: new Map(world.map.doors.map((d) => [d.gridNo, d])) },
      content,
      Rng.fromSeed(seed),
    );
    this.ai = createAiControl();
    const ai = this.ai;
    this.state.hooks = { ...this.state.hooks, turnFinished: freeUpFromTurning, stanceChanged: freeUpFromStanceChange };
    this.hooks = {
      beforePass: (t) => beginAiPass(t, ai),
      ai: (t, s, slot) => aiForSlot(t, s, slot, ai),
      afterPass: applyDesiredDirectionEvents,
    };
  }

  get tick(): number {
    return this.#tick;
  }

  isBusy(s: Soldier): boolean {
    return (
      !hasAnimFlag(this.state.content, s.state, AnimFlags.STATIONARY) ||
      s.inNonInterruptibleAnimation ||
      s.delayedMovement !== 0 ||
      s.pendingAnimation !== -1 ||
      s.continueMoveAfterStanceChange !== 0
    );
  }

  isIdle(): boolean {
    return !this.state.soldiers.some((s) => s.placed && s.team === Team.OUR && this.isBusy(s));
  }

  hasPendingDecision(): boolean {
    return false;
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

  #move(cmd: TacticalCommand): CommandResult {
    const s = this.soldier(cmd.soldier);
    if (!s?.placed || s.team !== Team.OUR) return { ok: false, reason: 'no such soldier of yours' };
    const to = cmd.to;
    if (typeof to !== 'number' || !Number.isInteger(to) || !isVisibleTile(to))
      return { ok: false, reason: 'destination must be a visible gridNo' };
    const st = states(this.state.content.animations);
    s.uiMovementMode = cmd.mode === 'run' ? st.RUNNING : st.WALKING;
    s.pathStored = false;
    if (!getNewSoldierPath(this.state, s, to, s.uiMovementMode, 1, s.noAPToFinishMove)) return { ok: false, reason: 'no path' };
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
        hand: s.hand,
      }));
  }
}
