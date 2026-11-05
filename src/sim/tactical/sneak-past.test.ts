import { beforeAll, describe, expect, it } from 'vitest';
import { progressFor } from '../../../tests/support/autoresolve.ts';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { DIRECTION_INCREMENT, Direction, gridNo } from '../../content/world/grid.ts';
import { ScriptedStream } from '../strategic/forces/autoresolve/replay-rng.ts';
import type { TacticalContent } from './content.ts';
import { setSoldierPosition } from './movement.ts';
import { Opp } from './perception/opp.ts';
import { Body, type Soldier, Team } from './soldier.ts';
import type { TacticalSim } from './tactical-sim.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const MERC_AT = gridNo(80, 80);
const EAST = DIRECTION_INCREMENT[Direction.EAST] ?? 0;
const MERC_PROFILE = 5;
const STAT_DIE = 100;
const SNEAK_CHANCES = 5;
const NEAR = 5;
const BEYOND_SIGHT = 60;

interface Sneak {
  readonly sim: TacticalSim;
  readonly merc: Soldier;
  readonly pre: ScriptedStream;
}

function sneaker(): Sneak {
  const sim = newCombatSim(content);
  const merc = spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.EAST, { profile: MERC_PROFILE });
  sim.state.profiles.set(MERC_PROFILE, progressFor(MERC_PROFILE));
  merc.stealthMode = true;
  const pre = new ScriptedStream([], STAT_DIE - 1);
  Object.assign(sim.state, { pre });
  return { sim, merc, pre };
}

function unawareEnemy(w: Sneak, id: number, tilesAway: number, body: number = Body.REGMALE): Soldier {
  const enemy = spawnSoldier(w.sim, id, Team.ENEMY, MERC_AT + tilesAway * EAST, Direction.WEST, { body });
  w.merc.oppList[enemy.id] = Opp.SEEN_CURRENTLY;
  w.merc.ai.oppCount++;
  return enemy;
}

function stepAndCountChances(w: Sneak): number {
  setSoldierPosition(w.sim.state, w.merc, MERC_AT + EAST);
  return w.pre.requested.filter((n) => n === STAT_DIE).length;
}

describe('sneaking past an enemy (Soldier_Control.cc SetSoldierGridNo)', () => {
  it('gives our sneaking merc five agility chances on each new tile for every enemy he sees who could see him there but does not', () => {
    const w = sneaker();
    unawareEnemy(w, 20, NEAR);
    unawareEnemy(w, 21, NEAR + 1);
    expect(stepAndCountChances(w)).toBe(2 * SNEAK_CHANCES);
  });

  it('gives nothing past an enemy who sees him, one too far to see him, a cow or a neutral, or to a merc who does not sneak', () => {
    const watched = sneaker();
    unawareEnemy(watched, 20, NEAR).oppList[0] = Opp.SEEN_CURRENTLY;
    expect(stepAndCountChances(watched)).toBe(0);
    const far = sneaker();
    unawareEnemy(far, 20, BEYOND_SIGHT);
    expect(stepAndCountChances(far)).toBe(0);
    const cow = sneaker();
    unawareEnemy(cow, 20, NEAR, Body.COW);
    expect(stepAndCountChances(cow)).toBe(0);
    const neutral = sneaker();
    unawareEnemy(neutral, 20, NEAR).neutral = true;
    expect(stepAndCountChances(neutral)).toBe(0);
    const walking = sneaker();
    unawareEnemy(walking, 20, NEAR);
    walking.merc.stealthMode = false;
    expect(stepAndCountChances(walking)).toBe(0);
  });
});
