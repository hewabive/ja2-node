import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { cloneObject, createItems, createMoney, type ItemObject } from '../items/object.ts';
import type { TacticalSim } from '../tactical/tactical-sim.ts';
import type { TacticalContent } from './content.ts';
import { apsToGiveItem, setEngagedInConvFromPcAction, soldierGiveItem } from './give.ts';
import { InvSlot, NO_SLOT } from './inventory.ts';
import { type NarrativePort, NO_NARRATIVE_PORT } from './narrative/port.ts';
import { AP } from './points.ts';
import { type Soldier, Team } from './soldier.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const item = (name: string) => content.items.byName.get(name)?.index ?? -1;

function clipsIn(s: Soldier): number {
  return s.inv.filter((o) => o.item === item('CLIP9_15')).reduce((n, o) => n + o.count, 0);
}

function withClips(s: Soldier, count: number): ItemObject {
  const o = createItems(content.items, item('CLIP9_15'), 100, count);
  Object.assign(s.inv[InvSlot.BIGPOCK1] as object, o);
  return s.inv[InvSlot.BIGPOCK1] as ItemObject;
}

function stepUntil(sim: TacticalSim, done: () => boolean, ticks = 20_000): void {
  for (let k = 0; k < ticks && !done(); k++) sim.step();
}

interface PortLog {
  readonly npcGives: [number, number, ItemObject][];
  readonly doneGiving: number[];
}

function port(sim: TacticalSim, overrides: Partial<NarrativePort>): PortLog {
  const log: PortLog = { npcGives: [], doneGiving: [] };
  sim.state.narrative = {
    ...NO_NARRATIVE_PORT,
    giveToNpc: (giver, target, object) => log.npcGives.push([giver.id, target.id, cloneObject(object)]),
    triggerDoneGivingItem: (profile) => log.doneGiving.push(profile),
    ...overrides,
  };
  return log;
}

describe('the give action (docs/24 §4.1)', () => {
  it('hands one magazine to an adjacent squad mate at code 486 and deletes the whole source pocket', () => {
    const sim = newCombatSim(content);
    const giver = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.EAST);
    const mate = spawnSoldier(sim, 1, Team.OUR, gridNo(81, 80), Direction.WEST);
    const pocket = withClips(giver, 2);
    const one = cloneObject(pocket);
    one.count = 1;
    expect(soldierGiveItem(sim.state, giver, mate, one, InvSlot.BIGPOCK1)).toBe(true);
    expect(sim.state.content.animations.controls[giver.state]?.id).toBe('GIVE_ITEM');
    const events = runUntilIdle(sim);
    expect(clipsIn(mate)).toBe(1);
    expect(clipsIn(giver)).toBe(0);
    expect(events).toContainEqual(expect.objectContaining({ type: 'itemGiven', soldier: 0, target: 1, item: 'CLIP9_15', count: 1 }));
    expect(giver.engagedInAction).toBe(false);
    expect(mate.engagedInAction).toBe(false);
  });

  it('checks the walk plus one AP and charges three when the item changes hands in combat', () => {
    const sim = newCombatSim(content);
    const giver = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const mate = spawnSoldier(sim, 1, Team.OUR, gridNo(80, 81), Direction.NORTH);
    spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 95), Direction.NORTH);
    sim.lookAround();
    expect(sim.state.inCombat).toBe(true);
    expect(sim.state.turn.currentTeam).toBe(Team.OUR);
    expect(apsToGiveItem(sim.state, giver, giver.gridNo)).toBe(AP.GIVE_ITEM);
    const before = giver.actionPoints;
    soldierGiveItem(sim.state, giver, mate, cloneObject(withClips(giver, 1)), InvSlot.BIGPOCK1);
    runUntilIdle(sim);
    expect(before - giver.actionPoints).toBe(AP.PICKUP_ITEM);
  });

  it('walks to a tile next to the target first', () => {
    const sim = newCombatSim(content);
    const giver = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.EAST);
    const mate = spawnSoldier(sim, 1, Team.OUR, gridNo(85, 80), Direction.WEST);
    soldierGiveItem(sim.state, giver, mate, cloneObject(withClips(giver, 1)), InvSlot.BIGPOCK1);
    expect(giver.pendingGive).toMatchObject({ begun: false, target: 1 });
    runUntilIdle(sim);
    expect(Math.abs((giver.gridNo % 160) - 85)).toBe(1);
    expect(clipsIn(mate)).toBe(1);
  });

  it('drops a copy at the giver when the target has left its tile, keeping the pocket (verify on begin)', () => {
    const sim = newCombatSim(content);
    const log = port(sim, {});
    const giver = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.EAST);
    const mate = spawnSoldier(sim, 1, Team.OUR, gridNo(85, 80), Direction.WEST);
    soldierGiveItem(sim.state, giver, mate, cloneObject(withClips(giver, 1)), InvSlot.BIGPOCK1);
    sim.state.occupant[0]?.fill(-1, mate.gridNo, mate.gridNo + 1);
    mate.placed = false;
    const events = runUntilIdle(sim);
    expect(events).toContainEqual(expect.objectContaining({ type: 'giveAborted', soldier: 0, reason: 'targetMoved', dropped: true }));
    expect(sim.state.worldItems.some((wi) => wi.object.item === item('CLIP9_15') && wi.gridNo === giver.gridNo)).toBe(true);
    expect(clipsIn(giver)).toBe(1);
    expect(log.doneGiving).toEqual([giver.profile]);
    expect(giver.tempObject).toBeNull();
  });

  it('passes the object to the narrative for an NPC and takes the given count off the pocket', () => {
    const sim = newCombatSim(content);
    const log = port(sim, { receivesAsTeamMember: () => false });
    const giver = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.EAST);
    const npc = spawnSoldier(sim, 60, Team.CIV, gridNo(81, 80), Direction.WEST, { profile: 94 });
    const pocket = withClips(giver, 3);
    const one = cloneObject(pocket);
    one.count = 1;
    setEngagedInConvFromPcAction(sim.state, giver);
    soldierGiveItem(sim.state, giver, npc, one, InvSlot.BIGPOCK1);
    runUntilIdle(sim);
    expect(log.npcGives.map(([g, n, o]) => [g, n, o.item, o.count])).toEqual([[0, 60, item('CLIP9_15'), 1]]);
    expect(clipsIn(giver)).toBe(2);
    expect(sim.state.engagedInConv).toBe(true);
  });

  it('leaves the pocket alone and the engaged flag off when a dealer takes the give elsewhere', () => {
    const sim = newCombatSim(content);
    const dealers: number[] = [];
    const log = port(sim, {
      isDealer: () => true,
      receivesAsTeamMember: () => false,
      dealerTakesGive: (_g, dealer, _o, slot) => {
        dealers.push(dealer.id, slot);
        return true;
      },
    });
    const giver = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.EAST);
    const dealer = spawnSoldier(sim, 60, Team.CIV, gridNo(81, 80), Direction.WEST, { profile: 91 });
    setEngagedInConvFromPcAction(sim.state, giver);
    soldierGiveItem(sim.state, giver, dealer, cloneObject(withClips(giver, 2)), InvSlot.BIGPOCK1);
    runUntilIdle(sim);
    expect(dealers).toEqual([60, InvSlot.BIGPOCK1]);
    expect(clipsIn(giver)).toBe(2);
    expect(log.npcGives).toEqual([]);
    expect(sim.state.engagedInConv).toBe(false);
    expect(dealer.engagedInAction).toBe(true);
  });

  it('pays nothing off a teammate’s debt because the placed money object is emptied first', () => {
    const sim = newCombatSim(content);
    const giver = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.EAST);
    const mate = spawnSoldier(sim, 1, Team.OUR, gridNo(81, 80), Direction.WEST, { profile: 59 });
    const owed = { balance: -300 };
    sim.state.profiles.set(59, { ...(sim.state.profiles.get(59) ?? {}), ...owed } as never);
    const money = createMoney(content.items, 200);
    const events = (() => {
      soldierGiveItem(sim.state, giver, mate, money, NO_SLOT);
      return runUntilIdle(sim);
    })();
    expect(mate.inv.some((o) => o.item === item('MONEY') && o.money === 200)).toBe(true);
    expect(sim.state.profiles.get(59)?.balance).toBe(-300);
    expect(events).toContainEqual(expect.objectContaining({ type: 'npcMessage', kind: 'stillOwed', profile: 59, amount: 300 }));
  });

  it('forgets the object when the giver collapses on the way', () => {
    const sim = newCombatSim(content);
    const giver = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.EAST);
    const mate = spawnSoldier(sim, 1, Team.OUR, gridNo(86, 80), Direction.WEST);
    soldierGiveItem(sim.state, giver, mate, cloneObject(withClips(giver, 1)), InvSlot.BIGPOCK1);
    sim.step();
    sim.state.hooks.collapse(sim.state, giver);
    expect(giver.tempObject).toBeNull();
    stepUntil(sim, () => false, 2000);
    expect(clipsIn(mate)).toBe(0);
  });
});
