// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Campaign.cc AwardExperienceBonusToActiveSquad (EXP_BONUS_* amounts); Strategic/Squads.cc
// @src IsMercOnCurrentSquad; Strategic/Strategic_Town_Loyalty.cc HandleLoyaltyChangeForNPCAction. See docs/25 §2.4.

import { MercStatus } from '../../tactical/profiles.ts';
import { isMechanical } from '../economy/conditions.ts';
import { CONSCIOUSNESS, StatAmt, StatCause, Town } from '../economy/constants.ts';
import { incrementTownLoyalty, incrementTownLoyaltyEverywhere } from '../economy/loyalty.ts';
import type { CrewMember, EconomyContext } from '../economy/ports.ts';
import { Npc } from './npc-ids.ts';

export const ExperienceBonus = { MINIMUM: 0, SMALL: 1, AVERAGE: 2, LARGE: 3, MAXIMUM: 4 } as const;

const EXPERIENCE_BONUS_POINTS: readonly number[] = [25, 50, 100, 200, 400];

function onCurrentSquad(ctx: EconomyContext, m: CrewMember): boolean {
  const squad = ctx.state.forces.currentSquad;
  return m.assignment === squad && (ctx.state.forces.squads[squad] ?? []).includes(m.id);
}

export function awardExperienceBonusToActiveSquad(ctx: EconomyContext, bonus: number): void {
  const points = EXPERIENCE_BONUS_POINTS[bonus] ?? 0;
  const mercs = [...ctx.crew.all()].sort((a, b) => a.id - b.id);
  for (const m of mercs) {
    if (!m.inSector || !onCurrentSquad(ctx, m) || m.life < CONSCIOUSNESS || isMechanical(m)) continue;
    ctx.crew.statChange(m.id, StatAmt.EXPERIENCE, points, StatCause.SUCCESS);
  }
}

function loyaltyAmount(ctx: EconomyContext, name: string): number {
  return ctx.economy.loyalty.amounts[name] ?? 0;
}

export function handleLoyaltyChangeForNpcAction(ctx: EconomyContext, npc: number, joeyStatus: number): void {
  switch (npc) {
    case Npc.MIGUEL:
      incrementTownLoyalty(ctx, Town.OMERTA, loyaltyAmount(ctx, 'BONUS_MIGUEL_READS_LETTER'));
      break;
    case Npc.DOREEN:
      incrementTownLoyalty(ctx, Town.DRASSEN, loyaltyAmount(ctx, 'BONUS_CHILDREN_FREED_DOREEN_SPARED'));
      break;
    case Npc.MARTHA:
      if (joeyStatus !== MercStatus.IS_DEAD) incrementTownLoyalty(ctx, Town.CAMBRIA, loyaltyAmount(ctx, 'BONUS_MARTHA_WHEN_JOEY_RESCUED'));
      break;
    case Npc.KEITH:
      incrementTownLoyalty(ctx, Town.CAMBRIA, loyaltyAmount(ctx, 'BONUS_KEITH_WHEN_HILLBILLY_SOLVED'));
      break;
    case Npc.YANNI:
      incrementTownLoyalty(ctx, Town.CHITZENA, loyaltyAmount(ctx, 'BONUS_YANNI_WHEN_CHALICE_RETURNED_LOCAL'));
      incrementTownLoyaltyEverywhere(ctx, loyaltyAmount(ctx, 'BONUS_YANNI_WHEN_CHALICE_RETURNED_GLOBAL'));
      break;
    case Npc.AUNTIE:
      incrementTownLoyalty(ctx, Town.ALMA, loyaltyAmount(ctx, 'BONUS_AUNTIE_WHEN_BLOODCATS_KILLED'));
      break;
    case Npc.MATT:
      incrementTownLoyalty(ctx, Town.ALMA, loyaltyAmount(ctx, 'BONUS_MATT_WHEN_DYNAMO_FREED'));
      break;
    default:
      break;
  }
}
