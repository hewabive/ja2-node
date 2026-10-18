import type { TacticalSession } from '../../../src/server/sandbox.ts';
import { Session } from '../../../src/server/session.ts';
import { OKLIFE, Team } from '../../../src/sim/tactical/soldier.ts';
import { teamMembers } from '../../../src/sim/tactical/state.ts';
import { ArenaLayout, generateArena } from '../arena.ts';
import { MeteredSim } from '../battle.ts';
import { TACTICAL_COUNTERS } from '../inspector.ts';
import { type BenchContext, measure, type VariantSpec } from '../measure.ts';
import { round } from '../stats.ts';
import { createTacticalBench } from '../tactical.ts';

export const REALTIME = 'realtime';

const TICK_TARGET_40_US = 250;
const STEP_TICKS = 1000;
const STEPS = 10;
const MERCS = 6;
const SECTOR = { x: 9, y: 1 };
const SIZES = [20, 40, 64] as const;
const US_PER_MS = 1000;
const ALERTS = ['green', 'yellow', 'red', 'black'] as const;
const ALARM_NOISE_DURATION = 12;

class TimedSim extends MeteredSim {
  readonly tickUs: number[] = [];

  override step(): void {
    const t0 = performance.now();
    super.step();
    this.tickUs.push((performance.now() - t0) * US_PER_MS);
  }
}

interface Patrol {
  readonly session: Session;
  readonly timed: TimedSim;
  readonly sim: TacticalSession;
}

function alertCounts(sim: TacticalSession): Record<string, number> {
  const out: Record<string, number> = {};
  const enemies = sim.sim.state.soldiers.filter((s) => s?.placed && s.team === Team.ENEMY);
  for (const [i, name] of ALERTS.entries())
    out[`enemies${name[0]?.toUpperCase()}${name.slice(1)}`] = enemies.filter((s) => s?.ai.alertStatus === i).length;
  return out;
}

function soundAlarm(sim: TacticalSession, gridNo: number): void {
  const t = sim.sim.state;
  t.perception.publicNoiseGridNo[Team.ENEMY] = gridNo;
  t.perception.publicNoiseVolume[Team.ENEMY] = ALARM_NOISE_DURATION;
  for (const s of teamMembers(t, Team.ENEMY)) if (s.life >= OKLIFE) t.perceptionHooks.setNewSituation(s);
}

function variant(ctx: BenchContext, soldiers: number, yellow: boolean): VariantSpec<Patrol> {
  const enemies = Math.trunc(soldiers / 2);
  const arena = generateArena({
    name: `patrol-${soldiers}`,
    layout: ArenaLayout.PATROL,
    enemies,
    elites: 0,
    militia: 0,
    civilians: soldiers - enemies,
    mercs: MERCS,
    seed: ctx.seed,
  });
  const name = `${arena.spec.name}-${yellow ? 'yellow' : 'green'}`;
  return {
    variant: name,
    metric: 'tick',
    unit: 'µs',
    targetStat: 'mean',
    ...(soldiers === 40 ? { target: TICK_TARGET_40_US } : {}),
    calls: TACTICAL_COUNTERS,
    setup: async () => {
      const sim = await createTacticalBench(ctx.data, await ctx.data.addArena(arena), ctx.seed, {
        sector: SECTOR,
        mercs: MERCS,
        mercGridNos: arena.mercGridNos,
        garrison: arena.garrison,
        militia: 0,
      });
      const timed = new TimedSim(sim);
      const session = new Session(name, timed);
      if (yellow && arena.alarmGridNo !== null) soundAlarm(sim, arena.alarmGridNo);
      return { session, timed, sim };
    },
    run: ({ session, timed, sim }) => {
      const combat0 = timed.count('combatStarted');
      const viewMs0 = timed.viewMs;
      for (let i = 0; i < STEPS; i++) session.advance({ ticks: STEP_TICKS });
      const samples = [...timed.tickUs];
      const mean = samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length);
      const alerts = alertCounts(sim);
      return {
        samples,
        work: { combatStarted: timed.count('combatStarted') - combat0, ...alerts },
        counters: {
          ticks: samples.length,
          ticksPerCpuSecond: Math.round((US_PER_MS * US_PER_MS) / Math.max(mean, 1e-9)),
          combatStarted: timed.count('combatStarted') - combat0,
          viewMsPerFrame: round((timed.viewMs - viewMs0) / Math.max(1, samples.length / 10), 3),
          ...alerts,
        },
        info: {
          soldiers: { enemies, civilians: soldiers - enemies, mercs: MERCS },
          alert: yellow ? 'yellow (team alarm at the far side)' : 'green',
        },
      };
    },
  };
}

export async function realtime(ctx: BenchContext): Promise<void> {
  for (const soldiers of SIZES) for (const yellow of [false, true]) await measure(ctx, REALTIME, variant(ctx, soldiers, yellow));
}
