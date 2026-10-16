import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { applyMapChanges, MapChangeKind } from '../map-changes.ts';
import { RevealedFlags } from '../perception/fov.ts';
import { exitGridAt } from '../sector-exit.ts';
import { Team } from '../soldier.ts';
import { TacticalSim } from '../tactical-sim.ts';
import { statueTakesExplosion, useStatueRemote } from './statue.ts';

const VILLAGE = 'stubs/world/maps/village.dat';
const O3 = { x: 3, y: 15, z: 0 };
const STATUE = 13830;
const STATUE_EXIT = 13669;
const STATUE_ROOM = 4;

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

function inO3(): TacticalSim {
  const sim = new TacticalSim(kit.world(VILLAGE), kit.content, 7);
  sim.state.sector = { ...O3 };
  return sim;
}

describe('the O3 statue (docs/26 §5.3)', () => {
  it('opens to the basement when an explosion hits it from at most one tile away, once', () => {
    const sim = inO3();
    const t = sim.state;
    expect(statueTakesExplosion(t, STATUE, 2)).toBe(false);
    expect(exitGridAt(t, STATUE_EXIT)).toBeNull();
    expect(statueTakesExplosion(t, STATUE, 1)).toBe(true);
    expect(exitGridAt(t, STATUE_EXIT)).toEqual({ gridNo: 13037, sector: { x: 3, y: 15, z: 1 } });
    expect((t.fog.revealed[STATUE_EXIT] ?? 0) & RevealedFlags.GROUND).toBe(RevealedFlags.GROUND);
    expect(t.events).toContainEqual({ type: 'statueOpened', sector: 'O3', destroyed: true });
    expect(statueTakesExplosion(t, 13829, 0)).toBe(false);
    const restored = new TacticalSim(kit.world(VILLAGE), kit.content, 8);
    applyMapChanges(
      restored.state,
      t.mapChanges.filter((c) => c.kind === MapChangeKind.ADD_EXIT_GRID),
    );
    expect(exitGridAt(restored.state, STATUE_EXIT)?.gridNo).toBe(13037);
  });

  it('opens with the remote trigger only in the statue room of O3', () => {
    const sim = inO3();
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, 12000, 0);
    expect(useStatueRemote(t, merc)).toBe(false);
    t.world.level.rooms[merc.gridNo] = STATUE_ROOM;
    t.sector = { x: 3, y: 16, z: 0 };
    expect(useStatueRemote(t, merc)).toBe(false);
    t.sector = { ...O3 };
    expect(useStatueRemote(t, merc)).toBe(true);
    expect(t.events).toContainEqual({ type: 'statueOpened', sector: 'O3', destroyed: false });
  });
});
