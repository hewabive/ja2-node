import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { answerPrompts, clearSector, newLandedCampaign } from '../campaign-run.ts';
import { openBenchData } from '../data.ts';
import { type BenchContext, measure } from '../measure.ts';
import { round } from '../stats.ts';

export const CAMPAIGN = 'campaign';
export const CAMPAIGN_SEED = 7;

const KIB_PER_MIB = 1024;
const CHILD_MAX_BUFFER = 1 << 20;
const CHILD = fileURLToPath(import.meta.url);

interface CampaignReport {
  readonly totalMs: number;
  readonly landMs: number;
  readonly clearMs: number;
  readonly peakRssMb: number;
  readonly heapUsedMb: number;
  readonly outcome: string;
  readonly worldTime: { readonly day: number; readonly hour: number; readonly minute: number };
}

async function runOnce(dataDir: string, seed: number): Promise<CampaignReport> {
  const t0 = performance.now();
  const data = await openBenchData({ dataDir: dataDir || undefined });
  try {
    const c = await newLandedCampaign(data, seed);
    const landed = performance.now();
    const outcome = clearSector(c);
    answerPrompts(c);
    const done = performance.now();
    const clock = c.campaignSession.view().clock;
    return {
      totalMs: done - t0,
      landMs: landed - t0,
      clearMs: done - landed,
      peakRssMb: round(process.resourceUsage().maxRSS / KIB_PER_MIB, 1),
      heapUsedMb: round(process.memoryUsage().heapUsed / KIB_PER_MIB / KIB_PER_MIB, 1),
      outcome,
      worldTime: { day: clock?.day ?? 0, hour: clock?.hour ?? 0, minute: clock?.minute ?? 0 },
    };
  } finally {
    await data.close();
  }
}

async function inChild(dataDir: string, seed: number): Promise<CampaignReport> {
  const run = promisify(execFile);
  const { stdout } = await run(process.execPath, [CHILD, '--data', dataDir, '--seed', String(seed)], { maxBuffer: CHILD_MAX_BUFFER });
  const last = stdout.trim().split('\n').at(-1) ?? '';
  return JSON.parse(last) as CampaignReport;
}

export async function campaign(ctx: BenchContext): Promise<void> {
  const dataDir = ctx.data.dataDir ?? '';
  await measure(ctx, CAMPAIGN, {
    variant: 'land-and-clear',
    metric: 'total',
    unit: 'ms',
    inProcess: false,
    setup: async () => null,
    run: async () => {
      const r = await inChild(dataDir, ctx.seed);
      return {
        samples: [r.totalMs],
        series: { landMs: [r.landMs], clearMs: [r.clearMs], peakRssMb: [r.peakRssMb] },
        counters: { peakRssMb: r.peakRssMb, heapUsedMb: r.heapUsedMb },
        info: {
          outcome: r.outcome,
          worldTime: r.worldTime,
          note: 'shortened: new campaign, landing, first sector cleared (the full stub campaign is slice S13)',
        },
      };
    },
  });
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { data: { type: 'string' }, seed: { type: 'string' } } });
  const report = await runOnce(values.data ?? '', Number(values.seed ?? CAMPAIGN_SEED));
  console.log(JSON.stringify(report));
}
