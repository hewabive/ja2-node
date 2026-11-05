import { parseSectorString, sameSector } from '../../../src/content/strategic/sector-ids.ts';
import {
  createCampaignSession,
  DEFAULT_AIM_SQUAD,
  FIRST_AIM_PROFILE,
  LAST_AIM_PROFILE,
  STUB_SQUAD_PROFILES,
} from '../../../src/server/campaign-factory.ts';
import type { CampaignSession } from '../../../src/server/campaign-session.ts';
import { Session } from '../../../src/server/session.ts';
import type { CampaignSim } from '../../../src/sim/campaign/campaign-sim.ts';
import { wakeUpQueen } from '../../../src/sim/strategic/ai/reactions.ts';
import { removeGroup } from '../../../src/sim/strategic/forces/groups.ts';
import { setThisSectorAsPlayerControlled } from '../../../src/sim/strategic/map/control.ts';
import { type SectorInfo, sectorInfo } from '../../../src/sim/strategic/map/sectors.ts';
import { CompressMode } from '../../../src/sim/strategic/time/constants.ts';
import { MeteredSim } from '../battle.ts';
import { answerPrompts, type Campaign, CompressionRefused, compressUntil, leaveSector, nextDay, worldSeconds } from '../campaign-run.ts';
import { STRATEGIC_COUNTERS } from '../inspector.ts';
import { type BenchContext, measure, type VariantSpec } from '../measure.ts';
import { round } from '../stats.ts';

export const STRATEGIC = 'strategic';

const DAY_TARGET_MS = 100;
const SOLO_SQUAD = 1;
const FULL_SQUAD = 6;
const FULL_SQUAD_DAYS = 7;
const LONG_CONTRACT_DAYS = 14;
const SQUAD_FUNDS = 1_000_000;
const START_SECTOR = { x: 9, y: 1 };
const LIBERATED_TOWN = [
  { x: 13, y: 2 },
  { x: 13, y: 3 },
  { x: 13, y: 4 },
];
const LOADED_TOWN = 'C13';
const TRAVEL_SLICE_SECONDS = 3600;
const TRAVEL_SLICES = 72;
const CONTESTED = true;
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

function candidateProfiles(ctx: BenchContext): number[] {
  const preferred = ctx.data.source === 'stubs' ? STUB_SQUAD_PROFILES : DEFAULT_AIM_SQUAD;
  const rest: number[] = [];
  for (let p = FIRST_AIM_PROFILE; p <= LAST_AIM_PROFILE; p++) if (!preferred.includes(p)) rest.push(p);
  return [...preferred, ...rest];
}

function hireSquad(ctx: BenchContext, campaignSession: CampaignSession, squad: number): void {
  const campaign = campaignSession.campaign;
  if (squad !== SOLO_SQUAD) campaign.state.finances.balance = SQUAD_FUNDS;
  let hired = 0;
  for (const profile of candidateProfiles(ctx)) {
    if (hired === squad) break;
    if (campaign.dispatch({ type: 'aimHire', profile, contract: LONG_CONTRACT_DAYS }).ok) hired++;
  }
  if (hired < squad) throw new Error(`bench: only ${hired} of ${squad} mercs could be hired`);
  const closed = campaign.dispatch({ type: 'closeLaptop' });
  if (!closed.ok) throw new Error(`bench: cannot close the laptop: ${closed.reason ?? ''}`);
}

function noGarrison(info: SectorInfo): void {
  info.numAdmins = 0;
  info.numTroops = 0;
  info.numElites = 0;
}

async function landedCampaign(ctx: BenchContext, squad: number): Promise<Campaign> {
  const campaignSession = await createCampaignSession(ctx.data.read, ctx.data.exists, ctx.seed, { hire: [], land: false }, ctx.data.layers);
  hireSquad(ctx, campaignSession, squad);
  noGarrison(sectorInfo(campaignSession.campaign.state.map, START_SECTOR));
  const metered = new MeteredSim(campaignSession);
  const c: Campaign = { campaignSession, metered, session: new Session(`strategic-${ctx.seed}`, metered) };
  await order(c, { type: 'compressTime', mode: CompressMode.MIN5 });
  c.session.advance({ idle: true });
  return c;
}

async function order(c: Campaign, cmd: { readonly type: string; readonly [key: string]: unknown }): Promise<void> {
  await c.campaignSession.prepare(cmd);
  const result = c.session.dispatch(cmd);
  if (!result.ok) throw new Error(`bench: ${cmd.type} refused: ${result.reason ?? ''}`);
}

function handOverDrassen(campaign: CampaignSim): void {
  if (!campaign.strategic) throw new Error('bench: the campaign has no strategic layer');
  for (const sector of LIBERATED_TOWN) {
    noGarrison(sectorInfo(campaign.state.map, sector));
    setThisSectorAsPlayerControlled(campaign.strategic, { ...sector, z: 0 }, CONTESTED);
  }
}

async function clearedCampaign(ctx: BenchContext, queen: boolean, squad: number): Promise<Campaign> {
  const c = await landedCampaign(ctx, squad);
  leaveSector(c);
  if (queen) {
    const campaign = c.campaignSession.campaign;
    if (!campaign.queen) throw new Error('bench: the campaign has no strategic AI');
    handOverDrassen(campaign);
    wakeUpQueen(campaign.queen);
  }
  return c;
}

function noEnemiesAnywhere(campaign: CampaignSim): void {
  const ctx = campaign.strategic;
  if (!ctx) throw new Error('bench: the campaign has no strategic layer');
  for (const info of campaign.state.map.sectors) noGarrison(info);
  for (const g of ctx.state.forces.groups.filter((group) => !group.player)) removeGroup(ctx, g, true);
}

function squadIn(c: Campaign, sector: string): boolean {
  const target = parseSectorString(sector);
  const mercs = c.campaignSession.roster?.all() ?? [];
  return mercs.length > 0 && mercs.every((m) => sameSector(m.sector, target) && !m.betweenSectors);
}

async function squadInLoadedTown(ctx: BenchContext, squad: number): Promise<Campaign> {
  const c = await landedCampaign(ctx, squad);
  const campaign = c.campaignSession.campaign;
  noEnemiesAnywhere(campaign);
  handOverDrassen(campaign);
  leaveSector(c, LOADED_TOWN);
  for (let slice = 0; slice < TRAVEL_SLICES && !squadIn(c, LOADED_TOWN); slice++) compressUntil(c, worldSeconds(c) + TRAVEL_SLICE_SECONDS);
  if (!squadIn(c, LOADED_TOWN)) throw new Error(`bench: the squad did not reach ${LOADED_TOWN}`);
  await order(c, { type: 'enterSector', sector: LOADED_TOWN });
  c.session.advance({ idle: true });
  answerPrompts(c);
  await order(c, { type: 'mapScreen' });
  return c;
}

function loadedSoldiers(c: Campaign): number {
  const t = c.campaignSession.campaign.tactical?.state;
  return t ? t.soldiers.filter((s) => s?.placed && s.life > 0).length : 0;
}

function playerSectors(c: Campaign): number {
  return c.campaignSession.campaign.state.map.elements.filter((e) => !e.enemyControlled).length;
}

function eventDeltas(c: Campaign, before: ReadonlyMap<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of COUNTED_EVENTS) out[name] = c.metered.count(name) - (before.get(name) ?? 0);
  return out;
}

interface Variant {
  readonly days: number;
  readonly queen?: boolean;
  readonly squad?: number;
  readonly loadedTown?: boolean;
  readonly mode?: number;
}

const MODE_NAMES: Readonly<Record<number, string>> = { [CompressMode.MIN5]: '-min5', [CompressMode.MIN30]: '-min30' };

function variantName(v: Variant, squad: number): string {
  const town = v.loadedTown ? '-town' : '';
  const mode = MODE_NAMES[v.mode ?? CompressMode.MIN60] ?? '';
  return `${v.days}d${v.queen ? '-queen' : ''}${town}${squad === SOLO_SQUAD ? '' : `-mercs${squad}`}${mode}`;
}

function variant(ctx: BenchContext, v: Variant): VariantSpec<Campaign> {
  const squad = v.squad ?? SOLO_SQUAD;
  return {
    variant: variantName(v, squad),
    metric: 'worldDay',
    unit: 'ms',
    target: DAY_TARGET_MS,
    calls: STRATEGIC_COUNTERS,
    perSample: true,
    setup: () => (v.loadedTown ? squadInLoadedTown(ctx, squad) : clearedCampaign(ctx, v.queen === true, squad)),
    run: (c) => {
      const loadedAtStart = loadedSoldiers(c);
      const days = v.days;
      const samples: number[] = [];
      const before = new Map(c.metered.events);
      const playerSectorsAtStart = playerSectors(c);
      const viewMs0 = c.metered.viewMs;
      const views0 = c.metered.views;
      let stops = 0;
      let stopped: string | null = null;
      for (let d = 0; d < days && stopped === null; d++) {
        const t0 = performance.now();
        try {
          stops += compressUntil(c, nextDay(c), v.mode).length;
          samples.push(performance.now() - t0);
        } catch (err) {
          if (!(err instanceof CompressionRefused)) throw err;
          stopped = `day ${d + 1}: ${err.message}`;
        }
      }
      const state = c.campaignSession.campaign.state;
      const events = eventDeltas(c, before);
      return {
        samples,
        work: { days: samples.length, advanceCalls: stops, ...events },
        counters: {
          days: samples.length,
          advanceCalls: stops,
          ...events,
          mercsLeft: c.campaignSession.roster?.all().length ?? 0,
          playerSectorsAtStart,
          playerSectorsAtEnd: playerSectors(c),
          loadedAtStart,
          loadedAtEnd: loadedSoldiers(c),
          frameViews: c.metered.views - views0,
          viewBuildMsPerDay: round((c.metered.viewMs - viewMs0) / Math.max(1, samples.length), 1),
        },
        info: { flow: state.flow, queenAwake: state.queen.awake, ...(stopped ? { stoppedEarly: stopped } : {}) },
      };
    },
  };
}

export async function strategic(ctx: BenchContext): Promise<void> {
  for (const queen of [false, true]) for (const days of DAY_LENGTHS) await measure(ctx, STRATEGIC, variant(ctx, { days, queen }));
  await measure(ctx, STRATEGIC, variant(ctx, { days: FULL_SQUAD_DAYS, squad: FULL_SQUAD }));
  for (const mode of [CompressMode.MIN60, CompressMode.MIN5])
    await measure(ctx, STRATEGIC, variant(ctx, { days: FULL_SQUAD_DAYS, squad: FULL_SQUAD, loadedTown: true, mode }));
}
