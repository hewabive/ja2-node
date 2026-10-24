// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Personnel.cc CFOR_EACH_PERSONNEL (our team without vehicles, dead or alive), DisplayCharName (the town
// @src of the sector unless POW or in transit), DisplayCharStats (the soldier's life, the profile's stats and deltas, kills,
// @src assists, shots, battles, wounds, the two skill traits), DisplayTeamStats (Attribute for the stats display: the
// @src soldier's values on the team, the profile's for departed mercs), DisplayCharInventory (the slots in order, the
// @src first status or the total rounds of a magazine stack), GetFundsOnMerc, DisplayEmploymentinformation (the time left
// @src capped at the contract length in transit, A.I.M. mercs and Slay; the salary by bTypeOfLastContract; the medical
// @src deposit or the M.E.R.C. amount owed), GetSelectedPastMercInfo (dead, fired, then the other list: married to Hicks,
// @src an A.I.M. merc whose contract expired, or quit), DisplayDepartedCharStats; Tactical/Soldier_Profile_Type.h
// @src Attribute. See docs/21 §7.4, docs/28 §9.3, docs/04 §6.33.

import { ItemClass, NOTHING } from '../content/items/items.ts';
import { MercType } from '../content/strategic/economy-content.ts';
import { strategicIndex } from '../content/strategic/sector-ids.ts';
import type {
  LaptopStatsView,
  PersonnelDepartedView,
  PersonnelDepartureView,
  PersonnelEmploymentView,
  PersonnelItemView,
  PersonnelMercView,
  PersonnelRecordView,
} from '../protocol/view.ts';
import { SpecialProfile } from '../sim/campaign/contracts/quotes.ts';
import type { LaptopFlow } from '../sim/campaign/laptop/laptop-flow.ts';
import { NO_PERSONNEL_ENTRY } from '../sim/campaign/laptop/laptop-state.ts';
import { ProfileMiscFlag2 } from '../sim/campaign/profiles.ts';
import { MercKind, type RosterMerc } from '../sim/campaign/roster.ts';
import { Assignment } from '../sim/strategic/economy/constants.ts';
import { NUM_MIN_IN_DAY } from '../sim/strategic/time/constants.ts';
import type { ProfileProgress } from '../sim/tactical/profiles.ts';
import { SoldierStatusFlags } from '../sim/tactical/soldier.ts';
import { dailyRate } from './contract-view.ts';

const NO_TOWN = 0;

interface StatSource {
  readonly lifeMax: number;
  readonly agility: number;
  readonly dexterity: number;
  readonly strength: number;
  readonly leadership: number;
  readonly wisdom: number;
  readonly experience: number;
  readonly marksmanship: number;
  readonly mechanical: number;
  readonly explosives: number;
  readonly medical: number;
}

function statsView(s: StatSource): LaptopStatsView {
  return {
    health: s.lifeMax,
    agility: s.agility,
    dexterity: s.dexterity,
    strength: s.strength,
    leadership: s.leadership,
    wisdom: s.wisdom,
    experience: s.experience,
    marksmanship: s.marksmanship,
    mechanical: s.mechanical,
    explosives: s.explosives,
    medical: s.medical,
  };
}

export function teamStatsRow(s: StatSource): number[] {
  return [
    s.lifeMax,
    s.agility,
    s.dexterity,
    s.strength,
    s.leadership,
    s.wisdom,
    s.experience,
    s.marksmanship,
    s.mechanical,
    s.explosives,
    s.medical,
  ];
}

function recordView(p: ProfileProgress): PersonnelRecordView {
  return {
    kills: p.kills,
    assists: p.assists,
    shotsFired: p.shotsFired,
    shotsHit: p.shotsHit,
    battlesFought: p.battlesFought,
    timesWounded: p.timesWounded,
  };
}

function itemClass(flow: LaptopFlow, item: number): number {
  return flow.tactical.items.byIndex.get(item)?.itemClass ?? ItemClass.NONE;
}

function inventoryView(flow: LaptopFlow, m: RosterMerc): PersonnelItemView[] {
  return m.inv.flatMap((o) => {
    if (o.count === 0 || o.item === NOTHING) return [];
    const ammo = itemClass(flow, o.item) === ItemClass.AMMO;
    const shots = ammo ? o.status.slice(0, o.count).reduce((sum, n) => sum + n, 0) : 0;
    return [{ item: o.item, count: o.count, status: o.status[0] ?? 0, shots }];
  });
}

function fundsOnMerc(flow: LaptopFlow, m: RosterMerc): number {
  return m.inv.reduce((sum, o) => (itemClass(flow, o.item) === ItemClass.MONEY ? sum + o.money : sum), 0);
}

function minutesLeft(flow: LaptopFlow, m: RosterMerc): number {
  const left = Math.max(0, m.contract.contractEnd - flow.now());
  const cap = m.contract.totalContractLength * NUM_MIN_IN_DAY;
  return m.assignment === Assignment.IN_TRANSIT && left > cap ? cap : left;
}

function employmentView(flow: LaptopFlow, m: RosterMerc, p: ProfileProgress): PersonnelEmploymentView {
  const daysServed = p.totalDaysServed;
  const totalCost = flow.campaign.state.finances.profileCostToDate.get(m.profile) ?? 0;
  const cost = dailyRate(m, p);
  if (m.kind === MercKind.AIM_MERC || m.profile === SpecialProfile.SLAY)
    return {
      kind: 'aim',
      minutesLeft: minutesLeft(flow, m),
      totalDays: m.contract.totalContractLength,
      daysServed,
      totalCost,
      dailyCost: cost,
      medicalDeposit: p.medicalDepositAmount,
    };
  if (m.kind === MercKind.MERC)
    return { kind: 'merc', daysServed, totalCost, dailyCost: cost, unpaid: p.salary * p.mercMercContractLength };
  return { kind: 'other', daysServed, totalCost, dailyCost: cost, medicalDeposit: p.medicalDepositAmount };
}

function townOf(flow: LaptopFlow, m: RosterMerc): number {
  if (m.assignment === Assignment.ASSIGNMENT_POW || m.assignment === Assignment.IN_TRANSIT) return NO_TOWN;
  return flow.campaign.state.map.elements[strategicIndex(m.sector)]?.nameId ?? NO_TOWN;
}

function mercView(flow: LaptopFlow, m: RosterMerc, p: ProfileProgress): PersonnelMercView {
  const s = m.soldier;
  return {
    soldier: m.id,
    profile: m.profile,
    name: s.name,
    fullName: flow.profileRecord(m.profile)?.name ?? s.name,
    alive: s.life > 0,
    robot: (m.statusFlags & SoldierStatusFlags.ROBOT) !== 0,
    assignment: m.assignment,
    town: townOf(flow, m),
    life: s.life,
    lifeMax: s.lifeMax,
    stats: statsView(p.stats),
    gains: statsView(p.gains),
    teamStats: teamStatsRow({ ...s.stats, lifeMax: s.lifeMax }),
    record: recordView(p),
    skills: [p.skillTrait, p.skillTrait2],
    money: fundsOnMerc(flow, m),
    inventory: inventoryView(flow, m),
    employment: employmentView(flow, m, p),
  };
}

export function personnelCurrent(flow: LaptopFlow): PersonnelMercView[] {
  return flow.team().flatMap((m) => {
    if (m.isVehicle) return [];
    const p = flow.profile(m.profile);
    return p ? [mercView(flow, m, p)] : [];
  });
}

function otherDeparture(flow: LaptopFlow, p: ProfileProgress): PersonnelDepartureView {
  if (p.miscFlags2 & ProfileMiscFlag2.MARRIED_TO_HICKS) return 'married';
  return flow.mercType(p.id) === MercType.AIM ? 'contractExpired' : 'quit';
}

function departedView(flow: LaptopFlow, profile: number, state: PersonnelDepartureView, p: ProfileProgress): PersonnelDepartedView {
  const record = flow.profileRecord(profile);
  return {
    profile,
    state,
    fullName: record?.name ?? '',
    nickname: p.nickname ?? record?.nickname ?? '',
    life: p.life,
    stats: statsView(p.stats),
    teamStats: teamStatsRow(p.stats),
    record: recordView(p),
  };
}

export function personnelDeparted(flow: LaptopFlow): PersonnelDepartedView[] {
  const lists = flow.laptop.personnel;
  const out: PersonnelDepartedView[] = [];
  const add = (list: readonly number[], state: (p: ProfileProgress) => PersonnelDepartureView) => {
    for (const profile of list) {
      if (profile === NO_PERSONNEL_ENTRY) continue;
      const p = flow.profile(profile);
      if (p) out.push(departedView(flow, profile, state(p), p));
    }
  };
  add(lists.dead, () => 'dead');
  add(lists.left, () => 'fired');
  add(lists.other, (p) => otherDeparture(flow, p));
  return out;
}
