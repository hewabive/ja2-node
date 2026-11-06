import { ItemClass } from '../../../src/content/items/items.ts';
import { sectorMapPath } from '../../../src/content/strategic/sector-maps.ts';
import type { CommandEnvelope } from '../../../src/protocol/messages.ts';
import type { TacticalSession } from '../../../src/server/sandbox.ts';
import { Session } from '../../../src/server/session.ts';
import { TICK_MS } from '../../../src/sim/clock.ts';
import { createItem, emptyObject } from '../../../src/sim/items/object.ts';
import { carriesMedKit } from '../../../src/sim/tactical/ai/medical.ts';
import { findObjClass } from '../../../src/sim/tactical/combat/reload.ts';
import { autoPlaceObject, NO_SLOT } from '../../../src/sim/tactical/inventory.ts';
import { OKLIFE, type Soldier, Team } from '../../../src/sim/tactical/soldier.ts';
import { soldierInventoryContext } from '../../../src/sim/tactical/soldier-inventory.ts';
import { type TacticalState, teamMembers } from '../../../src/sim/tactical/state.ts';
import { ArenaLayout, generateArena } from '../arena.ts';
import { MeteredSim, STALLED } from '../battle.ts';
import { TACTICAL_COUNTERS } from '../inspector.ts';
import { type BenchContext, measure, type VariantSpec } from '../measure.ts';
import { round } from '../stats.ts';
import { createTacticalBench, type TacticalPopulation } from '../tactical.ts';

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
const FRAME_TARGET_US = 5000;
const BANDAGE_CIVILIANS = [20, 32] as const;
const BANDAGE_TOWN = { x: 13, y: 3, z: 0 };
const NO_GARRISON = { admins: 0, troops: 0, elites: 0 };
const PATIENTS_IN_SQUAD: readonly number[] = [0, 2, 4];
const PATIENT_LIFE = 40;
const PATIENT_BLEEDING = 12;
const MED_KIT = 'FIRSTAIDKIT';
const FULL_STATUS = 100;
const COMPLETION_BUDGET_TICKS = 20_000;
const BOX_TICKS = 1000;
const MS_PER_SECOND = 1000;
const FRAMES_PER_SECOND = MS_PER_SECOND / TICK_MS;

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

interface Bandage {
  readonly session: Session;
  readonly timed: TimedSim;
  readonly sim: TacticalSession;
}

function medKitIndex(t: TacticalState): number {
  const kit = t.content.items.byName.get(MED_KIT);
  if (!kit) throw new Error(`bench: no ${MED_KIT} in the item table`);
  return kit.index;
}

function giveMedKit(t: TacticalState, s: Soldier): void {
  if (carriesMedKit(t, s)) return;
  if (!autoPlaceObject(soldierInventoryContext(t, s), s, createItem(t.content.items, medKitIndex(t), FULL_STATUS)))
    throw new Error(`bench: no room for a ${MED_KIT} on merc ${s.id}`);
}

function takeMedKits(t: TacticalState, s: Soldier): void {
  const medKitSlot = () => findObjClass(t.content.items, s, ItemClass.MEDKIT);
  for (let slot = medKitSlot(); slot !== NO_SLOT; slot = medKitSlot()) s.inv[slot] = emptyObject();
}

function woundSquad(t: TacticalState): void {
  const squad = teamMembers(t, Team.OUR).filter((s) => s.placed);
  for (const [place, s] of squad.entries()) {
    if (!PATIENTS_IN_SQUAD.includes(place)) {
      giveMedKit(t, s);
      continue;
    }
    takeMedKits(t, s);
    s.life = PATIENT_LIFE;
    s.bleeding = PATIENT_BLEEDING;
  }
}

function bleedingMercs(t: TacticalState): number {
  return teamMembers(t, Team.OUR).filter((s) => s.placed && s.bleeding > 0).length;
}

function mustDispatch(session: Session, cmd: CommandEnvelope): void {
  const result = session.dispatch(cmd);
  if (!result.ok) throw new Error(`bench: ${cmd.type} refused: ${result.reason ?? 'no reason'}`);
}

function soldiersOf(t: TacticalState): Record<string, number> {
  const placed = (team: number) => t.soldiers.filter((s) => s?.placed && s.team === team && s.life > 0).length;
  return { mercs: placed(Team.OUR), civilians: placed(Team.CIV), enemies: placed(Team.ENEMY) };
}

interface ModeRun {
  readonly framesToComplete: number;
  readonly stalled: boolean;
  readonly failed: boolean;
}

function endMode(session: Session, t: TacticalState): boolean {
  mustDispatch(session, { type: 'endAutoBandage' });
  const ended = session.advance({ ticks: 1 }).events.find((e) => e.type === 'autoBandageEnded');
  if (!ended || t.pathEnv.autoBandage) throw new Error('bench: auto-bandage did not end');
  return ended.failed;
}

function runMode(session: Session, timed: TimedSim, t: TacticalState): ModeRun {
  mustDispatch(session, { type: 'autoBandage' });
  mustDispatch(session, { type: 'answer', choice: 'yes' });
  const stalled = session.advance({ idle: true }, COMPLETION_BUDGET_TICKS).reason === 'budget';
  const framesToComplete = timed.tickUs.length;
  if (stalled) return { framesToComplete, stalled, failed: false };
  session.advance({ ticks: BOX_TICKS });
  return { framesToComplete, stalled, failed: endMode(session, t) };
}

function worstSecondMs(frameUs: readonly number[]): number {
  let window = 0;
  let worst = 0;
  for (const [i, us] of frameUs.entries()) {
    window += us - (frameUs[i - FRAMES_PER_SECOND] ?? 0);
    worst = Math.max(worst, window);
  }
  return round(worst / US_PER_MS, 1);
}

function bandageVariant(name: string, setupSim: () => Promise<TacticalSession>): VariantSpec<Bandage> {
  return {
    variant: name,
    metric: 'frame',
    unit: 'µs',
    target: FRAME_TARGET_US,
    targetStat: 'p95',
    calls: TACTICAL_COUNTERS,
    setup: async () => {
      const sim = await setupSim();
      woundSquad(sim.sim.state);
      const timed = new TimedSim(sim);
      return { session: new Session(name, timed), timed, sim };
    },
    run: ({ session, timed, sim }) => {
      const t = sim.sim.state;
      const patients = bleedingMercs(t);
      const mode = runMode(session, timed, t);
      const samples = [...timed.tickUs];
      const mean = samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length);
      const work = {
        frames: samples.length,
        framesToComplete: mode.framesToComplete,
        patients,
        stillBleeding: bleedingMercs(t),
        failed: mode.failed ? 1 : 0,
      };
      return {
        samples,
        series: { untilCompleteUs: samples.slice(0, mode.framesToComplete), boxUs: samples.slice(mode.framesToComplete) },
        work,
        counters: {
          ...work,
          ticksPerCpuSecond: Math.round((US_PER_MS * US_PER_MS) / Math.max(mean, 1e-9)),
          worstSecondMs: worstSecondMs(samples),
        },
        info: {
          soldiers: soldiersOf(t),
          outcome: mode.stalled ? `${STALLED}: not complete within ${COMPLETION_BUDGET_TICKS} frames` : 'ended',
        },
      };
    },
  };
}

function bandageArenaVariant(ctx: BenchContext, civilians: number): VariantSpec<Bandage> {
  const arena = generateArena({
    name: `bandage-${civilians}`,
    layout: ArenaLayout.OPEN,
    enemies: 0,
    elites: 0,
    militia: 0,
    civilians,
    mercs: MERCS,
    seed: ctx.seed,
  });
  const population: TacticalPopulation = {
    sector: SECTOR,
    mercs: MERCS,
    mercGridNos: arena.mercGridNos,
    garrison: NO_GARRISON,
    militia: 0,
  };
  return bandageVariant(arena.spec.name, async () => createTacticalBench(ctx.data, await ctx.data.addArena(arena), ctx.seed, population));
}

function bandageTownVariant(ctx: BenchContext): VariantSpec<Bandage> {
  const population: TacticalPopulation = { sector: BANDAGE_TOWN, mercs: MERCS, mercGridNos: null, garrison: NO_GARRISON, militia: 0 };
  return bandageVariant('bandage-c13', () =>
    createTacticalBench(ctx.data, sectorMapPath(ctx.data.exists, BANDAGE_TOWN, false), ctx.seed, population),
  );
}

export async function realtime(ctx: BenchContext): Promise<void> {
  for (const soldiers of SIZES) for (const yellow of [false, true]) await measure(ctx, REALTIME, variant(ctx, soldiers, yellow));
  for (const civilians of BANDAGE_CIVILIANS) await measure(ctx, REALTIME, bandageArenaVariant(ctx, civilians));
  await measure(ctx, REALTIME, bandageTownVariant(ctx));
}
