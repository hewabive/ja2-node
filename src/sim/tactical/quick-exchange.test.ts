import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import type { TacticalContent } from './content.ts';
import { AP } from './points.ts';
import { exchangeRefusal, isAnimalBody, seenExchangeChecks, validQuickExchangePosition } from './quick-exchange.ts';
import { Body, Orders, Side, Team } from './soldier.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const ORIGIN = gridNo(80, 80);
const FATIMA = 101;

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
    expect(exchangeRefusal(sim.state, merc, civ)).not.toBeNull();
    civ.ai.orders = Orders.FARPATROL;
    expect(exchangeRefusal(sim.state, merc, civ)).toBeNull();
    sim.state.inCombat = true;
    merc.actionPoints = 2;
    expect(exchangeRefusal(sim.state, merc, civ)).not.toBeNull();
  });

  it('reports what the original prints: our merc short of APs, the person or the named NPC who refuses to move', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
    const civ = spawnSoldier(sim, 116, Team.CIV, ORIGIN + 1, Direction.WEST);
    const fatima = spawnSoldier(sim, 117, Team.CIV, ORIGIN - 1, Direction.EAST, { profile: FATIMA });
    civ.ai.orders = Orders.STATIONARY;
    fatima.ai.orders = Orders.STATIONARY;
    expect(exchangeRefusal(sim.state, merc, civ)).toBe('personRefusesToMove');
    expect(exchangeRefusal(sim.state, merc, fatima)).toBe('npcRefusesToMove');
    sim.state.inCombat = true;
    merc.actionPoints = AP.EXCHANGE_PLACES - 1;
    expect(exchangeRefusal(sim.state, merc, fatima)).toBe('notEnoughAP');
    merc.actionPoints = AP.EXCHANGE_PLACES;
    civ.actionPoints = 0;
    expect(exchangeRefusal(sim.state, merc, civ)).toBe('cannotExchange');
  });

  it('refuses an animal and a merc of ours too collapsed to act without a line', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
    const mate = spawnSoldier(sim, 1, Team.OUR, ORIGIN + 1, Direction.WEST);
    const cow = spawnSoldier(sim, 116, Team.CIV, ORIGIN - 1, Direction.EAST);
    cow.bodyType = Body.COW;
    expect(exchangeRefusal(sim.state, merc, cow)).toBe('cannotExchange');
    mate.collapsed = true;
    sim.state.inCombat = true;
    mate.actionPoints = 0;
    expect(exchangeRefusal(sim.state, merc, mate)).toBe('cannotExchange');
  });
});
