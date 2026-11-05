// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-04. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc HandleGotoNewGridNo (the FORGETFUL merc who forgets where he was going)

import { u8 } from '../../core/int.ts';
import { unSetUIBusy } from './combat/barrier.ts';
import { loseSomeActionPoints } from './falls.ts';
import { stopMerc } from './movement.ts';
import { MercQuote } from './narrative/merc-quotes.ts';
import { hasPersonality } from './skills.ts';
import { Personality, type Soldier, Team } from './soldier.ts';
import type { TacticalState } from './state.ts';

const TILE_COUNT_CAP = 255;
const STEPS_BEFORE_FORGETTING = 2;
const FORGET_ONE_IN = 100;
const TILES_BETWEEN_FORGETTING = 200;

function forgetfulMerc(s: Soldier): boolean {
  return s.team === Team.OUR && hasPersonality(s, Personality.FORGETFUL);
}

function countTileMoved(s: Soldier): void {
  if (s.tilesMovedSinceLastForget < TILE_COUNT_CAP) s.tilesMovedSinceLastForget = u8(s.tilesMovedSinceLastForget + 1);
}

function forgetRolled(t: TacticalState, s: Soldier): boolean {
  return s.pathIndex > STEPS_BEFORE_FORGETTING && t.rng.int(FORGET_ONE_IN) === 0 && s.tilesMovedSinceLastForget > TILES_BETWEEN_FORGETTING;
}

export function forgetsTheWay(t: TacticalState, s: Soldier): boolean {
  if (s.pathIndex <= 0 || !forgetfulMerc(s)) return false;
  countTileMoved(s);
  if (!forgetRolled(t, s)) return false;
  s.tilesMovedSinceLastForget = 0;
  t.narrative.sayQuote(s, MercQuote.PERSONALITY_TRAIT);
  stopMerc(t, s);
  loseSomeActionPoints(t, s);
  unSetUIBusy(t, s);
  return true;
}
