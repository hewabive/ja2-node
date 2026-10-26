import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MapFlags, parseMap } from '../../src/content/formats/map.ts';
import { WORLD_COLS } from '../../src/content/world/grid.ts';
import { Team } from '../../src/sim/tactical/soldier.ts';
import { sharedStubPackDir } from '../../tests/support/stub-pack.ts';
import { ARENA_HEIGHT, ARENA_ORIGIN, ARENA_WIDTH, ArenaLayout, type ArenaSpec, generateArena } from './arena.ts';
import { type BenchData, openBenchData } from './data.ts';
import { createTacticalBench } from './tactical.ts';

const BATTLE: ArenaSpec = {
  name: 'arena-e16',
  layout: ArenaLayout.BATTLE,
  enemies: 16,
  elites: 4,
  militia: 4,
  civilians: 4,
  mercs: 6,
  seed: 3,
};
const PATROL: ArenaSpec = {
  name: 'patrol-20',
  layout: ArenaLayout.PATROL,
  enemies: 10,
  elites: 0,
  militia: 0,
  civilians: 10,
  mercs: 6,
  seed: 3,
};

let data: BenchData;

beforeAll(async () => {
  data = await openBenchData({ stubsDir: sharedStubPackDir() });
});

afterAll(async () => {
  await data.close();
});

function insideArena(gridNo: number): boolean {
  const x = (gridNo % WORLD_COLS) - ARENA_ORIGIN.x;
  const y = Math.trunc(gridNo / WORLD_COLS) - ARENA_ORIGIN.y;
  return x >= 0 && x < ARENA_WIDTH && y >= 0 && y < ARENA_HEIGHT;
}

describe('bench arena', () => {
  it('is generated deterministically from its spec and changes with the seed', () => {
    expect(generateArena(BATTLE).text).toBe(generateArena(BATTLE).text);
    expect(generateArena({ ...BATTLE, seed: 4 }).text).not.toBe(generateArena(BATTLE).text);
    expect(generateArena(PATROL).text).toBe(generateArena(PATROL).text);
  });

  it('round-trips through the stub map format into a map with every placement', async () => {
    for (const spec of [BATTLE, PATROL]) {
      const arena = generateArena(spec);
      await data.addArena(arena);
      const bytes = await data.read(arena.path);
      if (!bytes) throw new Error('arena map not registered');
      const map = parseMap(bytes);
      expect(map.flags & MapFlags.FULL_SOLDIER).not.toBe(0);
      expect(map.placements).toHaveLength(spec.enemies + spec.militia + spec.civilians);
      expect(map.placements.filter((p) => p.basic.team === Team.CIV)).toHaveLength(spec.civilians);
      expect(arena.mercGridNos).toHaveLength(spec.mercs);
      expect(arena.mercGridNos.every(insideArena)).toBe(true);
      expect(arena.garrison).toEqual({ admins: 0, troops: spec.enemies - spec.elites, elites: spec.elites });
    }
  });

  it('populates a battle that starts at once, with mercs, militia, enemies and civilians', async () => {
    const arena = generateArena(BATTLE);
    const session = await createTacticalBench(data, await data.addArena(arena), 1, {
      sector: { x: 9, y: 1 },
      mercs: BATTLE.mercs,
      mercGridNos: arena.mercGridNos,
      garrison: arena.garrison,
      militia: BATTLE.militia,
    });
    const t = session.sim.state;
    const placed = (team: number) => t.soldiers.filter((s) => s?.placed && s.team === team).length;
    expect([placed(Team.OUR), placed(Team.ENEMY), placed(Team.MILITIA), placed(Team.CIV)]).toEqual([6, 16, 4, 4]);
    expect(t.inCombat).toBe(true);
  });

  it('keeps the patrol squad in a sealed bunker, out of sight', async () => {
    const arena = generateArena(PATROL);
    expect(arena.alarmGridNo).not.toBeNull();
    const session = await createTacticalBench(data, await data.addArena(arena), 1, {
      sector: { x: 9, y: 1 },
      mercs: PATROL.mercs,
      mercGridNos: arena.mercGridNos,
      garrison: arena.garrison,
      militia: 0,
    });
    for (let i = 0; i < 2000; i++) session.step();
    expect(session.sim.state.inCombat).toBe(false);
    expect(session.drainEvents().some((e) => e.type === 'combatStarted' || e.type === 'enemySighted')).toBe(false);
  });
});
