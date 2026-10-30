import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import { buildNewCampaign } from '../../src/server/campaign-factory.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import type { CampaignSim } from '../../src/sim/campaign/campaign-sim.ts';
import { mercArrivalTimeOfDay } from '../../src/sim/campaign/contracts/contract-times.ts';
import { addTransaction, FinanceCode } from '../../src/sim/campaign/finances.ts';
import { aimHire } from '../../src/sim/campaign/laptop/aim.ts';
import { addFreshBobbyRayInventory, bobbyRayPurchaseEvent, purchaseBobbyRayOrder } from '../../src/sim/campaign/laptop/bobby-ray.ts';
import type { LaptopRandom } from '../../src/sim/campaign/laptop/context.ts';
import { enterFloristOrderForm, orderFlowers } from '../../src/sim/campaign/laptop/florist.ts';
import { type ImpAttributes, impCreate } from '../../src/sim/campaign/laptop/imp.ts';
import {
  addLifeInsurancePayout,
  dailyUpdateOfInsuredMercs,
  endInsuranceInvestigation,
  insuranceLength,
  insurancePremium,
  payLifeInsuranceForDeadMerc,
  purchaseOrExtendInsurance,
  startInsuranceInvestigation,
} from '../../src/sim/campaign/laptop/insurance.ts';
import type { LaptopFlow } from '../../src/sim/campaign/laptop/laptop-flow.ts';
import { Bookmark, NO_PERSONNEL_ENTRY } from '../../src/sim/campaign/laptop/laptop-state.ts';
import { hireMercMerc, mercDebts, openMercAccount, payMercAccounts } from '../../src/sim/campaign/laptop/merc-site.ts';
import { calcCompetence } from '../../src/sim/campaign/laptop/profile-state.ts';
import type { RosterMerc } from '../../src/sim/campaign/roster.ts';
import { gameOptions } from '../../src/sim/options.ts';
import { DrawMismatch, ReplayStream, type TracedDraw } from '../../src/sim/strategic/forces/autoresolve/replay-rng.ts';
import type { RollSource } from '../../src/sim/strategic/forces/ports.ts';
import { Fact } from '../../src/sim/strategic/narrative/fact-ids.ts';
import { factValue, setFact } from '../../src/sim/strategic/narrative/facts.ts';
import { createStrategicState, type StrategicState } from '../../src/sim/strategic/state.ts';
import { EventKind, NUM_MIN_IN_DAY, NUM_MIN_IN_HOUR } from '../../src/sim/strategic/time/constants.ts';
import { worldTotalMinutes } from '../../src/sim/strategic/time/world-clock.ts';
import type { ProfileProgress } from '../../src/sim/tactical/profiles.ts';
import { createTacticalSaveSession } from './tactical-import.ts';

type Json = Record<string, unknown>;
type Draw = readonly [string, number, number, number];

export const LAPTOP_PROBES: ReadonlySet<string> = new Set([
  'newgamefull',
  'arrival',
  'laptop',
  'setbalance',
  'aimhire',
  'mercaccount',
  'merchire',
  'mercpay',
  'bobbyrestock',
  'bobbyfresh',
  'bobbyorder',
  'bobbydeliver',
  'setfact',
  'insure',
  'insuranceday',
  'payout',
  'insurancestep',
  'impcreate',
  'flowers',
]);

const LAPTOP_EVENTS: ReadonlySet<number> = new Set([
  EventKind.BOBBYRAY_PURCHASE,
  EventKind.UPDATE_BOBBY_RAY_INVENTORY,
  EventKind.DAY3_ADD_EMAIL_FROM_SPECK,
  EventKind.DELAYED_HIRING_OF_MERC,
  EventKind.PAY_LIFE_INSURANCE_FOR_DEAD_MERC,
  EventKind.DAY2_ADD_EMAIL_FROM_IMP,
  EventKind.MERC_COMPLAIN_EQUIPMENT,
  EventKind.SET_BY_NPC_SYSTEM,
  EventKind.INSURANCE_INVESTIGATION_STARTED,
  EventKind.INSURANCE_INVESTIGATION_OVER,
  EventKind.MERC_SITE_BACK_ONLINE,
  EventKind.HAVENT_MADE_IMP_CHARACTER_EMAIL,
  EventKind.MERC_SITE_NEW_MERC_AVAILABLE,
]);
const DELIVERY_FACTS = [
  Fact.PABLOS_STOLE_FROM_LATEST_SHIPMENT,
  Fact.LAST_SHIPMENT_CRASHED,
  Fact.LAST_SHIPMENT_WENT_TO_WRONG_AIRPORT,
  Fact.AGENTS_PREVENTED_SHIPMENT,
  Fact.MEDIUM_SIZED_SHIPMENT_WAITING,
  Fact.LARGE_SIZED_SHIPMENT_WAITING,
  Fact.REALLY_NEW_BOBBYRAY_SHIPMENT_WAITING,
  Fact.LARGE_SIZED_OLD_SHIPMENT_WAITING,
];
const MERC_KEYS = [
  'id',
  'profile',
  'kind',
  'assignment',
  'life',
  'lifeMax',
  'sector',
  'betweenSectors',
  'end',
  'start',
  'total',
  'type',
  'arrive',
  'deposit',
  'insurance',
];
const LOST_SHIPMENT_GRIDNO = 2;
const DEFAULT_CONTRACT_DAYS = 7;
const ARRIVAL_PROBE_DAY = 2;
const ARRIVAL_PROBE_MINUTE = 30;
const HOURS = 24;
const NO_QUOTE = 65535;
const NO_TEXT_FILE_STATUS = -1;
const FACE_DRAWS = [30, 2, 2000];
const ANIMATION_FRAME_DRAW = 10;
const FEMALE_BATTLE_SOUND_DRAW = 2;
const HIRED_OK = 1;
const HIRE_FUNDS_SHORT = -2;
const MESSAGE_LIMIT = 12;
const IMP_ATTRIBUTE_ORDER = [
  'health',
  'agility',
  'dexterity',
  'strength',
  'wisdom',
  'leadership',
  'marksmanship',
  'medical',
  'mechanical',
  'explosives',
] as const;

function report(label: string, same: boolean, detail: string): number {
  console.log(`${label}: ${same ? 'ok' : 'MISMATCH'} ${detail}`);
  return same ? 0 : 1;
}

const args = (p: Json): Record<string, string> => (p.args ?? {}) as Record<string, string>;
const num = (v: string | undefined, fallback: number) => (v === undefined ? fallback : Number(v));
const bit = (v: boolean) => (v ? 1 : 0);

function rollSource(stream: ReplayStream): RollSource {
  return { int: (n) => stream.int(n), chance: (percent) => stream.int(100) < percent };
}

function streams(draws: readonly Draw[]): { readonly main: ReplayStream; readonly pre: ReplayStream } {
  const main: TracedDraw[] = [];
  const pre: TracedDraw[] = [];
  for (const [stream, n, v] of draws) {
    if (stream === 'm') main.push({ n, v });
    else if (stream === 'p') pre.push({ n, v });
  }
  return { main: new ReplayStream('main', main), pre: new ReplayStream('pre', pre) };
}

function isFaceAt(draws: readonly Draw[], i: number): boolean {
  return FACE_DRAWS.every((n, k) => draws[i + k]?.[0] === 'm' && draws[i + k]?.[1] === n);
}

function withoutFaceDraws(draws: readonly Draw[]): Draw[] {
  const out: Draw[] = [];
  for (let i = 0; i < draws.length; i++) {
    if (isFaceAt(draws, i)) i += FACE_DRAWS.length - 1;
    else out.push(draws[i] as Draw);
  }
  return out;
}

function withoutCosmeticHireDraws(draws: readonly Draw[]): Draw[] {
  const out: Draw[] = [];
  let dropAnimationFrame = false;
  for (let i = 0; i < draws.length; i++) {
    const d = draws[i] as Draw;
    if (isFaceAt(draws, i)) {
      i += FACE_DRAWS.length - 1;
      dropAnimationFrame = true;
      continue;
    }
    if (dropAnimationFrame && d[0] === 'm' && d[1] === ANIMATION_FRAME_DRAW) {
      dropAnimationFrame = false;
      continue;
    }
    if (dropAnimationFrame && !(d[0] === 'm' && d[1] === FEMALE_BATTLE_SOUND_DRAW)) dropAnimationFrame = false;
    out.push(d);
  }
  return out;
}

function sortedEvents(events: readonly (readonly number[])[]): number[][] {
  return [...events].map((e) => [...e]).sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0) || (a[1] ?? 0) - (b[1] ?? 0) || (a[2] ?? 0) - (b[2] ?? 0));
}

function laptopDump(flow: LaptopFlow): Json {
  const l = flow.laptop;
  const s = flow.state;
  const m = l.merc;
  const br = l.bobbyRay;
  const listed = (list: readonly number[]) => list.filter((p) => p !== NO_PERSONNEL_ENTRY);
  return {
    newGame: l.newGameLaptop,
    bookmarks: [...l.bookmarks],
    balance: s.finances.balance,
    imp: [bit(l.imp.completed), bit(l.imp.sentImpWarningAlready)],
    personnel: { dead: listed(l.personnel.dead), left: listed(l.personnel.left), other: listed(l.personnel.other) },
    merc: [
      m.accountStatus,
      m.lastMercIndex,
      m.lastMercAvailableId,
      m.totalMoneyPaidToSpeck,
      bit(m.siteHasGoneDownYet),
      m.firstVisitSinceServerWentDown,
      bit(m.newMercsAvailable),
      m.playerBeenToSiteStatus,
      m.speckQuoteFlags,
      m.speckCanSayPlayersLostQuote,
      bit(m.saidGenericOpening),
      bit(m.speckSaidFloMarriedCousinQuote),
      bit(m.hasAMercDiedAtSite),
    ],
    bobbyRay: [bit(br.siteCanBeAccessed), br.underConstructionVisit],
    newStock: br.inventory.map((x) => [x.item, x.onHand, x.onOrder, x.quality, bit(x.previouslyEligible)]),
    usedStock: br.used.map((x) => [x.item, x.onHand, x.onOrder, x.quality, bit(x.previouslyEligible)]),
    shipments: br.shipments.map((o) => ({
      active: o.active,
      destination: o.destination,
      speed: o.speed,
      lines: o.lines.map((x) => [x.item, x.count, x.quality, x.slot, bit(x.used)]),
      weight: o.weight,
      day: o.orderDay,
      shown: o.displayedOnShipmentsPage,
    })),
    payouts: l.insurance.payouts.map((p) => [bit(p.active), p.soldier, p.profile, p.payout]),
    payoutsUsed: l.insurance.used,
    mails: l.emails.map((x) => [x.offset, x.length, x.sender, x.date, x.firstData, x.secondData, bit(x.read)]),
    arriveSector: l.mercArriveSector,
    hired: s.atLeastOneMercHired,
    events: sortedEvents(s.queue.events.filter((e) => LAPTOP_EVENTS.has(e.kind)).map((e) => [e.stamp, e.kind, e.param])),
    worldMinutes: worldTotalMinutes(s.clock),
  };
}

function oracleLaptop(p: Json): Json {
  const l = { ...(p.laptop as Json) };
  l.events = sortedEvents(l.events as number[][]);
  return l;
}

function laptopEntered(p: Json): Json {
  const laptop = p.laptop as Json;
  const bookmarks = laptop.bookmarks as number[];
  if (bookmarks.includes(Bookmark.AIM)) return p;
  return { ...p, laptop: { ...laptop, bookmarks: [...bookmarks, Bookmark.AIM] } };
}

function profileDump(flow: LaptopFlow, id: number, p: ProfileProgress): Json {
  const t = p.stats;
  return {
    id,
    status: p.mercStatus,
    available: p.dayBecomesAvailable,
    salaries: [p.salary, p.weeklySalary, p.biWeeklySalary],
    deposit: [p.medicalDeposit, p.medicalDepositAmount],
    gear: p.optionalGearCost,
    competence: calcCompetence(p),
    attractiveness: [p.mainGunAttractiveness, p.armourAttractiveness],
    flags: p.miscFlags,
    flags3: p.miscFlags3,
    hangover: p.daysOfMoraleHangover,
    precedent: p.precedentQuoteSaid,
    mercDays: p.mercMercContractLength,
    sector: [p.sectorX, p.sectorY, p.sectorZ],
    traits: [p.skillTrait, p.skillTrait2, p.personalityTrait, p.attitude, flow.profileRecord(id)?.bodyType ?? 0, p.sex],
    stats: [
      t.lifeMax,
      t.agility,
      t.dexterity,
      t.wisdom,
      t.medical,
      t.explosives,
      t.mechanical,
      t.marksmanship,
      t.experience,
      t.strength,
      t.leadership,
      p.life,
    ],
    inventory: [...p.inventory],
    invStatus: [...p.inventoryStatus],
    invCount: [...p.inventoryCount],
    taken: flow.laptop.imp.taken.includes(id),
  };
}

function mercDump(m: RosterMerc): Json {
  const c = m.contract;
  const s = m.soldier;
  return {
    id: m.id,
    profile: m.profile,
    kind: m.kind,
    assignment: m.assignment,
    life: s.life,
    lifeMax: s.lifeMax,
    sector: [m.sector.x, m.sector.y, m.sector.z],
    betweenSectors: m.betweenSectors,
    end: c.contractEnd,
    start: c.contractStartDay,
    total: c.totalContractLength,
    type: c.typeOfLastContract,
    arrive: c.timeWillArrive,
    deposit: c.medicalDeposit,
    insurance: [c.lifeInsurance, c.startOfInsuranceContract, c.totalLengthOfInsuranceContract, c.startTimeOfInsuranceContract],
    inv: s.inv.map((o) => (o ? [o.item, o.count, o.status[0] ?? 0] : [0, 0, 0])),
  };
}

function oracleMerc(merc: Json, inventory: unknown): Json {
  const out: Json = {};
  for (const key of MERC_KEYS) out[key] = merc[key];
  out.inv = inventory;
  return out;
}

function diff(ours: unknown, theirs: unknown): string[] {
  const diffs: string[] = [];
  const walk = (path: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && typeof a[0] === 'object') {
      for (const [i, v] of a.entries()) walk(`${path}[${i}]`, v, b[i]);
      return;
    }
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a)) {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(`${path}.${k}`, (a as Json)[k], (b as Json)[k]);
      return;
    }
    diffs.push(`${path}: ours ${JSON.stringify(a)} oracle ${JSON.stringify(b)}`);
  };
  walk('', ours, theirs);
  return diffs;
}

function patchStreams(state: StrategicState, rng: { readonly main: ReplayStream; readonly pre: ReplayStream }): () => void {
  const main = state.rng as unknown as Record<string, unknown>;
  const pre = state.pre as unknown as Record<string, unknown>;
  main.int = (n: number) => rng.main.int(n);
  main.coinToss = () => {
    throw new DrawMismatch('main', rng.main.position, 'coin toss requested');
  };
  pre.int = (n: number) => rng.pre.int(n);
  return () => {
    delete main.int;
    delete main.coinToss;
    delete pre.int;
  };
}

export class LaptopComparer {
  readonly #read: ReadFile;
  readonly #exists: FileExists;
  #bytes: Uint8Array | null = null;
  #campaign: CampaignSim | null = null;
  #shipmentsSinceNoBribes = 0;

  constructor(read: ReadFile, exists: FileExists) {
    this.#read = read;
    this.#exists = exists;
  }

  loadSave(bytes: Uint8Array): void {
    this.#keepTheftCounter();
    this.#bytes = bytes;
    this.#campaign = null;
  }

  #keepTheftCounter(): void {
    const flow = this.#campaign?.laptop;
    if (flow) this.#shipmentsSinceNoBribes = flow.laptop.bobbyRay.shipmentsSinceNoBribes;
  }

  async #session(): Promise<LaptopFlow> {
    if (!this.#campaign) {
      if (!this.#bytes) throw new Error('laptop probes need a save or a new game');
      const { session } = await createTacticalSaveSession(this.#read, this.#bytes, 1, this.#exists);
      this.#campaign = session.campaign;
      const flow = this.#campaign.laptop;
      if (flow) flow.laptop.bobbyRay.shipmentsSinceNoBribes = this.#shipmentsSinceNoBribes;
    }
    const flow = this.#campaign.laptop;
    if (!flow) throw new Error('the save session has no laptop');
    return flow;
  }

  #replay(flow: LaptopFlow, draws: readonly Draw[], run: () => void): string | null {
    const rng = streams(draws);
    const random: LaptopRandom = { main: rollSource(rng.main), pre: rollSource(rng.pre) };
    flow.useRandom(random);
    try {
      run();
    } catch (e) {
      if (e instanceof DrawMismatch) return e.message;
      throw e;
    } finally {
      flow.useRandom(null);
    }
    if (rng.main.remaining || rng.pre.remaining) return `${rng.main.remaining} main and ${rng.pre.remaining} PreRandom draws left over`;
    return null;
  }

  #compareState(label: string, flow: LaptopFlow, p: Json, extra: { ours: Json; theirs: Json } | null, replay: string | null): number {
    const ours: Json = { laptop: laptopDump(flow) };
    const theirs: Json = { laptop: oracleLaptop(p) };
    const team = flow.team();
    const oracleMercs = (p.mercs as Json[] | undefined) ?? [];
    const inventories = (p.inventories as unknown[] | undefined) ?? [];
    ours.mercs = team.map((m) => mercDump(m));
    theirs.mercs = oracleMercs.map((m, i) => oracleMerc(m, inventories[i]));
    const profiles = (p.profiles as Json[] | undefined) ?? [];
    const ourProfiles: Json[] = [];
    const theirProfiles: Json[] = [];
    for (const native of profiles) {
      const id = Number(native.id);
      const mine = flow.profile(id);
      if (!mine && native.status === NO_TEXT_FILE_STATUS) continue;
      ourProfiles.push(mine ? profileDump(flow, id, mine) : { id, missing: true });
      theirProfiles.push(native);
    }
    ours.profiles = ourProfiles;
    theirs.profiles = theirProfiles;
    if (extra) {
      ours.result = extra.ours;
      theirs.result = extra.theirs;
    }
    const diffs = diff(ours, theirs);
    if (replay) diffs.unshift(`draws: ${replay}`);
    const detail = `${team.length} mercs, ${ourProfiles.length} profiles`;
    return report(label, diffs.length === 0, diffs.length === 0 ? detail : `${detail}\n  ${diffs.slice(0, MESSAGE_LIMIT).join('\n  ')}`);
  }

  async #newGame(p: Json): Promise<number> {
    this.#keepTheftCounter();
    const a = args(p);
    const rng = streams(withoutFaceDraws((p.draws as Draw[] | undefined) ?? []));
    let restore: (() => void) | null = null;
    let replay: string | null = null;
    try {
      const built = await buildNewCampaign(this.#read, this.#exists, () => {
        const state = createStrategicState({
          options: gameOptions({ difficulty: num(a.difficulty, 2), gunNut: num(a.gunnut, 0) !== 0, sciFi: num(a.scifi, 1) !== 0 }),
        });
        restore = patchStreams(state, rng);
        return state;
      });
      this.#campaign = built.campaign;
    } catch (e) {
      if (!(e instanceof DrawMismatch)) throw e;
      replay = e.message;
    } finally {
      (restore as (() => void) | null)?.();
    }
    this.#bytes = null;
    if (!replay && (rng.main.remaining || rng.pre.remaining))
      replay = `${rng.main.remaining} main and ${rng.pre.remaining} PreRandom draws left over`;
    const flow = this.#campaign?.laptop;
    const label = `newgamefull line ${p.line} difficulty ${a.difficulty ?? 2}`;
    if (!flow || replay) return report(label, false, replay ?? 'no laptop');
    const result = p.result as Json;
    const terrorists = flow.state.terrorists;
    const ours = {
      terrorists: (result.terrorists as number[][]).map(([pid = 0]) => {
        const p = flow.profile(pid);
        return [pid, p?.sectorX ?? 0, p?.sectorY ?? 0];
      }),
      count: terrorists.count,
    };
    return this.#compareState(label, flow, laptopEntered(p), { ours, theirs: result }, null);
  }

  #arrival(p: Json): number {
    const ours = Array.from({ length: HOURS }, (_, hour) =>
      mercArrivalTimeOfDay(ARRIVAL_PROBE_DAY * NUM_MIN_IN_DAY + hour * NUM_MIN_IN_HOUR + ARRIVAL_PROBE_MINUTE),
    );
    const theirs = p.times as number[];
    const same = JSON.stringify(ours) === JSON.stringify(theirs);
    return report(
      `arrival line ${p.line}`,
      same,
      same ? `${HOURS} hours` : `ours ${JSON.stringify(ours)} oracle ${JSON.stringify(theirs)}`,
    );
  }

  #merc(flow: LaptopFlow, who: string | undefined): RosterMerc {
    const m = flow.roster.get(Number(who));
    if (!m) throw new Error(`no merc ${who}`);
    return m;
  }

  #aimHire(flow: LaptopFlow, p: Json): { ours: Json; theirs: Json; replay: string | null } {
    const a = args(p);
    const profile = Number(a.profile);
    const contract = num(a.contract, DEFAULT_CONTRACT_DAYS);
    const gear = a.gear === undefined ? undefined : a.gear !== '0';
    const r = p.result as Json;
    let ours: Json = {};
    const replay = this.#replay(flow, withoutCosmeticHireDraws((p.draws as Draw[]) ?? []), () => {
      const result = aimHire(flow, { profile, contract, gear }, flow.hireHooks());
      const quote = result.ok ? (result.quote?.id ?? NO_QUOTE) : NO_QUOTE;
      const accepted = result.ok || result.reason === 'funds';
      ours = {
        accepted,
        quote,
        hired: result.ok ? HIRED_OK : result.reason === 'funds' ? HIRE_FUNDS_SHORT : result.reason,
        amount: result.ok ? result.charge.total : (result.charge?.total ?? null),
      };
    });
    return { ours, theirs: { accepted: r.accepted, quote: r.quote, hired: r.hired, amount: r.amount }, replay };
  }

  #impCreate(flow: LaptopFlow, p: Json): { ours: Json; theirs: Json; replay: string | null } {
    const a = args(p);
    const values = (a.attrs ?? '').split(',').map(Number);
    const attributes = Object.fromEntries(IMP_ATTRIBUTE_ORDER.map((k, i) => [k, values[i] ?? 0])) as unknown as ImpAttributes;
    let ours: Json = {};
    const replay = this.#replay(flow, withoutCosmeticHireDraws((p.draws as Draw[]) ?? []), () => {
      const result = impCreate(
        flow,
        {
          code: flow.content.imp.codes[0] ?? '',
          name: a.name ?? '',
          nickname: a.nick,
          gender: a.gender === 'female' ? 'female' : 'male',
          answers: (a.answers ?? '').split(',').map(Number),
          attributes,
          portrait: num(a.portrait, 0),
          voice: num(a.voice, 0),
        },
        flow.hireHooks(),
      );
      ours = { slot: result.ok ? result.profile : result.reason };
    });
    return { ours, theirs: p.result as Json, replay };
  }

  #bobbyOrder(flow: LaptopFlow, p: Json): { ours: Json; theirs: Json; replay: string | null } {
    const a = args(p);
    const lines = (a.lines ?? '').split(',').map((line) => {
      const [item = 0, quantity = 0, used = 0] = line.split(':').map(Number);
      return { item, quantity, used: used !== 0 };
    });
    let ours: Json = {};
    const replay = this.#replay(flow, (p.draws as Draw[]) ?? [], () => {
      const result = purchaseBobbyRayOrder(flow, { lines, destination: Number(a.dest), speed: num(a.speed, 0) });
      const quote = result.quote;
      ours = {
        subtotal: quote?.subtotal ?? null,
        shipping: quote?.shipping ?? null,
        total: result.ok ? quote?.total : result.reason === 'funds' ? -1 : result.reason,
      };
    });
    return { ours, theirs: p.result as Json, replay };
  }

  #bobbyDeliver(flow: LaptopFlow, p: Json): { ours: Json; theirs: Json; replay: string | null } {
    const index = num(args(p).index, 0);
    const shipment = flow.laptop.bobbyRay.shipments[index];
    const grid = shipment ? (flow.content.destinations[shipment.destination]?.gridNo ?? -1) : -1;
    const tactical = flow.campaign.tactical;
    const replay = this.#replay(flow, (p.draws as Draw[]) ?? [], () => bobbyRayPurchaseEvent(flow, index, tactical));
    const items = (tactical?.state.worldItems ?? [])
      .filter((w) => w.gridNo === grid || w.gridNo === LOST_SHIPMENT_GRIDNO)
      .map((w) => [w.gridNo, w.object.item, w.object.count, w.object.status[0] ?? 0, w.visible]);
    const r = p.result as Json;
    return {
      ours: { facts: DELIVERY_FACTS.map((f) => factValue(flow.state.narrative, f)), worldItems: items },
      theirs: { facts: r.facts, worldItems: r.worldItems },
      replay,
    };
  }

  #insure(flow: LaptopFlow, p: Json): { ours: Json; theirs: Json; replay: string | null } {
    const a = args(p);
    const m = this.#merc(flow, a.who);
    const profile = flow.profile(m.profile) as ProfileProgress;
    const length = insuranceLength(flow, m);
    const cost = insurancePremium(flow, length, m, profile);
    if (num(a.buy, 1) !== 0 && length > 0) purchaseOrExtendInsurance(flow, m, length);
    return { ours: { length, cost }, theirs: p.result as Json, replay: null };
  }

  #flowers(flow: LaptopFlow, p: Json): { ours: Json; theirs: Json; replay: string | null } {
    const a = args(p);
    const extras = String(a.extras ?? '')
      .split(',')
      .filter((e) => e.length > 0);
    const order = { bouquet: num(a.flower, 0), destination: num(a.dest, 0), nextDay: num(a.nextday, 0) !== 0, extras };
    const before = flow.laptop.floristOrderNumber;
    let entered = 0;
    let price: number | string = 0;
    const replay = this.#replay(flow, (p.draws as Draw[]) ?? [], () => {
      entered = enterFloristOrderForm(flow);
      const result = orderFlowers(flow, order, { flowersMeanwhile: (code) => flow.campaign.scheduleFlowersMeanwhile(code) });
      price = typeof result === 'string' ? result : result.price;
    });
    return { ours: { before, entered, price, sent: flow.laptop.floristOrderNumber }, theirs: p.result as Json, replay };
  }

  #insuranceStep(flow: LaptopFlow, p: Json): string | null {
    const a = args(p);
    const slot = num(a.slot, 0);
    return this.#replay(flow, (p.draws as Draw[]) ?? [], () => {
      if (a.step === 'start') startInsuranceInvestigation(flow, slot);
      else if (a.step === 'end') endInsuranceInvestigation(flow, slot);
      else payLifeInsuranceForDeadMerc(flow, slot);
    });
  }

  async compare(p: Json): Promise<number> {
    if (p.probe === 'newgamefull') return this.#newGame(p);
    if (p.probe === 'arrival') return this.#arrival(p);
    const flow = await this.#session();
    const a = args(p);
    const label = `${p.probe} line ${p.line}`;
    const draws = (p.draws as Draw[] | undefined) ?? [];
    switch (p.probe) {
      case 'setbalance': {
        const f = flow.state.finances;
        addTransaction(f, FinanceCode.ANONYMOUS_DEPOSIT, 0, flow.now(), Number(p.balance) - f.balance);
        return 0;
      }
      case 'setfact':
        setFact(flow.state.narrative, Number(p.id), Number(p.value));
        return 0;
      case 'laptop':
        return this.#compareState(label, flow, p, null, null);
      case 'aimhire': {
        const r = this.#aimHire(flow, p);
        return this.#compareState(label, flow, p, r, r.replay);
      }
      case 'mercaccount':
        return this.#compareState(
          label,
          flow,
          p,
          null,
          this.#replay(flow, draws, () => openMercAccount(flow)),
        );
      case 'merchire': {
        let ours: Json = {};
        const replay = this.#replay(flow, withoutCosmeticHireDraws(draws), () => {
          ours = { hired: hireMercMerc(flow, Number(a.profile), flow.hireHooks()).ok };
        });
        return this.#compareState(label, flow, p, { ours, theirs: p.result as Json }, replay);
      }
      case 'mercpay': {
        const total = mercDebts(flow).reduce((sum, d) => sum + d.owed, 0);
        const replay = this.#replay(flow, draws, () => payMercAccounts(flow));
        return this.#compareState(label, flow, p, { ours: { total }, theirs: p.result as Json }, replay);
      }
      case 'bobbyrestock':
        return this.#compareState(
          label,
          flow,
          p,
          null,
          this.#replay(flow, draws, () => flow.bobbyRayDaily()),
        );
      case 'bobbyfresh':
        return this.#compareState(
          label,
          flow,
          p,
          null,
          this.#replay(flow, draws, () => addFreshBobbyRayInventory(flow, Number(a.param))),
        );
      case 'bobbyorder': {
        const r = this.#bobbyOrder(flow, p);
        return this.#compareState(label, flow, p, r, r.replay);
      }
      case 'bobbydeliver': {
        const r = this.#bobbyDeliver(flow, p);
        return this.#compareState(label, flow, p, r, r.replay);
      }
      case 'insure': {
        const r = this.#insure(flow, p);
        return this.#compareState(label, flow, p, r, r.replay);
      }
      case 'insuranceday':
        dailyUpdateOfInsuredMercs(flow);
        return this.#compareState(label, flow, p, null, null);
      case 'payout': {
        const m = this.#merc(flow, a.who);
        const profile = flow.profile(m.profile);
        if (profile && a.suspicious !== undefined) profile.suspiciousDeath = Number(a.suspicious);
        addLifeInsurancePayout(flow, m);
        return this.#compareState(label, flow, p, null, null);
      }
      case 'insurancestep':
        return this.#compareState(label, flow, p, null, this.#insuranceStep(flow, p));
      case 'impcreate': {
        const r = this.#impCreate(flow, p);
        return this.#compareState(label, flow, p, r, r.replay);
      }
      case 'flowers': {
        const r = this.#flowers(flow, p);
        return this.#compareState(label, flow, p, r, r.replay);
      }
      default:
        return 0;
    }
  }
}
