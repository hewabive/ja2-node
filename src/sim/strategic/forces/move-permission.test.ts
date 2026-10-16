import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad } from '../../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../../tests/support/sectors.ts';
import type { CampaignSim } from '../../campaign/campaign-sim.ts';
import { MercKind, type Roster } from '../../campaign/roster.ts';
import { InvSlot } from '../../tactical/inventory.ts';
import { Body } from '../../tactical/soldier.ts';
import { Assignment } from './constants.ts';
import { canCharacterMoveInStrategic, canEntireMovementGroupMove, MoveRefusal } from './move-permission.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const EMPTY = { admins: 0, troops: 0, elites: 0 };
const ROBOT = 62;
const MARIA = 88;
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

  it('keeps the robot back without a controller in its squad (ME_ROBOT_ALONE)', () => {
    const { campaign, roster } = landed();
    const robot = roster.get(1);
    const merc = roster.get(0);
    if (!robot || !merc) throw new Error('no squad');
    Object.assign(robot, { kind: MercKind.EPC });
    Object.assign(robot.soldier, { profile: ROBOT, bodyType: Body.ROBOTNOWEAPON });
    expect(canEntireMovementGroupMove(strategic(campaign), 1, PEACE)).toBe(MoveRefusal.ROBOT_ALONE);
    const head = merc.soldier.inv[InvSlot.HEAD1];
    if (head) head.item = campaign.battle?.content.items.byName.get('ROBOT_REMOTE_CONTROL')?.index ?? 0;
    expect(canEntireMovementGroupMove(strategic(campaign), 1, PEACE)).toBeNull();
  });

  it('keeps Maria in C5', () => {
    const { campaign, roster } = landed();
    const maria = roster.get(1);
    if (!maria) throw new Error('no squad');
    Object.assign(maria.soldier, { profile: MARIA });
    maria.sector = { x: 5, y: 3, z: 0 };
    expect(canCharacterMoveInStrategic(strategic(campaign), maria, PEACE)).toBe(MoveRefusal.CANNOT_LEAVE);
  });
});
