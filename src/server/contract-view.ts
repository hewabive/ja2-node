// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface.cc GetMoraleString; Laptop/Personnel.cc (daily rate by contract type,
// @src days served, total cost); Strategic/MapScreen.cc (contract time left). See docs/22 §1.3, §9.

import { type Sector, sectorFromId, sectorShortString } from '../content/strategic/sector-ids.ts';
import type { ContractPromptView, MercContractView, StrategicMercView } from '../protocol/view.ts';
import type { CampaignSim } from '../sim/campaign/campaign-sim.ts';
import { ContractLength } from '../sim/campaign/contracts/contract-state.ts';
import { personnelTimeLeft, remainingContractMinutes } from '../sim/campaign/contracts/contract-times.ts';
import { contractEndTime } from '../sim/campaign/contracts/extension.ts';
import { mercAccountStatusName } from '../sim/campaign/contracts/merc-account.ts';
import { SpecialProfile } from '../sim/campaign/contracts/quotes.ts';
import { contractOptions } from '../sim/campaign/contracts/renewal.ts';
import { MercKind, type RosterMerc } from '../sim/campaign/roster.ts';
import { Assignment } from '../sim/strategic/economy/constants.ts';
import { NUM_MIN_IN_DAY } from '../sim/strategic/time/constants.ts';
import { worldDay, worldTotalMinutes } from '../sim/strategic/time/world-clock.ts';
import type { ProfileProgress } from '../sim/tactical/profiles.ts';
import { SoldierStatusFlags } from '../sim/tactical/soldier.ts';

const KIND_NAMES: Readonly<Record<number, string>> = {
  [MercKind.PLAYER_CHARACTER]: 'imp',
  [MercKind.AIM_MERC]: 'aim',
  [MercKind.MERC]: 'merc',
  [MercKind.NPC]: 'rpc',
  [MercKind.EPC]: 'epc',
  [MercKind.NPC_UNEXTENDABLE]: 'npc',
  [MercKind.VEHICLE]: 'vehicle',
};

const LAST_CONTRACTS: Readonly<Record<number, 'day' | 'week' | 'twoWeeks'>> = {
  [ContractLength.EXTEND_1_DAY]: 'day',
  [ContractLength.EXTEND_1_WEEK]: 'week',
  [ContractLength.EXTEND_2_WEEK]: 'twoWeeks',
};

export type MoraleText = 'great' | 'good' | 'stable' | 'poor' | 'panic' | 'bad';

const MORALE_TEXTS: readonly (readonly [number, MoraleText])[] = [
  [80, 'great'],
  [65, 'good'],
  [35, 'stable'],
  [20, 'poor'],
];
const WEEK_DAYS = 7;
const TWO_WEEK_DAYS = 14;

const sectorName = (s: Sector) => (s.z ? `${sectorShortString(s)}-${s.z}` : sectorShortString(s));

function moraleText(m: RosterMerc): MoraleText {
  if (m.statusFlags & SoldierStatusFlags.DEAD) return 'bad';
  return MORALE_TEXTS.find(([above]) => m.soldier.morale > above)?.[1] ?? 'panic';
}

function dailyRate(m: RosterMerc, p: ProfileProgress): number {
  if (m.kind !== MercKind.AIM_MERC) return p.salary;
  if (m.contract.typeOfLastContract === ContractLength.EXTEND_2_WEEK) return Math.trunc(p.biWeeklySalary / TWO_WEEK_DAYS);
  if (m.contract.typeOfLastContract === ContractLength.EXTEND_1_WEEK) return Math.trunc(p.weeklySalary / WEEK_DAYS);
  return p.salary;
}

function insuranceDays(campaign: CampaignSim, m: RosterMerc): number {
  const c = m.contract;
  if (!c.lifeInsurance) return 0;
  const day = worldDay(campaign.state.clock);
  return day < c.startOfInsuranceContract
    ? c.totalLengthOfInsuranceContract
    : c.totalLengthOfInsuranceContract - (day - c.startOfInsuranceContract);
}

function contractView(campaign: CampaignSim, m: RosterMerc, p: ProfileProgress): MercContractView | null {
  const now = worldTotalMinutes(campaign.state.clock);
  if (m.kind === MercKind.AIM_MERC || m.profile === SpecialProfile.SLAY) {
    const c = m.contract;
    const left = remainingContractMinutes(c.contractEnd, c.totalContractLength, m.assignment === Assignment.IN_TRANSIT, now);
    return {
      type: 'aim',
      totalDays: c.totalContractLength,
      remaining: personnelTimeLeft(left),
      endsAt: contractEndTime(m),
      lastContract: LAST_CONTRACTS[c.typeOfLastContract] ?? 'day',
      dailyRate: dailyRate(m, p),
      renewalCosts: { day: p.salary, week: p.weeklySalary, twoWeeks: p.biWeeklySalary },
      medicalDeposit: p.medicalDepositAmount,
      insured: c.lifeInsurance !== 0,
      insuranceDays: insuranceDays(campaign, m),
      minutesLeft: left,
      endMinutes: c.contractEnd,
    };
  }
  if (m.kind === MercKind.MERC)
    return {
      type: 'merc',
      unpaidDays: p.mercMercContractLength,
      daysHired: Math.trunc(now / NUM_MIN_IN_DAY) - m.contract.contractStartDay,
      owed: p.salary * p.mercMercContractLength,
      contractLength: p.mercMercContractLength,
    };
  if (m.kind === MercKind.NPC) return { type: 'rpc', dailyRate: p.salary };
  return null;
}

export function mercContractFields(campaign: CampaignSim, id: number): Partial<StrategicMercView> {
  const flow = campaign.contracts;
  const m = flow?.roster.get(id);
  if (!flow || !m) return {};
  const p = flow.profile(m.profile);
  return {
    kind: KIND_NAMES[m.kind] ?? 'unknown',
    contract: p ? contractView(campaign, m, p) : null,
    morale: m.soldier.morale,
    moraleText: moraleText(m),
    daysServed: p?.totalDaysServed ?? 0,
    totalCost: campaign.state.finances.profileCostToDate.get(m.profile) ?? 0,
  };
}

export function mercSalary(campaign: CampaignSim, id: number): number | null {
  const flow = campaign.contracts;
  const m = flow?.roster.get(id);
  const p = m ? flow?.profile(m.profile) : undefined;
  return m && p ? dailyRate(m, p) : null;
}

export function mercAccountStatusView(campaign: CampaignSim): Record<string, string> {
  return campaign.contracts ? { mercAccountStatus: mercAccountStatusName(campaign.state.laptop.merc.accountStatus) } : {};
}

export function contractPromptView(campaign: CampaignSim): ContractPromptView | null {
  const flow = campaign.contracts;
  const prompt = campaign.state.battle.prompt;
  if (!flow || !prompt || !('soldier' in prompt)) return null;
  const m = flow.roster.get(prompt.soldier);
  if (!m) return null;
  const name = m.soldier.name;
  switch (prompt.kind) {
    case 'contractRenewal':
      return {
        id: prompt.id,
        kind: 'contractRenewal',
        soldier: m.id,
        name,
        fromSequence: prompt.fromSequence,
        balance: campaign.state.finances.balance,
        options: contractOptions(flow, m, campaign.tactical?.state.inCombat === true).map((o) => ({ ...o })),
      };
    case 'mercDeparture':
      return {
        id: prompt.id,
        kind: 'mercDeparture',
        soldier: m.id,
        name,
        sector: sectorName(m.sector),
        choices: [...prompt.choices],
        elsewhereSector: prompt.elsewhere === null ? null : sectorShortString(sectorFromId(prompt.elsewhere)),
      };
    case 'insuranceExtension':
      return {
        id: prompt.id,
        kind: 'insuranceExtension',
        soldier: m.id,
        name,
        days: prompt.days,
        cost: prompt.cost,
        choices: ['yes', 'no'],
      };
    default:
      return null;
  }
}
