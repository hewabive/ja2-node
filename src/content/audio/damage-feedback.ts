// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-09. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc HandleTakeDamageDeath (the DIE1 of a seen soldier hurt by gas or electricity),
// @src HandleSoldierTakeDamageFeedback (the HIT1 grunt, at most once a second by uiTimeSinceLastBleedGrunt);
// @src src/game/TileEngine/Explosion_Control.cc DishOutGasDamage (the HIT1 of a soldier gas leaves conscious).

import type { BattleSoundName } from './battle-sound.ts';

export const BLEED_GRUNT_GAP_MS = 1000;

const BLEEDING = 'bleeding';

export interface DamageFeedbackFacts {
  readonly cause: string;
  readonly seen: boolean;
  readonly conscious: boolean;
}

export class BleedGrunts {
  readonly #lastAtMs = new Map<number, number>();

  due(soldier: number, nowMs: number): boolean {
    const last = this.#lastAtMs.get(soldier);
    if (last !== undefined && nowMs - last <= BLEED_GRUNT_GAP_MS) return false;
    this.#lastAtMs.set(soldier, nowMs);
    return true;
  }
}

export function damageFeedbackSounds(facts: DamageFeedbackFacts, gruntDue: boolean): BattleSoundName[] {
  const sounds: BattleSoundName[] = [];
  if (facts.seen && facts.cause !== BLEEDING) sounds.push('DIE1');
  if (gruntDue) sounds.push('HIT1');
  if (facts.conscious) sounds.push('HIT1');
  return sounds;
}
