import type { ReadFile } from '../../src/content/world/tileset-loader.ts';
import { idiv } from '../../src/core/int.ts';
import type { FileExists } from '../../src/server/world-cache.ts';
import type { CampaignSim } from '../../src/sim/campaign/campaign-sim.ts';
import type { ContractFlow } from '../../src/sim/campaign/contracts/contract-flow.ts';
import {
  clockReading,
  contractIsExpiring,
  contractIsGoingToExpireSoon,
  hourWhenContractDone,
} from '../../src/sim/campaign/contracts/contract-times.ts';
import { mercDailyUpdate, soldierHasWorseEquipmentThanUsedTo } from '../../src/sim/campaign/contracts/daily.ts';
import {
  beginRemoveMercFromContract,
  handleEquipmentLeft,
  handleLeavingOfEquipmentInCurrentSector,
  handleMercLeavingEquipment,
  PRIMARY_AIRPORT_LEAVE_EQUIP_GRIDNO,
  primaryAirportSector,
  START_SECTOR_LEAVE_EQUIP_GRIDNO,
  strategicRemoveMerc,
} from '../../src/sim/campaign/contracts/departure.ts';
import type { MercLeftEvent } from '../../src/sim/campaign/contracts/events.ts';
import { mercContractHandling } from '../../src/sim/campaign/contracts/extension.ts';
import { dailyUpdateOfMercSite } from '../../src/sim/campaign/contracts/merc-account.ts';
import { HistoryCode, QUOTE_NONE, Quote } from '../../src/sim/campaign/contracts/quotes.ts';
import {
  canExtendContractForSoldier,
  type ExtensionChoice,
  findOutIfAnyMercAboutToLeaveIsGonnaRenew,
  findRefusalReason,
  willMercRenew,
} from '../../src/sim/campaign/contracts/renewal.ts';
import { calcNewSalary } from '../../src/sim/campaign/contracts/salary.ts';
import { addTransaction, FinanceCode } from '../../src/sim/campaign/finances.ts';
import { offMapCombatContext } from '../../src/sim/campaign/off-map-combat.ts';
import { getFirstBuddyOnTeam } from '../../src/sim/campaign/relations/relations.ts';
import {
  calcDeathRate,
  mercThinksBadReputationTooHigh,
  mercThinksDeathRateTooHigh,
  mercThinksHisMoraleIsTooLow,
} from '../../src/sim/campaign/relations/reputation.ts';
import type { RosterMerc } from '../../src/sim/campaign/roster.ts';
import { DrawMismatch, ReplayStream, type TracedDraw } from '../../src/sim/strategic/forces/autoresolve/replay-rng.ts';
import { EventKind, NUM_MIN_IN_DAY, NUM_SEC_IN_MIN, Warp } from '../../src/sim/strategic/time/constants.ts';
import { warpGameTime, worldTotalMinutes } from '../../src/sim/strategic/time/world-clock.ts';
import { processUpdateStats } from '../../src/sim/tactical/combat/experience.ts';
import type { ProfileProgress } from '../../src/sim/tactical/profiles.ts';
import { NO_PROFILE } from '../../src/sim/tactical/soldier.ts';
import { createTacticalSaveSession } from './tactical-import.ts';

type Json = Record<string, unknown>;
type Draw = readonly [string, number, number, number];

export const CONTRACT_PROBES: ReadonlySet<string> = new Set([
  'contracts',
  'profiles',
  'dailyupdate',
  'relationshours',
  'settime',
  'aboutleave',
  'beginrenewal',
  'renewalstep',
  'setcontract',
  'setstatus',
  'setprofilecontract',
  'extend',
  'beginremove',
  'removemerc',
  'leaveequip',
  'equipleft',
  'mercsite',
  'levelup',
  'salary',
  'setrenewals',
]);

const CONTRACT_EVENTS: ReadonlySet<number> = new Set([
  EventKind.MERC_COMPLAIN_EQUIPMENT,
  EventKind.MERC_LEAVE_EQUIP_IN_OMERTA,
  EventKind.MERC_LEAVE_EQUIP_IN_DRASSEN,
  EventKind.MERC_ABOUT_TO_LEAVE,
  EventKind.BEGIN_CONTRACT_RENEWAL_SEQUENCE,
  EventKind.RPC_WHINE_ABOUT_PAY,
  EventKind.MERC_MERC_WENT_UP_LEVEL_EMAIL_DELAY,
]);
const RELATION_SLOTS = 5;
const SUBPOINTS_PER_LEVEL = 350;
const NUM_PROFILES_DUMPED = 255;
const DRAWLESS_PROBES: ReadonlySet<string> = new Set(['mercsite']);
const MESSAGE_LIMIT = 12;

function report(label: string, same: boolean, detail: string): number {
  console.log(`${label}: ${same ? 'ok' : 'MISMATCH'} ${detail}`);
  return same ? 0 : 1;
}

const args = (p: Json): Record<string, string> => (p.args ?? {}) as Record<string, string>;
const num = (v: string | undefined, fallback: number) => (v === undefined ? fallback : Number(v));

function streams(draws: readonly Draw[]): { readonly main: ReplayStream; readonly pre: ReplayStream } {
  const main: TracedDraw[] = [];
  const pre: TracedDraw[] = [];
  for (const [stream, n, v] of draws) {
    if (stream === 'm') main.push({ n, v });
    else if (stream === 'p') pre.push({ n, v });
  }
  return { main: new ReplayStream('main', main), pre: new ReplayStream('pre', pre) };
}

function slots(values: readonly number[]): number[] {
  return Array.from({ length: RELATION_SLOTS }, (_, k) => values[k] ?? 0);
}

function sortedEvents(events: readonly (readonly number[])[]): string {
  return JSON.stringify(
    [...events].map((e) => [...e]).sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0) || (a[1] ?? 0) - (b[1] ?? 0) || (a[2] ?? 0) - (b[2] ?? 0)),
  );
}

export class ContractComparer {
  readonly #read: ReadFile;
  readonly #exists: FileExists;
  #bytes: Uint8Array | null = null;
  #campaign: CampaignSim | null = null;

  constructor(read: ReadFile, exists: FileExists) {
    this.#read = read;
    this.#exists = exists;
  }

  loadSave(bytes: Uint8Array): void {
    this.#bytes = bytes;
    this.#campaign = null;
  }

  async #session(): Promise<CampaignSim> {
    if (this.#campaign) return this.#campaign;
    if (!this.#bytes) throw new Error('contract probes need a save');
    const { session } = await createTacticalSaveSession(this.#read, this.#bytes, 1, this.#exists);
    this.#campaign = session.campaign;
    return this.#campaign;
  }

  #mercView(flow: ContractFlow, m: RosterMerc): Json {
    const c = m.contract;
    const s = m.soldier;
    const p = flow.profile(m.profile);
    const now = clockReading(worldTotalMinutes(flow.state.clock));
    const status = flow.state.status;
    const refusal = p ? findRefusalReason(flow, m) : null;
    return {
      id: m.id,
      profile: m.profile,
      kind: m.kind,
      assignment: m.assignment,
      life: s.life,
      lifeMax: s.lifeMax,
      morale: s.morale,
      sector: [m.sector.x, m.sector.y, m.sector.z],
      betweenSectors: m.betweenSectors,
      end: c.contractEnd,
      start: c.contractStartDay,
      total: c.totalContractLength,
      type: c.typeOfLastContract,
      canSign: c.timeCanSignElsewhere,
      signed: c.signedAnotherContract,
      lastUpdate: c.lastContractUpdate,
      arrive: c.timeWillArrive,
      quoteCode: c.renewalQuoteCode,
      leaveCode: c.leaveHistoryCode,
      deposit: c.medicalDeposit,
      priceUp: c.contractPriceIncreased,
      insurance: [c.lifeInsurance, c.startOfInsuranceContract, c.totalLengthOfInsuranceContract, c.startTimeOfInsuranceContract],
      quoteFlags: m.quoteSaidFlags,
      corpseTolerance: m.corpseQuoteTolerance,
      hour: hourWhenContractDone(c.timeWillArrive),
      expiring: contractIsExpiring(c, now),
      soon: contractIsGoingToExpireSoon(c, now),
      refusal: refusal ? Quote[refusal.quote] : QUOTE_NONE,
      willRenew: p !== null && willMercRenew(flow, m, false),
      buddy: p ? getFirstBuddyOnTeam({ team: flow.team(), profiles: flow.state.profiles }, p) : -1,
      deathRateTooHigh: p !== null && mercThinksDeathRateTooHigh(status, p),
      reputationTooHigh: p !== null && mercThinksBadReputationTooHigh(status, p),
      moraleTooLow: p !== null && mercThinksHisMoraleIsTooLow(p, s.morale),
      worseEquipment: p !== null && soldierHasWorseEquipmentThanUsedTo(flow, m, p),
      canExtend: canExtendContractForSoldier(m),
    };
  }

  #contractsView(flow: ContractFlow): Json {
    const s = flow.state;
    const seq = s.contracts.renewal;
    return {
      mercs: flow.team().map((m) => this.#mercView(flow, m)),
      renewal: { list: [...seq.list], on: seq.on, current: seq.current, inProgress: seq.inProgress, fromSequence: seq.fromSequence },
      deathRate: calcDeathRate(s.status),
      deaths: s.status.mercDeaths,
      manDays: s.status.manDaysPlayed,
      reputation: s.status.badReputation,
      unhiredDeaths: s.status.unhiredMercDeaths,
      account: s.laptop.merc.accountStatus,
      balance: s.finances.balance,
      leave: s.contracts.leaveList.map((l) => ({ owner: l.owner, items: l.items ? l.items.map((o) => o.item) : null })),
      events: s.queue.events.filter((e) => CONTRACT_EVENTS.has(e.kind)).map((e) => [e.stamp, e.kind, e.param]),
      worldMinutes: worldTotalMinutes(s.clock),
    };
  }

  #profileView(flow: ContractFlow, id: number): Json {
    const p = flow.profile(id) as ProfileProgress;
    const team = flow.team();
    const t = p.stats;
    const g = p.gains;
    return {
      id,
      status: p.mercStatus,
      available: p.dayBecomesAvailable,
      salaries: [p.salary, p.weeklySalary, p.biWeeklySalary],
      deposit: [p.medicalDeposit, p.medicalDepositAmount],
      hangover: p.daysOfMoraleHangover,
      precedent: p.precedentQuoteSaid,
      balance: p.balance,
      mercDays: p.mercMercContractLength,
      served: p.totalDaysServed,
      flags3: p.miscFlags3,
      suspicious: p.suspiciousDeath,
      cost: flow.state.finances.profileCostToDate.get(id) ?? 0,
      attractiveness: [p.mainGunAttractiveness, p.armourAttractiveness],
      tolerances: [p.deathRate, p.reputationTolerance],
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
      gains: [
        g.lifeMax,
        g.agility,
        g.dexterity,
        g.wisdom,
        g.medical,
        g.explosives,
        g.mechanical,
        g.marksmanship,
        g.experience,
        g.strength,
        g.leadership,
      ],
      hated: slots(p.hated),
      hatedTime: slots(p.hatedTime),
      hatedCount: slots(p.hatedCount),
      buddies: slots(p.buddies),
      learn: [
        p.learnToHate,
        p.learnToHateTime,
        p.learnToHateCount,
        p.learnToLike,
        p.learnToLikeTime,
        p.learnToLikeCount,
        p.timeTillNextHatedComplaint,
      ],
      opinions: team.filter((o) => o.profile !== NO_PROFILE && o.profile < NUM_PROFILES_DUMPED).map((o) => p.opinions[o.profile] ?? 0),
      inventory: [...p.inventory],
    };
  }

  #compare(label: string, ours: Json, theirs: Json, detail: string): number {
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
    return report(label, diffs.length === 0, diffs.length === 0 ? detail : `${detail}\n  ${diffs.slice(0, MESSAGE_LIMIT).join('\n  ')}`);
  }

  #replay(flow: ContractFlow, p: Json, run: () => void): string | null {
    if (DRAWLESS_PROBES.has(String(p.probe))) {
      run();
      return null;
    }
    const rng = streams((p.draws as Draw[] | undefined) ?? []);
    flow.useRandom(rng);
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

  #merc(flow: ContractFlow, a: Record<string, string>): RosterMerc {
    const m = flow.roster.get(Number(a.who));
    if (!m) throw new Error(`no merc ${a.who}`);
    return m;
  }

  #setContract(flow: ContractFlow, a: Record<string, string>): void {
    const m = this.#merc(flow, a);
    const c = m.contract;
    c.contractEnd = num(a.end, c.contractEnd);
    c.totalContractLength = num(a.total, c.totalContractLength);
    c.timeWillArrive = num(a.arrive, c.timeWillArrive);
    c.lastContractUpdate = num(a.lastUpdate, c.lastContractUpdate);
    c.timeCanSignElsewhere = num(a.canSign, c.timeCanSignElsewhere);
    c.signedAnotherContract = num(a.signed, c.signedAnotherContract ? 1 : 0) !== 0;
    c.renewalQuoteCode = num(a.quoteCode, c.renewalQuoteCode);
    c.typeOfLastContract = num(a.type, c.typeOfLastContract);
    c.contractPriceIncreased = num(a.priceUp, c.contractPriceIncreased ? 1 : 0) !== 0;
    c.medicalDeposit = num(a.deposit, c.medicalDeposit);
    m.soldier.life = num(a.life, m.soldier.life);
    m.soldier.bleeding = num(a.bleeding, m.soldier.bleeding);
    m.soldier.morale = num(a.morale, m.soldier.morale);
    m.assignment = num(a.assignment, m.assignment);
    c.lifeInsurance = num(a.insurance, c.lifeInsurance);
    if (a.kind !== undefined) Object.assign(m.record, { kind: Number(a.kind) });
  }

  #setProfile(flow: ContractFlow, a: Record<string, string>): void {
    const p = flow.profile(Number(a.who));
    if (!p) throw new Error(`no profile ${a.who}`);
    p.mercStatus = num(a.status, p.mercStatus);
    p.dayBecomesAvailable = num(a.available, p.dayBecomesAvailable);
    p.daysOfMoraleHangover = num(a.hangover, p.daysOfMoraleHangover);
    p.balance = num(a.balance, p.balance);
    p.mercMercContractLength = num(a.mercDays, p.mercMercContractLength);
    p.miscFlags3 = num(a.flags3, p.miscFlags3);
    p.salary = num(a.salary, p.salary);
    p.mainGunAttractiveness = num(a.gunAttractiveness, p.mainGunAttractiveness);
    Object.assign(p, { deathRate: num(a.deathRate, p.deathRate), reputationTolerance: num(a.repTolerance, p.reputationTolerance) });
    if (a.buddy !== undefined) {
      const [slot = 0, profile = -1] = a.buddy.split(':').map(Number);
      p.buddies[slot] = profile;
    }
    if (a.hated !== undefined) {
      const [slot = 0, profile = -1, time = 0, count = 0] = a.hated.split(':').map(Number);
      p.hated[slot] = profile;
      p.hatedTime[slot] = time;
      p.hatedCount[slot] = count;
    }
    if (a.learnhate !== undefined) {
      const [profile = -1, time = 0, count = 0] = a.learnhate.split(':').map(Number);
      p.learnToHate = profile;
      p.learnToHateTime = time;
      p.learnToHateCount = count;
    }
    if (a.opinion !== undefined) {
      const [about = 0, value = 0] = a.opinion.split(':').map(Number);
      p.opinions[about] = value;
    }
  }

  #setTime(flow: ContractFlow, a: Record<string, string>): void {
    const now = worldTotalMinutes(flow.state.clock);
    const target = num(a.hour, 0) * 60 + num(a.minute, 0);
    const today = idiv(now, NUM_MIN_IN_DAY) * NUM_MIN_IN_DAY;
    const at =
      a.day !== undefined
        ? Number(a.day) * NUM_MIN_IN_DAY + target
        : today + target > now
          ? today + target
          : today + NUM_MIN_IN_DAY + target;
    warpGameTime(flow.clockContext, (at - now) * NUM_SEC_IN_MIN, Warp.NO_PROCESSING);
  }

  #levelUp(c: CampaignSim, flow: ContractFlow, a: Record<string, string>): void {
    const m = this.#merc(flow, a);
    const p = flow.profile(m.profile);
    if (!p) return;
    p.gains.experience = SUBPOINTS_PER_LEVEL * p.stats.experience;
    const ctx = c.tactical?.state ?? offMapCombatContext(c.state, flow.content, c.experienceHooks);
    for (const other of flow.team()) processUpdateStats(ctx, other.soldier);
  }

  #removeMerc(flow: ContractFlow, a: Record<string, string>): MercLeftEvent | null {
    const m = this.#merc(flow, a);
    if (a.history !== undefined) m.contract.leaveHistoryCode = Number(a.history);
    flow.drainEvents();
    strategicRemoveMerc(flow, m, 'none');
    return (flow.drainEvents().find((e) => e.type === 'mercLeft') as MercLeftEvent | undefined) ?? null;
  }

  #run(c: CampaignSim, flow: ContractFlow, p: Json): { error: string | null; left: MercLeftEvent | null } {
    const a = args(p);
    let left: MercLeftEvent | null = null;
    const error = this.#replay(flow, p, () => {
      switch (p.probe) {
        case 'dailyupdate':
          mercDailyUpdate(flow);
          break;
        case 'relationshours':
          for (let i = 0; i < num(a.count, 1); i++) {
            c.battle?.updateBuddyAndHatedCounters();
            c.battle?.hourlyMoraleUpdate();
          }
          break;
        case 'settime':
          this.#setTime(flow, a);
          break;
        case 'aboutleave':
          findOutIfAnyMercAboutToLeaveIsGonnaRenew(flow);
          break;
        case 'beginrenewal':
          flow.beginRenewalSequence();
          break;
        case 'renewalstep':
          flow.renewalStep();
          break;
        case 'setcontract':
          this.#setContract(flow, a);
          break;
        case 'setstatus': {
          const status = flow.state.status;
          status.mercDeaths = num(a.deaths, status.mercDeaths);
          status.manDaysPlayed = num(a.manDays, status.manDaysPlayed);
          status.badReputation = num(a.reputation, status.badReputation);
          flow.state.laptop.merc.accountStatus = num(a.account, flow.state.laptop.merc.accountStatus);
          if (a.balance !== undefined)
            addTransaction(
              flow.state.finances,
              FinanceCode.ANONYMOUS_DEPOSIT,
              0,
              worldTotalMinutes(flow.state.clock),
              Number(a.balance) - flow.state.finances.balance,
            );
          break;
        }
        case 'setprofilecontract':
          this.#setProfile(flow, a);
          break;
        case 'extend':
          mercContractHandling(flow, this.#merc(flow, a), (a.length ?? 'week') as ExtensionChoice);
          break;
        case 'beginremove': {
          const m = this.#merc(flow, a);
          if (num(a.fired, 0)) m.contract.leaveHistoryCode = HistoryCode.MERC_FIRED;
          beginRemoveMercFromContract(flow, m);
          break;
        }
        case 'removemerc':
          left = this.#removeMerc(flow, a);
          break;
        case 'leaveequip': {
          const m = this.#merc(flow, a);
          if ((a.where ?? 'here') === 'here') handleLeavingOfEquipmentInCurrentSector(flow, m, c.tactical);
          else handleMercLeavingEquipment(flow, m, a.where === 'drassen');
          break;
        }
        case 'equipleft': {
          const drassen = a.where === 'drassen';
          const sector = drassen ? primaryAirportSector(flow) : flow.campaign.strategic?.content.policy.startSector;
          const target = typeof sector === 'number' ? { x: (sector % 16) + 1, y: idiv(sector, 16) + 1, z: 0 } : sector;
          if (target)
            handleEquipmentLeft(
              flow,
              Number(a.slot),
              target,
              drassen ? PRIMARY_AIRPORT_LEAVE_EQUIP_GRIDNO : START_SECTOR_LEAVE_EQUIP_GRIDNO,
              c.tactical,
            );
          break;
        }
        case 'mercsite':
          dailyUpdateOfMercSite(flow);
          break;
        case 'levelup':
          this.#levelUp(c, flow, a);
          break;
        case 'setrenewals': {
          const list = flow.state.contracts.renewal.list;
          list.splice(0, list.length, ...(a.profiles ?? '').split(',').filter(Boolean).map(Number));
          break;
        }
      }
    });
    return { error, left };
  }

  #selectedProfiles(flow: ContractFlow, p: Json, removed: number | null): number[] {
    const a = args(p);
    if (p.probe === 'setprofilecontract') return [Number(a.who)];
    let ids: number[];
    if (p.probe === 'profiles' && a.who !== undefined) ids = a.who.split(',').map(Number);
    else if (a.range !== undefined) {
      const [from = 0, to = 0] = a.range.split(':').map(Number);
      ids = Array.from({ length: to - from }, (_, k) => from + k);
    } else
      ids = flow
        .team()
        .filter((m) => m.profile !== NO_PROFILE)
        .map((m) => m.profile);
    return removed === null ? ids : [...ids, removed];
  }

  #personnelMatches(left: MercLeftEvent | null, theirs: Json): string | null {
    if (!left) return 'no mercLeft event';
    const lists = theirs as Record<string, number[]>;
    const list = lists[left.personnel] ?? [];
    return list.includes(left.profile) ? null : `profile ${left.profile} not in the oracle's ${left.personnel} list`;
  }

  async compare(p: Json): Promise<number> {
    const label = `${String(p.probe)} line ${String(p.line)}`;
    try {
      if (p.probe === 'salary') return this.#compareSalary(label, p);
      const c = await this.#session();
      const flow = c.contracts;
      if (!flow) return report(label, false, 'no contract flow');
      const removedProfile = p.probe === 'removemerc' ? (flow.roster.get(Number(args(p).who))?.profile ?? null) : null;
      const { error, left } = this.#run(c, flow, p);
      if (error) return report(label, false, error);
      if (p.probe === 'removemerc' && p.result) {
        const wrong = this.#personnelMatches(left, p.result as Json);
        if (wrong) return report(label, false, wrong);
      }
      const ours = this.#contractsView(flow);
      const theirs = p.contracts as Json;
      const oursEvents = sortedEvents(ours.events as number[][]);
      const theirEvents = sortedEvents(theirs.events as number[][]);
      const contracts = { ...ours, events: oursEvents };
      const oracle = { ...theirs, events: theirEvents };
      const profiles = this.#selectedProfiles(flow, p, removedProfile).map((id) => this.#profileView(flow, id));
      const detail = `${(ours.mercs as Json[]).length} mercs, ${profiles.length} profiles, renewal ${JSON.stringify((ours.renewal as Json).list)}`;
      return this.#compare(label, { contracts, profiles }, { contracts: oracle, profiles: p.profiles }, detail);
    } catch (e) {
      return report(label, false, e instanceof Error ? (e.stack ?? e.message) : String(e));
    }
  }

  #compareSalary(label: string, p: Json): number {
    const a = args(p);
    const max = num(a.max, 30000);
    const ours = (a.values ?? '').split(',').map((v) => calcNewSalary(Number(v), max));
    return report(
      label,
      JSON.stringify(ours) === JSON.stringify(p.salaries),
      `ours ${JSON.stringify(ours)} oracle ${JSON.stringify(p.salaries)}`,
    );
  }
}
