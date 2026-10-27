import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { createItem } from '../items/object.ts';
import { ScriptedStream } from '../strategic/forces/autoresolve/replay-rng.ts';
import type { TacticalContent } from './content.ts';
import { InvSlot } from './inventory.ts';
import { type Soldier, Team } from './soldier.ts';
import type { TacticalSim } from './tactical-sim.ts';
import { AP_TOSS_ITEM } from './toss.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const KIT = 'FIRSTAIDKIT';
const THROWER_AT = gridNo(70, 80);
const FAR_TILE = gridNo(76, 80);
const DEXTEROUS = 80;
const RELEASE_TICKS = 2_000;

function kitIndex(): number {
  return content.items.byName.get(KIT)?.index ?? -1;
}

function thrower(): { sim: TacticalSim; merc: Soldier } {
  const sim = newCombatSim(content);
  const merc = spawnSoldier(sim, 0, Team.OUR, THROWER_AT, Direction.EAST);
  merc.inv[InvSlot.BIGPOCK1] = createItem(content.items, kitIndex(), 100);
  return { sim, merc };
}

function catcherFor(sim: TacticalSim, at = FAR_TILE): Soldier {
  const catcher = spawnSoldier(sim, 1, Team.OUR, at, Direction.WEST);
  catcher.stats.dexterity = DEXTEROUS;
  return catcher;
}

function scriptPre(sim: TacticalSim, rolls: readonly number[]): void {
  Object.assign(sim.state, { pre: new ScriptedStream(rolls, 0) });
}

const carries = (s: Soldier) => s.inv.some((o) => o?.item === kitIndex());
const kitsOnGround = (sim: TacticalSim) => sim.state.worldItems.filter((wi) => wi.object.item === kitIndex()).map((wi) => wi.gridNo);

describe('tossing an item from the item cursor', () => {
  it('throws it onto a far tile for AP_TOSS_ITEM in combat, with the thrower turned to it', () => {
    const { sim, merc } = thrower();
    sim.state.inCombat = true;
    const ap = merc.actionPoints;
    expect(sim.dispatch({ type: 'toss', soldier: merc.id, slot: 'bigPocket1', gridNo: FAR_TILE })).toEqual({ ok: true });
    expect(carries(merc)).toBe(false);
    for (let tick = 0; tick < RELEASE_TICKS && !sim.state.explosives.objects.some(Boolean); tick++) sim.step();
    expect(merc.actionPoints).toBe(ap - AP_TOSS_ITEM);
    runUntilIdle(sim);
    expect(kitsOnGround(sim)).toEqual([FAR_TILE]);
    expect(merc.direction).toBe(Direction.EAST);
    expect(sim.state.turn.attackBusyCount).toBe(0);
  });

  it('lets a merc of ours catch it into his pockets when his dexterity roll succeeds', () => {
    const { sim, merc } = thrower();
    const catcher = catcherFor(sim);
    scriptPre(sim, [10]);
    expect(sim.dispatch({ type: 'toss', soldier: merc.id, slot: 'bigPocket1', gridNo: FAR_TILE })).toEqual({ ok: true });
    const events = runUntilIdle(sim);
    expect(carries(catcher)).toBe(true);
    expect(kitsOnGround(sim)).toEqual([]);
    expect(events.filter((e) => e.type === 'itemCaught')).toMatchObject([{ soldier: catcher.id, item: kitIndex() }]);
    expect(events.filter((e) => e.type === 'catchEnded')).toMatchObject([{ soldier: catcher.id }]);
    expect(catcher.direction).toBe(Direction.WEST);
  });

  it('drops it at the fumbling catcher, who is struck by it', () => {
    const { sim, merc } = thrower();
    const catcher = catcherFor(sim);
    scriptPre(sim, [95]);
    expect(sim.dispatch({ type: 'toss', soldier: merc.id, slot: 'bigPocket1', gridNo: FAR_TILE })).toEqual({ ok: true });
    const events = runUntilIdle(sim);
    expect(carries(catcher)).toBe(false);
    expect(kitsOnGround(sim)).toHaveLength(1);
    expect(events.filter((e) => e.type === 'itemCaught')).toEqual([]);
    const catches = events.filter((e) => e.type === 'catchEnded');
    expect(catches.length).toBeGreaterThan(0);
    expect(catches.every((e) => e.type === 'catchEnded' && e.soldier === catcher.id)).toBe(true);
    expect(events.some((e) => e.type === 'soldierHit' && e.soldier === catcher.id)).toBe(true);
  });

  it('refuses a toss next to the merc, a pass within reach and an unknown slot', () => {
    const { sim, merc } = thrower();
    const near = sim.dispatch({ type: 'toss', soldier: merc.id, slot: 'bigPocket1', gridNo: THROWER_AT + 1 });
    expect(near).toMatchObject({ ok: false, data: { refusal: 'tooClose' } });
    catcherFor(sim, gridNo(72, 80));
    const pass = sim.dispatch({ type: 'toss', soldier: merc.id, slot: 'bigPocket1', gridNo: gridNo(72, 80) });
    expect(pass).toMatchObject({ ok: false, data: { refusal: 'passInstead' } });
    expect(sim.dispatch({ type: 'toss', soldier: merc.id, slot: 'bigPocket2', gridNo: FAR_TILE })).toMatchObject({
      ok: false,
      data: { refusal: 'emptySlot' },
    });
    expect(carries(merc)).toBe(true);
  });
});
