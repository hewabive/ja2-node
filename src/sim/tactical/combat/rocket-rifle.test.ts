import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { type ItemObject, NO_PROFILE } from '../../items/object.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { Team } from '../soldier.ts';
import { handleItem, ItemHandle } from './attack.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const SHOOTER_PROFILE = 3;
const OTHER_PROFILE = 4;
const GENERIC_IMPRINT = NO_PROFILE + 1;

function rocketRifleDuel(shooterTeam: number, profile: number | null, imprint = NO_PROFILE) {
  const sim = newCombatSim(content);
  const ours = shooterTeam === Team.OUR;
  const shooter = spawnSoldier(sim, ours ? 0 : 20, shooterTeam, gridNo(80, 80), Direction.SOUTH, {
    gun: 'ROCKET_RIFLE',
    ...(profile !== null ? { profile } : {}),
  });
  const target = spawnSoldier(sim, ours ? 20 : 0, ours ? Team.ENEMY : Team.OUR, gridNo(80, 86), Direction.NORTH);
  const rifle = shooter.inv[InvSlot.HAND] as ItemObject;
  rifle.imprintId = imprint;
  sim.lookAround();
  sim.drainEvents();
  return { sim, t: sim.state, shooter, target, rifle };
}

describe('the rocket rifle imprint (Handle_Items.cc HandleItem)', () => {
  it('takes the fingerprints of our merc on his first pull of a virgin rifle instead of firing, then fires on the next', () => {
    const { sim, t, shooter, target, rifle } = rocketRifleDuel(Team.OUR, SHOOTER_PROFILE);
    expect(rifle.imprintId).toBe(NO_PROFILE);
    const before = shooter.actionPoints;
    const first = sim.dispatch({ type: 'attack', soldier: 0, target: target.gridNo });
    expect(first).toMatchObject({ ok: false, data: { refusal: 'gunImprinted' } });
    expect(rifle.imprintId).toBe(SHOOTER_PROFILE);
    const events = sim.drainEvents();
    expect(events.filter((e) => e.type === 'gunImprint')).toMatchObject([{ soldier: 0, result: 'imprinted' }]);
    expect(events.some((e) => e.type === 'shotFired')).toBe(false);
    expect(shooter.actionPoints).toBe(before);
    expect(t.turn.attackBusyCount).toBe(0);
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: target.gridNo })).toEqual({ ok: true });
    const fired = runUntilIdle(sim);
    expect(fired.some((e) => e.type === 'shotFired' && e.soldier === 0)).toBe(true);
    expect(fired.some((e) => e.type === 'gunImprint')).toBe(false);
  });

  it('denies our merc a rifle imprinted on another after the hand item roll, with the RG_ID_INVALID event', () => {
    const { sim, t, target, rifle } = rocketRifleDuel(Team.OUR, SHOOTER_PROFILE, OTHER_PROFILE);
    const rng = t.rng.state();
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: target.gridNo })).toEqual({
      ok: false,
      reason: 'the rocket rifle is imprinted on another soldier',
      data: { refusal: 'wrongFingerprint' },
    });
    expect(t.rng.state()).not.toEqual(rng);
    expect(sim.drainEvents().filter((e) => e.type === 'gunImprint')).toMatchObject([{ soldier: 0, result: 'denied' }]);
    expect(rifle.imprintId).toBe(OTHER_PROFILE);
  });

  it('lets a generic enemy imprint a virgin rifle with NO_PROFILE + 1 and fire on the same pull', () => {
    const { t, shooter, target, rifle } = rocketRifleDuel(Team.ENEMY, null);
    expect(handleItem(t, shooter, target.gridNo, 0, rifle.item)).toBe(ItemHandle.OK);
    expect(rifle.imprintId).toBe(GENERIC_IMPRINT);
    expect(t.events.some((e) => e.type === 'gunImprint')).toBe(false);
  });

  it('refuses a generic enemy a rifle imprinted on a named soldier, without a sound', () => {
    const { t, shooter, target, rifle } = rocketRifleDuel(Team.ENEMY, null, OTHER_PROFILE);
    expect(handleItem(t, shooter, target.gridNo, 0, rifle.item)).toBe(ItemHandle.BROKEN);
    expect(t.events.some((e) => e.type === 'gunImprint')).toBe(false);
  });

  it('lets a named soldier of another team, such as Krott, imprint a virgin rifle and fire on the same pull', () => {
    const { t, shooter, target, rifle } = rocketRifleDuel(Team.ENEMY, SHOOTER_PROFILE);
    expect(handleItem(t, shooter, target.gridNo, 0, rifle.item)).toBe(ItemHandle.OK);
    expect(rifle.imprintId).toBe(SHOOTER_PROFILE);
    expect(t.events.some((e) => e.type === 'gunImprint')).toBe(false);
  });

  it('refuses a named soldier of another team a rifle imprinted on someone else, without a sound', () => {
    const { t, shooter, target, rifle } = rocketRifleDuel(Team.ENEMY, SHOOTER_PROFILE, GENERIC_IMPRINT);
    expect(handleItem(t, shooter, target.gridNo, 0, rifle.item)).toBe(ItemHandle.BROKEN);
    expect(t.events.some((e) => e.type === 'gunImprint')).toBe(false);
  });
});
