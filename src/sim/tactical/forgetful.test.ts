import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { DIRECTION_INCREMENT, Direction, gridNo } from '../../content/world/grid.ts';
import { states } from './animation.ts';
import type { TacticalContent } from './content.ts';
import { getNewSoldierPath } from './movement.ts';
import { MercQuote } from './narrative/merc-quotes.ts';
import { Personality, type Soldier, Team } from './soldier.ts';
import type { TacticalSim } from './tactical-sim.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const ORIGIN = gridNo(80, 80);
const EAST = DIRECTION_INCREMENT[Direction.EAST] ?? 0;
const FORGET_DIE = 100;
const MERC_PROFILE = 5;
const TILES_BETWEEN_FORGETTING = 200;

interface Walker {
  readonly sim: TacticalSim;
  readonly s: Soldier;
  readonly forgetRolls: number[];
  readonly rolled: number[];
  readonly draws: { readonly range: number; readonly value: number }[];
  readonly said: number[];
}

function walker(options: { trait?: number; team?: number; tilesSinceForgetting?: number } = {}): Walker {
  const sim = newCombatSim(content);
  sim.state.inCombat = true;
  const s = spawnSoldier(sim, 0, options.team ?? Team.OUR, ORIGIN, Direction.EAST, { profile: MERC_PROFILE });
  s.personalityTrait = options.trait ?? Personality.FORGETFUL;
  s.tilesMovedSinceLastForget = options.tilesSinceForgetting ?? 0;
  const forgetRolls: number[] = [];
  const rolled: number[] = [];
  const draws: { range: number; value: number }[] = [];
  const said: number[] = [];
  sim.state.narrative = { ...sim.state.narrative, sayQuote: (_, quote) => said.push(quote) };
  const rng = sim.state.rng as unknown as { int(n: number): number };
  const real = rng.int.bind(rng);
  rng.int = (n: number) => {
    const value = n === FORGET_DIE ? (forgetRolls.shift() ?? 1) : real(n);
    if (n === FORGET_DIE) rolled.push(value);
    draws.push({ range: n, value });
    return value;
  };
  return { sim, s, forgetRolls, rolled, draws, said };
}

function go(w: Walker, tiles: number): void {
  const to = w.s.gridNo + tiles * EAST;
  if (w.s.team === Team.OUR) expect(w.sim.dispatch({ type: 'move', soldier: w.s.id, to, mode: 'walk' }).ok).toBe(true);
  else expect(getNewSoldierPath(w.sim.state, w.s, to, states(content.animations).WALKING)).toBe(true);
  runUntilIdle(w.sim);
}

describe('the FORGETFUL merc on the way (Overhead.cc HandleGotoNewGridNo, after the falls)', () => {
  it('stops our forgetful merc on a step after the second once he walked more than 200 tiles since he last forgot: his personality quote, Random(AP) + 1 APs lost, the count back at 0', () => {
    const w = walker({ tilesSinceForgetting: TILES_BETWEEN_FORGETTING });
    w.forgetRolls.push(0);
    go(w, 6);
    expect([w.s.gridNo, w.said, w.s.tilesMovedSinceLastForget]).toEqual([ORIGIN + 3 * EAST, [MercQuote.PERSONALITY_TRAIT], 0]);
    const lost = w.draws[w.draws.findIndex((d) => d.range === FORGET_DIE) + 1];
    expect(w.s.actionPoints).toBe((lost?.range ?? 0) - ((lost?.value ?? 0) + 1));
  });

  it('rolls Random(100) on every step from the third, whatever the count, and forgets nothing while the count is 200 or below', () => {
    const w = walker();
    w.forgetRolls.push(0, 0, 0);
    go(w, 6);
    expect([w.s.gridNo, w.rolled, w.said, w.s.tilesMovedSinceLastForget]).toEqual([ORIGIN + 6 * EAST, [0, 0, 0], [], 5]);
  });

  it('counts the steps of a move from the second: a merc moved one tile at a time never forgets', () => {
    const w = walker({ tilesSinceForgetting: TILES_BETWEEN_FORGETTING });
    for (let k = 0; k < 4; k++) go(w, 1);
    expect([w.s.gridNo, w.rolled, w.s.tilesMovedSinceLastForget]).toEqual([ORIGIN + 4 * EAST, [], TILES_BETWEEN_FORGETTING]);
  });

  it('caps the count at 255 and leaves anyone but our forgetful mercs alone', () => {
    const capped = walker({ tilesSinceForgetting: 254 });
    go(capped, 3);
    expect(capped.s.tilesMovedSinceLastForget).toBe(255);
    for (const w of [walker({ trait: Personality.NERVOUS }), walker({ team: Team.ENEMY })]) {
      w.forgetRolls.push(0, 0, 0);
      w.s.tilesMovedSinceLastForget = TILES_BETWEEN_FORGETTING;
      go(w, 6);
      expect([w.rolled, w.s.tilesMovedSinceLastForget]).toEqual([[], TILES_BETWEEN_FORGETTING]);
    }
  });
});
