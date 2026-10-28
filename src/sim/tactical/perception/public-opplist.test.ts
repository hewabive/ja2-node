import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import type { TacticalContent } from '../content.ts';
import { NOWHERE, type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { NUM_WATCHED_LOCS } from '../turns/turn-state.ts';
import { Opp } from './opp.ts';
import { decayPublicOpplist } from './sight.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const WATCHED_SPOT = gridNo(100, 100);
const QUIET_SPOT = gridNo(90, 100);
const UNUSED_ENEMY_SLOT = 31;

interface Scene {
  readonly t: TacticalState;
  readonly merc: Soldier;
  readonly enemy: Soldier;
}

function scene(): Scene {
  const sim = newCombatSim(content);
  const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(60, 60), Direction.NORTH);
  const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(110, 110), Direction.SOUTH);
  return { t: sim.state, merc, enemy };
}

function knowPublicly(t: TacticalState, opp: Soldier, value: number): void {
  const table = t.perception.publicOpp[Team.ENEMY];
  if (table) table[opp.id] = value;
}

function watch(t: TacticalState, id: number, points: number, spot = WATCHED_SPOT): number {
  const at = id * NUM_WATCHED_LOCS;
  const w = t.turn.watched;
  w.gridNo[at] = spot;
  w.level[at] = 0;
  w.points[at] = points;
  w.reset[at] = 0;
  return at;
}

function watchedLoc(t: TacticalState, at: number): [number, number, number] {
  const w = t.turn.watched;
  return [w.gridNo[at] ?? NOWHERE, w.points[at] ?? 0, w.reset[at] ?? 0];
}

describe('the public opplist decay', () => {
  it('forgets the last radio caller once the team knows no opponent publicly', () => {
    const { t, merc, enemy } = scene();
    t.perception.lastMercToRadio[Team.ENEMY] = enemy;
    knowPublicly(t, merc, Opp.SEEN_3_TURNS_AGO);
    decayPublicOpplist(t, Team.ENEMY);
    expect(t.perception.publicOpp[Team.ENEMY]?.[merc.id]).toBe(Opp.NOT_HEARD_OR_SEEN);
    expect(t.perception.lastMercToRadio[Team.ENEMY]).toBe(enemy);
    decayPublicOpplist(t, Team.ENEMY);
    expect(t.perception.lastMercToRadio[Team.ENEMY]).toBeNull();
  });

  it('keeps what it knows of the dead and of its own team', () => {
    const { t, merc, enemy } = scene();
    t.perception.lastMercToRadio[Team.ENEMY] = enemy;
    merc.life = 0;
    knowPublicly(t, merc, Opp.SEEN_THIS_TURN);
    knowPublicly(t, enemy, Opp.SEEN_THIS_TURN);
    decayPublicOpplist(t, Team.ENEMY);
    expect([t.perception.publicOpp[Team.ENEMY]?.[merc.id], t.perception.publicOpp[Team.ENEMY]?.[enemy.id]]).toEqual([
      Opp.SEEN_THIS_TURN,
      Opp.SEEN_THIS_TURN,
    ]);
    expect(t.perception.lastMercToRadio[Team.ENEMY]).toBeNull();
  });

  it('arms a watched location, then halves its points on the next decay and drops it at zero', () => {
    const { t, enemy } = scene();
    const at = watch(t, enemy.id, 3);
    const history = [1, 2, 3, 4].map(() => {
      decayPublicOpplist(t, Team.ENEMY);
      return watchedLoc(t, at);
    });
    expect(history).toEqual([
      [WATCHED_SPOT, 3, 1],
      [WATCHED_SPOT, 1, 0],
      [WATCHED_SPOT, 1, 1],
      [NOWHERE, 0, 0],
    ]);
  });

  it('keeps a location an opponent stands next to and decays the slots of absent team members too', () => {
    const { t, merc, enemy } = scene();
    const occupied = watch(t, enemy.id, 2);
    const absent = watch(t, UNUSED_ENEMY_SLOT, 2, QUIET_SPOT);
    expect(t.soldiers[UNUSED_ENEMY_SLOT]).toBeUndefined();
    t.occupant[0][WATCHED_SPOT + 1] = merc.id;
    decayPublicOpplist(t, Team.ENEMY);
    decayPublicOpplist(t, Team.ENEMY);
    t.occupant[0][WATCHED_SPOT + 1] = -1;
    expect(watchedLoc(t, occupied)).toEqual([WATCHED_SPOT, 2, 0]);
    expect(watchedLoc(t, absent)).toEqual([QUIET_SPOT, 1, 0]);
  });
});
