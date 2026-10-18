import { createCampaignSession } from '../../../src/server/campaign-factory.ts';
import { Session } from '../../../src/server/session.ts';
import { wakeUpQueen } from '../../../src/sim/strategic/ai/reactions.ts';
import { sectorInfo } from '../../../src/sim/strategic/map/sectors.ts';
import { CompressMode } from '../../../src/sim/strategic/time/constants.ts';
import { MeteredSim } from '../battle.ts';
import { type Campaign, CompressionRefused, compressUntil, leaveSector, nextDay } from '../campaign-run.ts';
import { STRATEGIC_COUNTERS } from '../inspector.ts';
import { type BenchContext, measure, type VariantSpec } from '../measure.ts';

export const STRATEGIC = 'strategic';

const DAY_TARGET_MS = 100;
const SQUAD_PROFILES = [0, 1];
const LONG_CONTRACT_DAYS = 14;
const START_SECTOR = { x: 9, y: 1 };
const DAY_LENGTHS = [7, 30] as const;
const COUNTED_EVENTS = [
  'dayStarted',
  'compressionStopped',
  'preBattle',
  'arStarted',
  'battleResult',
  'sectorControlChanged',
  'mercCaptured',
  'meanwhileEnded',
] as const;

async function clearedCampaign(ctx: BenchContext, queen: boolean): Promise<Campaign> {
  const hire = SQUAD_PROFILES.map((profile) => ({ profile, contract: LONG_CONTRACT_DAYS }));
  const campaignSession = await createCampaignSession(ctx.data.read, ctx.data.exists, ctx.seed, { hire, land: false }, ctx.data.layers);
  const campaign = campaignSession.campaign;
  const start = sectorInfo(campaign.state.map, START_SECTOR);
  start.numAdmins = 0;
  start.numTroops = 0;
  start.numElites = 0;
  const metered = new MeteredSim(campaignSession);
  const c: Campaign = { campaignSession, metered, session: new Session(`strategic-${ctx.seed}`, metered) };
  const land = { type: 'compressTime', mode: CompressMode.MIN5 };
  await campaignSession.prepare(land);
  const landed = c.session.dispatch(land);
  if (!landed.ok) throw new Error(`bench: the squad cannot land: ${landed.reason ?? ''}`);
  c.session.advance({ idle: true });
  leaveSector(c);
  if (queen) {
    if (!campaign.queen) throw new Error('bench: the campaign has no strategic AI');
    wakeUpQueen(campaign.queen);
  }
  return c;
}

function eventDeltas(c: Campaign, before: ReadonlyMap<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of COUNTED_EVENTS) out[name] = c.metered.count(name) - (before.get(name) ?? 0);
  return out;
}

function variant(ctx: BenchContext, days: number, queen: boolean): VariantSpec<Campaign> {
  return {
    variant: `${days}d${queen ? '-queen' : ''}`,
    metric: 'worldDay',
    unit: 'ms',
    target: DAY_TARGET_MS,
    calls: STRATEGIC_COUNTERS,
    perSample: true,
    setup: () => clearedCampaign(ctx, queen),
    run: (c) => {
      const samples: number[] = [];
      const before = new Map(c.metered.events);
      let stops = 0;
      let stopped: string | null = null;
      for (let d = 0; d < days && stopped === null; d++) {
        const t0 = performance.now();
        try {
          stops += compressUntil(c, nextDay(c)).length;
          samples.push(performance.now() - t0);
        } catch (err) {
          if (!(err instanceof CompressionRefused)) throw err;
          stopped = `day ${d + 1}: ${err.message}`;
        }
      }
      const state = c.campaignSession.campaign.state;
      return {
        samples,
        counters: {
          days: samples.length,
          advanceCalls: stops,
          ...eventDeltas(c, before),
          mercsLeft: c.campaignSession.roster?.all().length ?? 0,
        },
        info: { flow: state.flow, queenAwake: state.queen.awake, ...(stopped ? { stoppedEarly: stopped } : {}) },
      };
    },
  };
}

export async function strategic(ctx: BenchContext): Promise<void> {
  for (const queen of [false, true]) for (const days of DAY_LENGTHS) await measure(ctx, STRATEGIC, variant(ctx, days, queen));
}
