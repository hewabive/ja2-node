import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSoldier } from '../../../tests/support/combat.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import { isSimulationOpcode } from '../../content/anim/timelines.ts';
import { gridNo } from '../../content/world/grid.ts';
import { snapshotJson, snapshotTactical } from '../snapshot/session.ts';
import { Team } from './soldier.ts';
import { TacticalSim } from './tactical-sim.ts';

const VILLAGE = 'stubs/world/maps/village.dat';
const FIRST_SOUND_RANGE_CODE = 700;
const LAST_SOUND_RANGE_CODE = 799;
const SLOW_MS = 60_000;
const SIMULATION_CODES_IN_SOUND_RANGE = 7;

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
}, SLOW_MS);

afterAll(async () => {
  await kit.dispose();
});

describe('the opcodes the logic timeline leaves out', () => {
  it(
    'are the sound-range codes no simulation handler acts on',
    () => {
      const sim = new TacticalSim(kit.world(VILLAGE), kit.content, 7);
      const soldier = spawnSoldier(sim, 0, Team.OUR, gridNo(106, 66), 0);
      const state = () => snapshotJson(snapshotTactical(sim, { content: sim.state.content }));
      const dropped: number[] = [];
      for (let code = FIRST_SOUND_RANGE_CODE; code <= LAST_SOUND_RANGE_CODE; code++) {
        if (isSimulationOpcode(code)) continue;
        const before = state();
        expect(sim.state.hooks.opcode(sim.state, soldier, code)).toBeNull();
        expect(state()).toBe(before);
        dropped.push(code);
      }
      expect(dropped).toHaveLength(LAST_SOUND_RANGE_CODE - FIRST_SOUND_RANGE_CODE + 1 - SIMULATION_CODES_IN_SOUND_RANGE);
    },
    SLOW_MS,
  );
});
