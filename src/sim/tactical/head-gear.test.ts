import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { createItem } from '../items/object.ts';
import type { TacticalContent } from './content.ts';
import { InvSlot } from './inventory.ts';
import { type Soldier, Team } from './soldier.ts';
import type { TacticalSim } from './tactical-sim.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const ORIGIN = gridNo(80, 80);
const item = (name: string) => content.items.byName.get(name)?.index ?? 0;

function give(s: Soldier, slot: number, name: string): void {
  s.inv[slot] = createItem(content.items, item(name), 100);
}

function itemsIn(s: Soldier, ...slots: number[]): number[] {
  return slots.map((slot) => s.inv[slot]?.item ?? 0);
}

function squad(): { sim: TacticalSim; merc: Soldier } {
  const sim = newCombatSim(content);
  return { sim, merc: spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST) };
}

describe('the squad head gear of CTRL+N (SwitchHeadGear, Soldier::switchHeadGear)', () => {
  it('swaps the night goggles of a pocket with the sun goggles worn and logs that he equips them', () => {
    const { sim, merc } = squad();
    give(merc, InvSlot.HEAD2, 'SUNGOGGLES');
    give(merc, InvSlot.BIGPOCK2, 'NIGHTGOGGLES');
    expect(sim.dispatch({ type: 'switchHeadGear', soldiers: [0], gear: 'night' })).toEqual({ ok: true, data: { soldiers: [0] } });
    expect(itemsIn(merc, InvSlot.HEAD2, InvSlot.BIGPOCK2)).toEqual([item('NIGHTGOGGLES'), item('SUNGOGGLES')]);
    expect(sim.drainEvents().filter((e) => e.type === 'headGearChanged')).toMatchObject([
      { soldier: 0, item: item('NIGHTGOGGLES'), on: true },
    ]);
    expect(sim.dispatch({ type: 'switchHeadGear', soldiers: [0], gear: 'day' }).ok).toBe(true);
    expect(itemsIn(merc, InvSlot.HEAD2, InvSlot.BIGPOCK2)).toEqual([item('SUNGOGGLES'), item('NIGHTGOGGLES')]);
  });

  it('takes UV goggles before night vision goggles and puts them into the first free head slot', () => {
    const { sim, merc } = squad();
    give(merc, InvSlot.HEAD1, 'EXTENDEDEAR');
    give(merc, InvSlot.SMALLPOCK1, 'NIGHTGOGGLES');
    give(merc, InvSlot.SMALLPOCK2, 'UVGOGGLES');
    sim.dispatch({ type: 'switchHeadGear', soldiers: [0], gear: 'night' });
    expect(itemsIn(merc, InvSlot.HEAD1, InvSlot.HEAD2, InvSlot.SMALLPOCK1, InvSlot.SMALLPOCK2)).toEqual([
      item('EXTENDEDEAR'),
      item('UVGOGGLES'),
      item('NIGHTGOGGLES'),
      0,
    ]);
  });

  it('moves night goggles already worn in the first head slot to a free second one, as FindObj finds them there', () => {
    const { sim, merc } = squad();
    give(merc, InvSlot.HEAD1, 'NIGHTGOGGLES');
    sim.dispatch({ type: 'switchHeadGear', soldiers: [0], gear: 'night' });
    expect(itemsIn(merc, InvSlot.HEAD1, InvSlot.HEAD2)).toEqual([0, item('NIGHTGOGGLES')]);
    expect(sim.drainEvents().filter((e) => e.type === 'headGearChanged')).toMatchObject([{ item: item('NIGHTGOGGLES'), on: true }]);
  });

  it('takes the other kind off into the first free small pocket when he carries none of the wanted kind', () => {
    const { sim, merc } = squad();
    give(merc, InvSlot.HEAD1, 'SUNGOGGLES');
    give(merc, InvSlot.SMALLPOCK1, 'CANTEEN');
    sim.dispatch({ type: 'switchHeadGear', soldiers: [0], gear: 'night' });
    expect(itemsIn(merc, InvSlot.HEAD1, InvSlot.SMALLPOCK2)).toEqual([0, item('SUNGOGGLES')]);
    expect(sim.drainEvents().filter((e) => e.type === 'headGearChanged')).toMatchObject([{ item: item('SUNGOGGLES'), on: false }]);
  });

  it('leaves a merc wearing a gas mask, a dead merc and a full head alone', () => {
    const { sim, merc } = squad();
    give(merc, InvSlot.HEAD1, 'GASMASK');
    give(merc, InvSlot.BIGPOCK1, 'NIGHTGOGGLES');
    const dead = spawnSoldier(sim, 1, Team.OUR, ORIGIN + 2, Direction.EAST);
    give(dead, InvSlot.BIGPOCK1, 'NIGHTGOGGLES');
    dead.life = 0;
    const full = spawnSoldier(sim, 2, Team.OUR, ORIGIN + 4, Direction.EAST);
    give(full, InvSlot.HEAD1, 'EXTENDEDEAR');
    give(full, InvSlot.HEAD2, 'WALKMAN');
    give(full, InvSlot.BIGPOCK1, 'NIGHTGOGGLES');
    expect(sim.dispatch({ type: 'switchHeadGear', soldiers: [0, 1, 2], gear: 'night' })).toEqual({ ok: true, data: { soldiers: [0, 2] } });
    for (const s of [merc, dead, full]) expect(itemsIn(s, InvSlot.BIGPOCK1)).toEqual([item('NIGHTGOGGLES')]);
    expect(sim.drainEvents().some((e) => e.type === 'headGearChanged')).toBe(false);
  });

  it('is refused for another gear and while the enemy has the turn', () => {
    const { sim } = squad();
    expect(sim.dispatch({ type: 'switchHeadGear', soldiers: [0], gear: 'gas' })).toMatchObject({ ok: false, data: { refusal: 'badGear' } });
    sim.state.inCombat = true;
    sim.state.turn.currentTeam = Team.ENEMY;
    expect(sim.dispatch({ type: 'switchHeadGear', soldiers: [0], gear: 'day' })).toMatchObject({
      ok: false,
      data: { refusal: 'uiLocked' },
    });
  });
});
