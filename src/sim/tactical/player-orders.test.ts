import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent, testDoorCosts } from '../../../tests/support/tactical.ts';
import { Orientation } from '../../content/formats/jsd.ts';
import { DIRECTION_INCREMENT, Direction, gridNo } from '../../content/world/grid.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import { syntheticStructure, syntheticWorld } from '../../content/world/synthetic.ts';
import type { TacticalWorld } from '../../content/world/tactical-world.ts';
import { attachObject, createItem } from '../items/object.ts';
import { animName } from './anim-states.ts';
import { states } from './animation.ts';
import { WeaponMode } from './combat/types.ts';
import type { TacticalContent } from './content.ts';
import { InvSlot } from './inventory.ts';
import { apsToJumpOver } from './jump-over.ts';
import { apsToJumpFence, facingClimbableWindow } from './player-orders.ts';
import { AP, BP } from './points.ts';
import { Body, Orders, Team } from './soldier.ts';
import { TacticalSim } from './tactical-sim.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const ORIGIN = gridNo(80, 80);
const EAST = DIRECTION_INCREMENT[Direction.EAST] ?? 0;
const SOUTH = DIRECTION_INCREMENT[Direction.SOUTH] ?? 0;
const item = (name: string) => content.items.byName.get(name)?.index ?? 0;

function combat(sim: TacticalSim): void {
  sim.state.inCombat = true;
}

function proneAt(sim: TacticalSim, id: number, at: number) {
  const s = spawnSoldier(sim, id, Team.OUR, at, Direction.SOUTH);
  s.state = states(content.animations).PRONE;
  return s;
}

function simWith(place: Parameters<typeof syntheticWorld>[1]): TacticalSim {
  const base = syntheticWorld(testDoorCosts(), place);
  const world = { ...base, map: { doors: [], placements: [] }, mapPath: 'synthetic' } as unknown as TacticalWorld;
  return new TacticalSim(world, content, 3);
}

describe('stealth and mute (BtnStealthModeCallback, the z key, BtnMuteCallback)', () => {
  it('toggles each listed merc, sets the squad and logs the original lines', () => {
    const sim = newCombatSim(content);
    const a = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
    const b = spawnSoldier(sim, 1, Team.OUR, ORIGIN + 2, Direction.EAST);
    b.stealthMode = true;
    expect(sim.dispatch({ type: 'stealth', soldiers: [0, 1] })).toEqual({ ok: true, data: { soldiers: [0, 1] } });
    expect([a.stealthMode, b.stealthMode]).toEqual([true, false]);
    expect(sim.drainEvents().map((e) => e.type)).toEqual(['stealthChanged', 'stealthChanged']);
    expect(sim.dispatch({ type: 'stealth', soldiers: [0, 1], on: true, squad: true }).ok).toBe(true);
    expect([a.stealthMode, b.stealthMode]).toEqual([true, true]);
    expect(sim.drainEvents()).toMatchObject([{ type: 'squadStealthChanged', soldiers: [0, 1], on: true }]);
  });

  it('skips the robot and refuses while the merc cannot act', () => {
    const sim = newCombatSim(content);
    const robot = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
    robot.bodyType = Body.ROBOTNOWEAPON;
    const merc = spawnSoldier(sim, 1, Team.OUR, ORIGIN + 2, Direction.EAST);
    expect(sim.dispatch({ type: 'stealth', soldiers: [1, 0], on: true })).toEqual({ ok: true, data: { soldiers: [1] } });
    expect(robot.stealthMode).toBe(false);
    merc.life = 5;
    expect(sim.dispatch({ type: 'stealth', soldiers: [1] }).data).toEqual({ refusal: 'cannotAct' });
    expect(sim.dispatch({ type: 'stealth', soldiers: [] }).data).toEqual({ refusal: 'badSoldiers' });
  });

  it('costs one more AP per tile when moving in stealth', () => {
    const sim = newCombatSim(content);
    const s = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
    combat(sim);
    const plain = s.actionPoints;
    expect(sim.dispatch({ type: 'move', soldier: 0, to: ORIGIN + 3 * EAST, mode: 'walk' }).ok).toBe(true);
    runUntilIdle(sim);
    const walked = plain - s.actionPoints;
    s.actionPoints = plain;
    expect(sim.dispatch({ type: 'stealth', soldiers: [0], on: true }).ok).toBe(true);
    expect(sim.dispatch({ type: 'move', soldier: 0, to: ORIGIN, mode: 'walk' }).ok).toBe(true);
    runUntilIdle(sim);
    expect(plain - s.actionPoints).toBe(walked + 3 * AP.STEALTH_MODIFIER);
  });

  it('mutes and unmutes a merc', () => {
    const sim = newCombatSim(content);
    const s = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
    expect(sim.dispatch({ type: 'mute', soldier: 0 })).toEqual({ ok: true, data: { muted: true } });
    expect(s.muted).toBe(true);
    expect(sim.dispatch({ type: 'mute', soldier: 0, on: false })).toEqual({ ok: true, data: { muted: false } });
    expect(sim.drainEvents()).toMatchObject([
      { type: 'muteChanged', soldier: 0, on: true },
      { type: 'muteChanged', soldier: 0, on: false },
    ]);
    expect(sim.dispatch({ type: 'mute', soldier: 9 }).data).toEqual({ refusal: 'noSuchSoldier' });
  });
});

describe('weapon modes (ChangeWeaponMode)', () => {
  it('cycles single, burst and the under-barrel launcher', () => {
    const sim = newCombatSim(content);
    const s = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST, { gun: 'C7' });
    expect(sim.dispatch({ type: 'weaponMode', soldier: 0 })).toEqual({ ok: true, data: { weaponMode: 'burst' } });
    expect(s.doBurst).toBe(1);
    expect(sim.dispatch({ type: 'weaponMode', soldier: 0 })).toEqual({ ok: true, data: { weaponMode: 'single' } });
    const hand = s.inv[InvSlot.HAND];
    if (!hand) throw new Error('no gun');
    expect(attachObject(content.items, hand, createItem(content.items, item('UNDER_GLAUNCHER'), 100))).toBe(true);
    expect(attachObject(content.items, hand, createItem(content.items, item('GL_HE_GRENADE'), 100))).toBe(true);
    expect(sim.dispatch({ type: 'weaponMode', soldier: 0 }).data).toEqual({ weaponMode: 'burst' });
    expect(sim.dispatch({ type: 'weaponMode', soldier: 0 }).data).toEqual({ weaponMode: 'launcher' });
    expect(s.weaponMode).toBe(WeaponMode.ATTACHED);
    expect(sim.dispatch({ type: 'weaponMode', soldier: 0 }).data).toEqual({ weaponMode: 'single' });
    expect(sim.dispatch({ type: 'weaponMode', soldier: 0, mode: 'launcher' }).data).toEqual({ weaponMode: 'launcher' });
  });

  it('refuses a gun without burst or launcher with the original message', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST, { gun: 'GLOCK_17' });
    expect(sim.dispatch({ type: 'weaponMode', soldier: 0 }).data).toEqual({ refusal: 'noBurst' });
    expect(sim.dispatch({ type: 'weaponMode', soldier: 0, mode: 'launcher' }).data).toEqual({ refusal: 'noLauncher' });
    expect(sim.dispatch({ type: 'weaponMode', soldier: 0, mode: 'auto' }).data).toEqual({ refusal: 'badMode' });
  });

  it('fires the mode the merc is in when the attack names none', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.SOUTH, { gun: 'MP5K', marksmanship: 90 });
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, ORIGIN + 6 * SOUTH, Direction.NORTH);
    sim.lookAround();
    combat(sim);
    expect(sim.dispatch({ type: 'weaponMode', soldier: 0, mode: 'burst' }).ok).toBe(true);
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo }).ok).toBe(true);
    const shots = runUntilIdle(sim).filter((e) => e.type === 'shotFired');
    expect(shots).toHaveLength(content.items.byName.get('MP5K')?.weapon?.shotsPerBurst ?? 0);
  });

  it('launches the attached grenade in launcher mode', () => {
    const sim = newCombatSim(content);
    const s = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.SOUTH, { gun: 'C7' });
    const hand = s.inv[InvSlot.HAND];
    if (!hand) throw new Error('no gun');
    attachObject(content.items, hand, createItem(content.items, item('UNDER_GLAUNCHER'), 100));
    attachObject(content.items, hand, createItem(content.items, item('GL_HE_GRENADE'), 100));
    expect(sim.dispatch({ type: 'weaponMode', soldier: 0, mode: 'launcher' }).ok).toBe(true);
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: ORIGIN + 8 * SOUTH }).ok).toBe(true);
    const events = runUntilIdle(sim);
    expect(events.some((e) => e.type === 'explosion')).toBe(true);
    expect(hand.attachments.some((a) => a.item === item('GL_HE_GRENADE'))).toBe(false);
  });
});

describe('spread bursts (PickBurstLocations)', () => {
  it('spreads the shots evenly over the dragged tiles', () => {
    const sim = newCombatSim(content);
    const s = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.SOUTH, { gun: 'MP5K' });
    combat(sim);
    const tiles = [0, 1, 2].map((k) => ORIGIN + 6 * SOUTH + k * EAST);
    expect(sim.dispatch({ type: 'attack', soldier: 0, target: tiles[2], burst: true, spread: [...tiles, tiles[0]] }).ok).toBe(true);
    const shots = content.items.byName.get('MP5K')?.weapon?.shotsPerBurst ?? 0;
    const step = Math.fround(tiles.length / shots);
    const expected = Array.from({ length: shots }, (_, k) => tiles[Math.trunc(Math.fround(k * step))]);
    expect(s.spreadLocations.slice(0, shots)).toEqual(expected);
    const fired = runUntilIdle(sim).filter((e) => e.type === 'shotFired');
    expect(fired).toHaveLength(shots);
    expect(s.doSpread).toBe(0);
  });

  it('needs the burst mode and visible tiles', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.SOUTH, { gun: 'MP5K' });
    const target = ORIGIN + 6 * SOUTH;
    expect(sim.dispatch({ type: 'attack', soldier: 0, target, spread: [target] }).data).toEqual({ refusal: 'noBurst' });
    expect(sim.dispatch({ type: 'attack', soldier: 0, target, burst: true, spread: [-4] }).data).toEqual({ refusal: 'badSpread' });
  });
});

describe('reverse moves (bReverse)', () => {
  it('walks backwards for one more AP per tile', () => {
    const sim = newCombatSim(content);
    const s = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
    combat(sim);
    const full = s.actionPoints;
    expect(sim.dispatch({ type: 'move', soldier: 0, to: ORIGIN + 3 * EAST, mode: 'walk' }).ok).toBe(true);
    runUntilIdle(sim);
    const forward = full - s.actionPoints;
    s.actionPoints = full;
    expect(sim.dispatch({ type: 'move', soldier: 0, to: ORIGIN, mode: 'walk', reverse: true }).ok).toBe(true);
    runUntilIdle(sim);
    expect(full - s.actionPoints).toBe(forward + 3 * AP.REVERSE_MODIFIER);
    expect(s.gridNo).toBe(ORIGIN);
    expect(s.direction).toBe(Direction.EAST);
  });
});

describe('exchanging places', () => {
  it('swaps with an adjacent merc for AP_EXCHANGE_PLACES each (the x key)', () => {
    const sim = newCombatSim(content);
    const a = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
    const b = spawnSoldier(sim, 1, Team.OUR, ORIGIN + EAST, Direction.WEST);
    combat(sim);
    const [apA, apB] = [a.actionPoints, b.actionPoints];
    expect(sim.dispatch({ type: 'swapPlaces', soldier: 0, with: 1 })).toEqual({ ok: true });
    expect([a.gridNo, b.gridNo]).toEqual([ORIGIN + EAST, ORIGIN]);
    expect([apA - a.actionPoints, apB - b.actionPoints]).toEqual([AP.EXCHANGE_PLACES, AP.EXCHANGE_PLACES]);
    expect(sim.drainEvents().some((e) => e.type === 'placesSwapped')).toBe(true);
  });

  it('refuses enemies, a merc too far and a tired partner', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
    const far = spawnSoldier(sim, 1, Team.OUR, ORIGIN + 3 * EAST, Direction.WEST);
    spawnSoldier(sim, 20, Team.ENEMY, ORIGIN + SOUTH, Direction.NORTH);
    combat(sim);
    expect(sim.dispatch({ type: 'swapPlaces', soldier: 0, with: 1 }).data).toEqual({ refusal: 'notAdjacent' });
    expect(sim.dispatch({ type: 'swapPlaces', soldier: 0, with: 20 }).data).toEqual({ refusal: 'hostileTarget' });
    far.gridNo = ORIGIN + 3 * EAST;
    expect(sim.dispatch({ type: 'swapPlaces', soldier: 0, with: 7 }).data).toEqual({ refusal: 'noSuchTarget' });
  });

  it('swaps for free with a civilian through the exchange cursor', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
    const civ = spawnSoldier(sim, 116, Team.CIV, ORIGIN + EAST, Direction.WEST);
    civ.ai.orders = Orders.FARPATROL;
    sim.lookAround();
    combat(sim);
    const ap = merc.actionPoints;
    expect(sim.dispatch({ type: 'swapPlaces', soldier: 0, with: 116, cursor: true })).toEqual({ ok: true });
    expect([merc.gridNo, civ.gridNo]).toEqual([ORIGIN + EAST, ORIGIN]);
    expect(merc.actionPoints).toBe(ap);
  });
});

describe('jumping', () => {
  it('jumps over a prone merc two tiles away for the stand-up plus AP_JUMP_OVER', () => {
    const sim = newCombatSim(content);
    const jumper = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.SOUTH);
    proneAt(sim, 1, ORIGIN + SOUTH);
    combat(sim);
    const ap = jumper.actionPoints;
    const cost = apsToJumpOver(sim.state, jumper);
    expect(sim.dispatch({ type: 'jump', soldier: 0, to: ORIGIN + 2 * SOUTH })).toEqual({ ok: true, data: { to: ORIGIN + 2 * SOUTH } });
    const seen = new Set<string>();
    for (let i = 0; i < 5000 && !sim.isIdle(); i++) {
      sim.step();
      seen.add(animName(content, jumper.state));
    }
    expect(seen).toContain('JUMP_OVER_BLOCKING_PERSON');
    expect(jumper.gridNo).toBe(ORIGIN + 2 * SOUTH);
    expect(ap - jumper.actionPoints).toBe(cost);
    expect(sim.dispatch({ type: 'jump', soldier: 0, to: ORIGIN + 4 * SOUTH }).data).toEqual({ refusal: 'invalidJump' });
  });

  it('jumps a fence next to the merc (the climb button) and refuses without one', () => {
    const fence = ORIGIN + EAST;
    const sim = simWith((structures) =>
      structures.add(fence, 0, syntheticStructure(StructureFlags.FENCE, Orientation.NONE, { height: 1 })),
    );
    const s = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.SOUTH);
    combat(sim);
    const ap = s.actionPoints;
    expect(apsToJumpFence(sim.state, s)).toBe(AP.JUMPFENCE);
    expect(sim.dispatch({ type: 'jump', soldier: 0 })).toEqual({ ok: true, data: { direction: Direction.EAST } });
    runUntilIdle(sim);
    expect(s.gridNo).toBe(ORIGIN + 2 * EAST);
    expect(ap - s.actionPoints).toBeGreaterThanOrEqual(AP.JUMPFENCE);
    const open = newCombatSim(content);
    spawnSoldier(open, 0, Team.OUR, ORIGIN, Direction.SOUTH);
    expect(open.dispatch({ type: 'jump', soldier: 0 }).data).toEqual({ refusal: 'noFence' });
  });
});

describe('climbing through a window (Stracciatella, SHIFT+J)', () => {
  it('teleports through an open window the merc faces for AP_JUMPFENCE', () => {
    const window = ORIGIN;
    const sim = simWith((structures) =>
      structures.add(window, 0, syntheticStructure(StructureFlags.WALLNWINDOW | StructureFlags.OPEN, Orientation.INSIDE_LEFT)),
    );
    const s = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.SOUTH);
    combat(sim);
    expect(facingClimbableWindow(sim.state, s)).toBe(true);
    const [ap, breath] = [s.actionPoints, s.breath];
    expect(sim.dispatch({ type: 'climbWindow', soldier: 0 })).toEqual({ ok: true, data: { to: ORIGIN + SOUTH } });
    expect(s.gridNo).toBe(ORIGIN + SOUTH);
    expect(ap - s.actionPoints).toBe(AP.JUMPFENCE);
    expect(breath - s.breath).toBeGreaterThanOrEqual(0);
    expect(BP.JUMPFENCE).toBeGreaterThan(0);
    s.direction = Direction.EAST;
    expect(sim.dispatch({ type: 'climbWindow', soldier: 0 }).data).toEqual({ refusal: 'noWindow' });
  });
});

describe('group moves (HandleMultiSelectionMove, the all-move)', () => {
  it('sends every listed merc through people, by stance unless running', () => {
    const sim = newCombatSim(content);
    const a = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
    const b = spawnSoldier(sim, 1, Team.OUR, ORIGIN + SOUTH, Direction.EAST);
    expect(sim.dispatch({ type: 'moveGroup', soldiers: [0, 1], to: ORIGIN + 5 * EAST, mode: 'run' })).toEqual({
      ok: true,
      data: { moved: [0, 1], noPath: [] },
    });
    expect([a.uiMovementMode, b.uiMovementMode]).toEqual([states(content.animations).RUNNING, states(content.animations).RUNNING]);
    runUntilIdle(sim);
    expect([a.gridNo, b.gridNo].sort()).toContain(ORIGIN + 5 * EAST);
  });

  it('is a real-time order', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
    combat(sim);
    expect(sim.dispatch({ type: 'moveGroup', soldiers: [0], to: ORIGIN + 5 * EAST }).data).toEqual({ refusal: 'realTimeOnly' });
  });
});

describe('combining stacks (CleanUpStack, CTRL+click)', () => {
  it('fills the lower magazines from the upper ones and drops the emptied one', () => {
    const sim = newCombatSim(content);
    const s = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
    const mag = item('CLIP9_15');
    const capacity = content.items.byIndex.get(mag)?.magazine?.capacity ?? 0;
    const stack = createItem(content.items, mag, 5);
    stack.count = 3;
    stack.status = [5, capacity, 4];
    s.inv[InvSlot.BIGPOCK1] = stack;
    expect(sim.dispatch({ type: 'combineStack', soldier: 0, slot: InvSlot.BIGPOCK1 })).toEqual({ ok: true, data: { combined: true } });
    expect(stack.count).toBe(2);
    expect(stack.status.slice(0, 2)).toEqual([capacity, 9]);
  });

  it('pours the cursor stack into the slot and leaves the rest in its pocket', () => {
    const sim = newCombatSim(content);
    const s = spawnSoldier(sim, 0, Team.OUR, ORIGIN, Direction.EAST);
    const mag = item('CLIP9_15');
    const capacity = content.items.byIndex.get(mag)?.magazine?.capacity ?? 0;
    const target = createItem(content.items, mag, capacity);
    target.status = [capacity - 3];
    const source = createItem(content.items, mag, capacity);
    source.status = [2];
    s.inv[InvSlot.BIGPOCK1] = target;
    s.inv[InvSlot.BIGPOCK2] = source;
    expect(sim.dispatch({ type: 'combineStack', soldier: 0, slot: InvSlot.BIGPOCK1, from: InvSlot.BIGPOCK2 }).ok).toBe(true);
    expect(target.status[0]).toBe(capacity - 1);
    expect(source.count).toBe(0);
    const gun = createItem(content.items, item('GLOCK_17'), 100);
    s.inv[InvSlot.BIGPOCK3] = gun;
    expect(sim.dispatch({ type: 'combineStack', soldier: 0, slot: InvSlot.BIGPOCK3 }).data).toEqual({ combined: false });
  });
});
