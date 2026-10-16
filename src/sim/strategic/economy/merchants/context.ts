// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Arms_Dealer_Init.cc GetArmsDealerShopHours, IsMercADealer (FACT_MANNY_IS_BARTENDER);
// @src Strategic/Scheduling.cc ExtractScheduleDoorLockAndUnlockInfo (as a hook). See docs/23 §16.1.

import type { ItemTable } from '../../../../content/items/items.ts';
import { type DealerDef, type DealerRole, type MerchantContent, NUM_ARMS_DEALERS } from '../../../../content/strategic/merchant-content.ts';
import type { RollSource } from '../../forces/ports.ts';
import { Fact } from '../../narrative/fact-ids.ts';
import { fact, type NarrativeState } from '../../narrative/facts.ts';
import { dealerState, type MerchantState, resetMerchantState } from './state.ts';

export interface ShopHours {
  readonly open: number;
  readonly close: number;
}

export interface MerchantHooks {
  buySellRecordPending(profile: number): boolean;
  shopClosedByScript(profile: number): boolean;
  shopHours(profile: number): ShopHours | null;
}

export const defaultMerchantHooks: MerchantHooks = {
  buySellRecordPending: () => false,
  shopClosedByScript: () => false,
  shopHours: () => null,
};

export interface MerchantWorld {
  gunNut(): boolean;
  highestProgress(): number;
  worldDay(): number;
  worldMinutes(): number;
}

export interface MerchantContext {
  readonly content: MerchantContent;
  readonly items: ItemTable;
  readonly state: MerchantState;
  readonly random: RollSource;
  readonly preRandom: RollSource;
  readonly hooks: MerchantHooks;
  readonly world: MerchantWorld;
  readonly narrative: NarrativeState;
}

export interface MerchantSetup {
  readonly content: MerchantContent;
  readonly items: ItemTable;
  readonly hooks?: Partial<MerchantHooks>;
  readonly bobbyRayDaily?: () => void;
}

export function createMerchantContext(
  setup: MerchantSetup,
  state: MerchantState,
  streams: { readonly random: RollSource; readonly preRandom: RollSource },
  world: MerchantWorld,
  narrative: NarrativeState,
): MerchantContext {
  if (state.dealers.length === 0) resetMerchantState(state, Math.max(NUM_ARMS_DEALERS, setup.content.dealers.length));
  return {
    content: setup.content,
    items: setup.items,
    state,
    random: streams.random,
    preRandom: streams.preRandom,
    hooks: { ...defaultMerchantHooks, ...setup.hooks },
    world,
    narrative,
  };
}

export function dealerDef(ctx: MerchantContext, dealer: number): DealerDef {
  const d = ctx.content.dealers[dealer];
  if (!d) throw new RangeError(`no arms dealer ${dealer}`);
  return d;
}

export function role(ctx: MerchantContext, name: DealerRole): number {
  return ctx.content.tables.dealerIds[name];
}

export function isOutOfBusiness(ctx: MerchantContext, dealer: number): boolean {
  return dealerState(ctx.state, dealer).status.outOfBusiness;
}

export function dealerIdFromProfile(ctx: MerchantContext, profile: number): number {
  return ctx.content.dealers.find((d) => d.profile === profile)?.id ?? -1;
}

export function isMercADealer(ctx: MerchantContext, profile: number): boolean {
  const manny = ctx.content.dealers[role(ctx, 'MANNY')];
  if (manny && profile === manny.profile && !fact(ctx.narrative, Fact.MANNY_IS_BARTENDER)) return false;
  return dealerIdFromProfile(ctx, profile) !== -1;
}
