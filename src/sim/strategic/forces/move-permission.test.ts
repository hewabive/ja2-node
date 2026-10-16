import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad } from '../../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../../tests/support/sectors.ts';
import type { CampaignSim } from '../../campaign/campaign-sim.ts';
import type { Roster } from '../../campaign/roster.ts';
import { Assignment } from './constants.ts';
import { canEntireMovementGroupMove, MoveRefusal } from './move-permission.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const EMPTY = { admins: 0, troops: 0, elites: 0 };
const PEACE = { inCombat: false };

function landed(garrison = EMPTY): { campaign: CampaignSim; roster: Roster } {
  const test = createTestCampaign(kit, { seed: 5, mercs: 2, garrison });
  landFirstSquad(test.campaign);
  return test;
}

function strategic(c: CampaignSim) {
  if (!c.strategic) throw new Error('no strategic layer');
  return c.strategic;
}

describe('strategic movement permission', () => {
  it('keeps a squad in a sector that still holds enemies, as the start sector does', () => {
    const { campaign } = landed({ admins: 0, troops: 3, elites: 0 });
    expect(canEntireMovementGroupMove(strategic(campaign), 0, PEACE)).toBe(MoveRefusal.ENEMY);
    expect(campaign.dispatch({ type: 'route', soldier: 0, to: 'B9' })).toEqual({
      ok: false,
      reason: 'the squad cannot move: enemiesPresent',
    });
  });

  it('refuses during combat in the loaded sector and lets a cleared sector go', () => {
    const { campaign } = landed();
    expect(canEntireMovementGroupMove(strategic(campaign), 0, { inCombat: true })).toBe(MoveRefusal.COMBAT);
    expect(canEntireMovementGroupMove(strategic(campaign), 0, PEACE)).toBeNull();
    expect(campaign.dispatch({ type: 'route', soldier: 0, to: 'B9' })).toMatchObject({ ok: true });
  });

  it('checks every merc travelling in the same group', () => {
    const { campaign, roster } = landed();
    const other = roster.get(1);
    if (!other) throw new Error('no second merc');
    other.soldier.life = 5;
    expect(canEntireMovementGroupMove(strategic(campaign), 0, PEACE)).toBe(MoveRefusal.TOO_INJURED);
    other.soldier.life = 80;
    other.assignment = Assignment.IN_TRANSIT;
    expect(canEntireMovementGroupMove(strategic(campaign), 0, PEACE)).toBe(MoveRefusal.TRANSIT);
  });
});
