// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Finances.cc ProcessTransactionString (the ledger row labels with the detailed GetSectorIDString,
// @src sector-id-label.ts). See docs/21 §6.3.

import { sectorFromId } from '../content/strategic/sector-ids.ts';
import { type UiStrings, uiString } from '../content/text/strings.ts';
import type { CampaignSim } from '../sim/campaign/campaign-sim.ts';
import { FinanceCode } from '../sim/campaign/finances.ts';
import { sectorIdString } from './sector-id-label.ts';

const TRANSACTION_TABLE = 'pTransactionText';
const DETAILED = true;
const DIRECTIVE = /%s/;

const VERBATIM: ReadonlySet<number> = new Set([
  FinanceCode.ACCRUED_INTEREST,
  FinanceCode.ANONYMOUS_DEPOSIT,
  FinanceCode.BOBBYR_PURCHASE,
  FinanceCode.DEPOSIT_FROM_GOLD_MINE,
  FinanceCode.IMP_PROFILE,
  FinanceCode.PAY_SPECK_FOR_MERC,
  FinanceCode.PURCHASED_FLOWERS,
  FinanceCode.TRANSACTION_FEE,
]);

const NAMING_A_PROFILE: ReadonlySet<number> = new Set([
  FinanceCode.CANCELLED_INSURANCE,
  FinanceCode.EXTENDED_CONTRACT_BY_1_DAY,
  FinanceCode.EXTENDED_CONTRACT_BY_1_WEEK,
  FinanceCode.EXTENDED_CONTRACT_BY_2_WEEKS,
  FinanceCode.EXTENDED_INSURANCE,
  FinanceCode.FULL_MEDICAL_REFUND,
  FinanceCode.HIRED_MERC,
  FinanceCode.INSURANCE_PAYOUT,
  FinanceCode.MEDICAL_DEPOSIT,
  FinanceCode.MERC_DEPOSITED_MONEY_TO_PLAYER_ACCOUNT,
  FinanceCode.NO_MEDICAL_REFUND,
  FinanceCode.PARTIAL_MEDICAL_REFUND,
  FinanceCode.PAYMENT_TO_NPC,
  FinanceCode.PURCHASED_INSURANCE,
  FinanceCode.PURCHASED_ITEM_FROM_DEALER,
  FinanceCode.REDUCED_INSURANCE,
  FinanceCode.TRANSFER_FUNDS_FROM_MERC,
  FinanceCode.TRANSFER_FUNDS_TO_MERC,
]);

function filled(template: string, value: string): string {
  return template.replace(DIRECTIVE, () => value);
}

function nickname(campaign: CampaignSim, profile: number): string {
  return campaign.laptop?.profileRecord(profile)?.nickname ?? campaign.battle?.content.profiles[profile]?.nickname ?? '';
}

export function sectorIdLabel(campaign: CampaignSim, labels: UiStrings, sectorByte: number): string {
  return sectorIdString(campaign, labels, sectorFromId(sectorByte), DETAILED);
}

export function financeRowText(campaign: CampaignSim, labels: UiStrings | null, code: number, secondCode: number): string {
  if (!labels) return '';
  const shownCode = code === FinanceCode.DEPOSIT_FROM_SILVER_MINE ? FinanceCode.DEPOSIT_FROM_GOLD_MINE : code;
  const template = uiString(labels, TRANSACTION_TABLE, shownCode) ?? '';
  if (VERBATIM.has(shownCode)) return template;
  if (NAMING_A_PROFILE.has(shownCode)) return filled(template, nickname(campaign, secondCode));
  if (shownCode === FinanceCode.TRAIN_TOWN_MILITIA) return filled(template, sectorIdLabel(campaign, labels, secondCode));
  return '';
}
