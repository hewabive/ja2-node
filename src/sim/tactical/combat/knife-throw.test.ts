import { beforeAll, describe, expect, it } from 'vitest';
import { estimateAttack, newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { createItem } from '../../items/object.ts';
import type { TacticalContent } from '../content.ts';
import { calcThrownChanceToHit } from '../explosions/throwing.ts';
import { InvSlot } from '../inventory.ts';
import { Opp } from '../perception/opp.ts';
import { Team } from '../soldier.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const KNIFE_STATUS_IN_POCKET = 77;

function knifeDuel() {
  const sim = newCombatSim(content);
  const thrower = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 70), Direction.EAST, { gun: 'THROWING_KNIFE', marksmanship: 90 });
  const knife = content.items.byName.get('THROWING_KNIFE')?.index ?? -1;
  thrower.inv[InvSlot.SMALLPOCK1] = createItem(content.items, knife, KNIFE_STATUS_IN_POCKET);
  const target = spawnSoldier(sim, 20, Team.ENEMY, gridNo(85, 70), Direction.WEST);
  sim.lookAround();
  sim.drainEvents();
  return { sim, thrower, target, knife };
}

describe('throwing a knife (Handle_Items.cc HandleItem, Weapons.cc UseGun)', () => {
  it('throws at the thrown chance to hit and then takes the next knife from a pocket into the hand', () => {
    const { sim, thrower, target, knife } = knifeDuel();
    const chance = calcThrownChanceToHit(sim.state, thrower, target.gridNo, 0);
    expect(estimateAttack(sim, { soldier: 0, target: target.gridNo }).data).toMatchObject({ chanceToHit: chance });
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: target.gridNo })).toEqual({ ok: true });
    const events = runUntilIdle(sim);
    expect(events).toContainEqual(expect.objectContaining({ type: 'shotFired', soldier: 0, chance }));
    expect(thrower.inv[InvSlot.HAND]).toMatchObject({ item: knife, status: [KNIFE_STATUS_IN_POCKET] });
    expect(thrower.inv[InvSlot.SMALLPOCK1]?.item ?? 0).toBe(0);
    expect(sim.state.turn.attackBusyCount).toBe(0);
  });

  it('loses a knife that strikes a wall: StructureHit leaves one on the map only where it falls to the ground', () => {
    const wallRow = 84;
    const walls = Array.from({ length: 9 }, (_, k) => gridNo(76 + k, wallRow));
    const sim = newCombatSim(content, walls);
    const thrower = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { gun: 'THROWING_KNIFE', marksmanship: 90 });
    const target = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 88), Direction.NORTH);
    sim.state.inCombat = true;
    thrower.oppList[target.id] = Opp.SEEN_CURRENTLY;
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: target.gridNo })).toEqual({ ok: true });
    const events = runUntilIdle(sim);
    expect(events.find((e) => e.type === 'bulletStopped')).toMatchObject({ reason: 'structure' });
    expect(target.life).toBe(80);
    expect(sim.state.worldItems.filter((i) => content.items.byIndex.get(i.object.item)?.name === 'THROWING_KNIFE')).toEqual([]);
    expect(sim.state.turn.attackBusyCount).toBe(0);
  });
});
