import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Orientation } from '../../../content/formats/jsd.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { StructureFlags } from '../../../content/world/structures.ts';
import { syntheticStructure } from '../../../content/world/synthetic.ts';
import { snapshotJson, snapshotTactical } from '../../snapshot/session.ts';
import { states } from '../animation.ts';
import type { TacticalContent } from '../content.ts';
import { SmokeTile, setSmokeFlagsAt } from '../explosions/smoke.ts';
import { TEAM_FIRST_ID, Team } from '../soldier.ts';
import { Caller, manLooksForMan, Opp } from './sight.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const VIEWER_AT = gridNo(80, 80);
const TARGET_AT = gridNo(80, 90);
const MIDWAY = gridNo(80, 85);
const SMOKED = [gridNo(80, 84), gridNo(80, 85), gridNo(80, 86)];

function lookout() {
  const sim = newCombatSim(content);
  const viewer = spawnSoldier(sim, 0, Team.OUR, VIEWER_AT, Direction.SOUTH);
  const target = spawnSoldier(sim, TEAM_FIRST_ID[Team.ENEMY], Team.ENEMY, TARGET_AT, Direction.NORTH);
  const t = sim.state;
  const looks = () => manLooksForMan(t, viewer, target, Caller.UNKNOWN);
  return { sim, t, viewer, target, looks };
}

describe('the line of sight a look remembers (derived cache, never in the snapshot)', () => {
  it('sees the change of a structure on the ray at the next look: a wall raised and taken down again', () => {
    const { t, viewer, target, looks } = lookout();
    expect([looks(), looks()]).toEqual([true, true]);
    const wall = t.world.structures.add(MIDWAY, 0, syntheticStructure(StructureFlags.WALL, Orientation.OUTSIDE_RIGHT));
    expect(wall).not.toBeNull();
    expect(looks()).toBe(false);
    expect(viewer.oppList[target.id]).toBe(Opp.SEEN_THIS_TURN);
    if (wall) t.world.structures.remove(wall);
    expect(looks()).toBe(true);
  });

  it('sees smoke drifting onto the ray at the next look, and its clearing', () => {
    const { t, looks } = lookout();
    expect([looks(), looks()]).toEqual([true, true]);
    for (const g of SMOKED) setSmokeFlagsAt(t, g, 0, SmokeTile.SMOKE);
    expect(looks()).toBe(false);
    for (const g of SMOKED) setSmokeFlagsAt(t, g, 0, 0);
    expect(looks()).toBe(true);
  });

  it('sees both soldiers crouching behind a waist-high obstacle at the next look', () => {
    const { t, viewer, target, looks } = lookout();
    t.world.structures.add(MIDWAY, 0, syntheticStructure(StructureFlags.GENERIC, Orientation.NONE, { height: 2 }));
    expect([looks(), looks()]).toEqual([true, true]);
    viewer.state = states(content.animations).CROUCHING;
    target.state = states(content.animations).CROUCHING;
    expect(looks()).toBe(false);
  });

  it('leaves no trace of the memo in a snapshot', () => {
    const { sim, looks } = lookout();
    looks();
    expect(snapshotJson(snapshotTactical(sim, { content }))).not.toContain('sightMemo');
  });
});
