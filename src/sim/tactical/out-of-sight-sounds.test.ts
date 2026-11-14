import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { OUT_OF_SIGHT_SOUND_CODES } from '../../content/anim/out-of-sight-sounds.ts';
import { isSimulationOpcode } from '../../content/anim/timelines.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import type { TacticalContent } from './content.ts';
import { type Soldier, Team } from './soldier.ts';
import { shownInSector } from './state.ts';
import type { TacticalSim } from './tactical-sim.ts';
import { heardAsAScream } from './unseen-sources.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const LISTENER_AT = gridNo(80, 80);
const BEHIND_HIM = gridNo(80, 84);
const IN_FRONT = gridNo(80, 76);
const FAR_OFF = gridNo(80, 150);
const SOUNDS = Object.entries(OUT_OF_SIGHT_SOUND_CODES);

function soundsOf(sim: TacticalSim, s: Soldier) {
  const t = sim.state;
  sim.drainEvents();
  for (const [, code] of SOUNDS) expect(t.hooks.opcode(t, s, code)).toBe('continue');
  return sim.drainEvents().map(({ tick: _tick, ...e }) => e);
}

function sceneWithEnemyAt(at: number): { sim: TacticalSim; enemy: Soldier } {
  const sim = newCombatSim(content);
  spawnSoldier(sim, 0, Team.OUR, LISTENER_AT, Direction.NORTH);
  const enemy = spawnSoldier(sim, 20, Team.ENEMY, at, Direction.SOUTH);
  sim.lookAround();
  return { sim, enemy };
}

describe('animation sounds of a soldier out of sight (Soldier_Ani.cc 702, 709, 721, 722, 781, 782, 784)', () => {
  it('keeps the codes in the logic timeline, so an animation tells them as it passes them', () => {
    expect(SOUNDS.map(([, code]) => isSimulationOpcode(code))).toEqual(SOUNDS.map(() => true));
  });

  it('tells each one with no soldier and no tile, heard as loud as his loudest scream, as the squad hears his cries', () => {
    const { sim, enemy } = sceneWithEnemyAt(BEHIND_HIM);
    expect(shownInSector(sim.state, enemy)).toBe(false);
    const heard = heardAsAScream(sim.state, enemy).heard;
    expect(heard?.by).toBe(0);
    expect(soundsOf(sim, enemy)).toEqual(SOUNDS.map(([sound]) => ({ type: 'unseenAnimationSound', sound, heard })));
  });

  it('tells them without heard when nobody of ours is near enough to hear', () => {
    const { sim, enemy } = sceneWithEnemyAt(FAR_OFF);
    expect(soundsOf(sim, enemy)).toEqual(SOUNDS.map(([sound]) => ({ type: 'unseenAnimationSound', sound })));
  });

  it('tells nothing of a soldier in sight, whose animation plays them', () => {
    const { sim, enemy } = sceneWithEnemyAt(IN_FRONT);
    expect(shownInSector(sim.state, enemy)).toBe(true);
    expect(soundsOf(sim, enemy)).toEqual([]);
  });
});
