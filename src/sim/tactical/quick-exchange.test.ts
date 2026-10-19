import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import type { TacticalContent } from './content.ts';
import { canExchangePlaces, isAnimalBody, seenExchangeChecks, validQuickExchangePosition } from './quick-exchange.ts';
import { Body, Orders, Side, Team } from './soldier.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const ORIGIN = gridNo(80, 80);

describe('quick exchange of places (ValidQuickExchangePosition, CanExchangePlaces)', () => {
  it('accepts an adjacent neutral civilian or friendly militiaman in sight with a one-step path', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
    const civ = spawnSoldier(sim, 116, Team.CIV, ORIGIN + 1, Direction.WEST);
    const militia = spawnSoldier(sim, 84, Team.MILITIA, ORIGIN - 1, Direction.EAST);
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, ORIGIN + 160, Direction.NORTH);
    const far = spawnSoldier(sim, 117, Team.CIV, ORIGIN + 3, Direction.WEST);
    expect(validQuickExchangePosition(sim.state, merc, civ)).toBe(true);
    expect(militia.side).toBe(Side.FRIENDLY);
    expect(validQuickExchangePosition(sim.state, merc, militia)).toBe(true);
    expect(validQuickExchangePosition(sim.state, merc, enemy)).toBe(false);
    expect(validQuickExchangePosition(sim.state, merc, far)).toBe(false);
  });

  it('never exchanges with animals', () => {
    expect(isAnimalBody({ bodyType: Body.COW })).toBe(true);
    expect(isAnimalBody({ bodyType: Body.REGMALE })).toBe(false);
  });

  it('needs the APs of both, a willing neutral and valid stances', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
    const civ = spawnSoldier(sim, 116, Team.CIV, ORIGIN + 1, Direction.WEST);
    expect(seenExchangeChecks(sim.state, merc, civ)).toBe(true);
    civ.ai.orders = Orders.STATIONARY;
    expect(canExchangePlaces(sim.state, merc, civ)).toBe(false);
    civ.ai.orders = Orders.FARPATROL;
    expect(canExchangePlaces(sim.state, merc, civ)).toBe(true);
    sim.state.inCombat = true;
    merc.actionPoints = 2;
    expect(canExchangePlaces(sim.state, merc, civ)).toBe(false);
  });
});
