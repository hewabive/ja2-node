// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/Utils/Event_Pump.cc AddGameEvent, DequeAllGameEvents, ExecuteGameEvent (primary and secondary queue).
// @src See docs/11 §1.2, §6.1.

import { setDesiredDirection } from './animation.ts';
import { eventFireSoldierWeapon, fireWeapon } from './combat/attack.ts';
import { reduceAttackBusyCount } from './combat/barrier.ts';
import { weaponHit } from './combat/hit.ts';
import type { TacticalState } from './state.ts';

export interface WeaponHitEvent {
  readonly kind: 'weaponHit';
  readonly soldier: number;
  readonly attacker: number;
  readonly weapon: number;
  readonly damage: number;
  readonly breathLoss: number;
  readonly direction: number;
  readonly range: number;
  readonly special: number;
  readonly delay: number;
  readonly stamp?: number;
}

export type GameEvent =
  | { readonly kind: 'desiredDirection'; readonly soldier: number; readonly direction: number }
  | {
      readonly kind: 'beginFireWeapon';
      readonly soldier: number;
      readonly target: number;
      readonly level: number;
      readonly cubeLevel: number;
    }
  | { readonly kind: 'fireWeapon'; readonly soldier: number; readonly target: number; readonly level: number; readonly cubeLevel: number }
  | WeaponHitEvent;

function executeWeaponHit(t: TacticalState, e: WeaponHitEvent): void {
  const attacker = t.soldiers[e.attacker];
  const target = t.soldiers[e.soldier];
  if (!attacker) return;
  if (!target?.placed) {
    reduceAttackBusyCount(t, attacker, false);
    return;
  }
  weaponHit(t, target, e.weapon, e.damage, e.breathLoss, e.direction, e.range, attacker, e.special, target.aimShotLocation);
}

function executeDueEvents(t: TacticalState, waiting: readonly WeaponHitEvent[]): void {
  const due = waiting.filter((e) => t.clockMs - (e.stamp ?? t.clockMs) > e.delay);
  for (const e of waiting) if (!due.includes(e)) t.gameEvents.push(e);
  for (const e of due) executeWeaponHit(t, e);
}

export function dequeueAllGameEvents(t: TacticalState): void {
  const waiting: WeaponHitEvent[] = [];
  for (let e = t.gameEvents.shift(); e; e = t.gameEvents.shift()) {
    if (e.kind === 'weaponHit') {
      waiting.push(e.stamp === undefined ? { ...e, stamp: t.clockMs } : e);
      continue;
    }
    const s = t.soldiers[e.soldier];
    if (!s?.placed) continue;
    switch (e.kind) {
      case 'desiredDirection':
        setDesiredDirection(t, s, e.direction);
        break;
      case 'beginFireWeapon':
        s.targetGridNo = e.target;
        s.targetLevel = e.level;
        s.targetCubeLevel = e.cubeLevel;
        eventFireSoldierWeapon(t, s, e.target);
        break;
      case 'fireWeapon':
        s.targetGridNo = e.target;
        s.targetLevel = e.level;
        s.targetCubeLevel = e.cubeLevel;
        fireWeapon(t, s, e.target);
        break;
    }
  }
  executeDueEvents(t, waiting);
}
