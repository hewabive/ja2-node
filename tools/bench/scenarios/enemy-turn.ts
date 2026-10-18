import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CampaignSession } from '../../../src/server/campaign-session.ts';
import type { TacticalSession } from '../../../src/server/sandbox.ts';
import { createSaveSession } from '../../../src/server/save-session.ts';
import { Session } from '../../../src/server/session.ts';
import { ArenaLayout, generateArena } from '../arena.ts';
import { engage, fight, MeteredSim } from '../battle.ts';
import { TACTICAL_COUNTERS } from '../inspector.ts';
import { type BenchContext, measure, type VariantSpec } from '../measure.ts';
import { round, sum } from '../stats.ts';
import { createTacticalBench, type TacticalPopulation } from '../tactical.ts';

export const ENEMY_TURN = 'enemy-turn';
export const ENEMY_TURN_SEED = 2;

const TURN_TARGET_16_MS = 300;
const TURN_TARGET_32_MS = 1000;
const MERCS = 6;
const ARENA_CIVILIANS = 4;
const ARENA_MILITIA_WITH_32 = 6;
const ELITE_SHARE = 4;
const A9_SECTOR = { x: 9, y: 1 };
const A9_MAP = 'maps/a9.dat';
const D13_SAVE = 'SaveGame10';

type BattleSession = TacticalSession | CampaignSession;

interface Battle {
  readonly session: Session;
  readonly metered: MeteredSim;
  readonly sim: BattleSession;
}

function wrap(id: string, sim: BattleSession): Battle {
  const metered = new MeteredSim(sim);
  return { session: new Session(id, metered), metered, sim };
}

function runBattle(b: Battle) {
  const field = { session: b.session, metered: b.metered, sim: () => b.sim.sim, resolve: () => 0 };
  engage(field);
  const viewMs0 = b.metered.viewMs;
  const r = fight(field);
  const turns = r.turnMs.length;
  const shots = b.metered.count('shotFired');
  return {
    samples: r.turnMs,
    series: { ticksPerTurn: r.turnTicks },
    counters: {
      turns,
      rounds: r.rounds,
      ticks: sum(r.turnTicks),
      shotsFired: shots,
      soldiersHit: b.metered.count('soldierHit'),
      soldiersDied: b.metered.count('soldierDied'),
      interrupts: b.metered.count('interrupt'),
      viewMs: round(b.metered.viewMs - viewMs0, 1),
    },
    work: { turns, ticks: sum(r.turnTicks), shots, hits: b.metered.count('soldierHit'), deaths: b.metered.count('soldierDied') },
    info: { outcome: r.outcome },
  };
}

function arenaVariant(ctx: BenchContext, enemies: number, target: number): VariantSpec<Battle> {
  const militia = enemies >= 32 ? ARENA_MILITIA_WITH_32 : 0;
  const arena = generateArena({
    name: `arena-e${enemies}`,
    layout: ArenaLayout.BATTLE,
    enemies,
    elites: Math.trunc(enemies / ELITE_SHARE),
    militia,
    civilians: ARENA_CIVILIANS,
    mercs: MERCS,
    seed: ctx.seed,
  });
  const population: TacticalPopulation = {
    sector: A9_SECTOR,
    mercs: MERCS,
    mercGridNos: arena.mercGridNos,
    garrison: arena.garrison,
    militia,
  };
  return {
    variant: arena.spec.name,
    metric: 'enemyTurn',
    unit: 'ms',
    target,
    calls: TACTICAL_COUNTERS,
    perSample: true,
    setup: async () => wrap(arena.spec.name, await createTacticalBench(ctx.data, await ctx.data.addArena(arena), ctx.seed, population)),
    run: runBattle,
  };
}

function a9Variant(ctx: BenchContext, enemies: number, target: number): VariantSpec<Battle> {
  const population: TacticalPopulation = {
    sector: A9_SECTOR,
    mercs: MERCS,
    mercGridNos: null,
    garrison: { admins: 0, troops: enemies, elites: 0 },
    militia: 0,
  };
  const name = `a9-e${enemies}`;
  return {
    variant: name,
    metric: 'enemyTurn',
    unit: 'ms',
    target,
    calls: TACTICAL_COUNTERS,
    perSample: true,
    setup: async () => wrap(name, await createTacticalBench(ctx.data, A9_MAP, ctx.seed, population)),
    run: runBattle,
  };
}

function saveVariant(ctx: BenchContext, save: string, target: number): VariantSpec<Battle> {
  const dir = ctx.data.savesDir;
  if (!dir) throw new Error('bench: native saves need the original data');
  return {
    variant: `d13-${save.toLowerCase()}`,
    metric: 'enemyTurn',
    unit: 'ms',
    target,
    calls: TACTICAL_COUNTERS,
    perSample: true,
    setup: async () => {
      const bytes = new Uint8Array(await readFile(join(dir, `${save}.sav`)));
      const { session } = await createSaveSession(ctx.data.read, bytes, ctx.seed, ctx.data.exists, ctx.data.layers);
      return wrap(save, session);
    },
    run: runBattle,
  };
}

export async function enemyTurn(ctx: BenchContext): Promise<void> {
  const variants: VariantSpec<Battle>[] = [
    arenaVariant(ctx, 8, TURN_TARGET_16_MS),
    arenaVariant(ctx, 16, TURN_TARGET_16_MS),
    arenaVariant(ctx, 32, TURN_TARGET_32_MS),
  ];
  if (ctx.data.source === 'original')
    variants.push(
      a9Variant(ctx, 4, TURN_TARGET_16_MS),
      a9Variant(ctx, 16, TURN_TARGET_16_MS),
      a9Variant(ctx, 32, TURN_TARGET_32_MS),
      saveVariant(ctx, D13_SAVE, TURN_TARGET_16_MS),
    );
  for (const v of variants) await measure(ctx, ENEMY_TURN, v);
}
