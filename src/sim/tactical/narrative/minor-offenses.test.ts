import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { itemId, runExplosivesUntilIdle } from '../../../../tests/support/explosives.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import type { MercProfile } from '../../../content/formats/prof.ts';
import { parseStubProfiles, STUB_PROFILES_PATH } from '../../../content/formats/stub-profiles.ts';
import { Direction, gridNo, WORLD_MAX } from '../../../content/world/grid.ts';
import { i8 } from '../../../core/int.ts';
import { TICK_MS } from '../../clock.ts';
import { createItem } from '../../items/object.ts';
import { Fact } from '../../strategic/narrative/fact-ids.ts';
import { Npc } from '../../strategic/narrative/npc-ids.ts';
import { AiAction } from '../ai/actions.ts';
import type { TacticalContent } from '../content.ts';
import { igniteExplosion, Spread, spreadEffect } from '../explosions/explosion.ts';
import { soldierPickupItem } from '../item-actions.ts';
import { atan8Of } from '../perception/opp.ts';
import { progressFromProfile } from '../profiles.ts';
import { CivilianGroup, NO_PROFILE, OKLIFE, type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { addItemToPool, Visibility } from '../world-items.ts';
import { PICKED_OWNERSHIP_CHECK_DELAY_MS, schedulePickedOwnershipCheck } from './minor-offenses.ts';
import { type NarrativePort, NO_NARRATIVE_PORT } from './port.ts';

let content: TacticalContent;

const SHOP_ROOM = 1;
const BACK_ROOM = 7;
const PISSED_OFF = 0x10;
const GOODGUY = 0x80;
const MERC_AT = gridNo(80, 80);
const SHOP = gridNo(80, 70);
const NEAR_THE_MERC = gridNo(84, 80);
const OUT_OF_SIGHT = gridNo(80, 140);
const OUTSIDE_THE_BLAST = gridNo(100, 70);
const ENEMY_AWAY = gridNo(110, 110);
const SPLINTER_RADIUS = 1;
const CHECK_TICKS = PICKED_OWNERSHIP_CHECK_DELAY_MS / TICK_MS;
const PICKUP_TICKS = 400;

beforeAll(async () => {
  const base = await loadTestContent();
  const json = JSON.parse(readFileSync(join(import.meta.dirname, '../../../..', STUB_PROFILES_PATH), 'utf8'));
  const profiles: MercProfile[] = [...parseStubProfiles(json, (name) => base.items.byName.get(name)?.index)];
  const vasko = profiles[Npc.DAMON];
  if (!vasko) throw new Error('no stub profile for Vasko');
  profiles[Npc.DAMON] = { ...vasko, roomRangeStart: [BACK_ROOM, SHOP_ROOM], roomRangeEnd: [BACK_ROOM + 1, SHOP_ROOM] };
  content = { ...base, profiles };
});

interface Scene {
  readonly sim: TacticalSim;
  readonly t: TacticalState;
  readonly merc: Soldier;
  readonly calls: string[];
}

function scene(rooms: readonly number[] = [], facts: readonly number[] = []): Scene {
  const roomMap = new Uint8Array(WORLD_MAX);
  for (const g of rooms) roomMap[g] = SHOP_ROOM;
  const sim = newCombatSim(content, [], 3, new Set(), () => undefined, { rooms: roomMap });
  const calls: string[] = [];
  const port: NarrativePort = {
    ...NO_NARRATIVE_PORT,
    fact: (id) => facts.includes(id),
    sayHostileQuote: (s) => calls.push(`hostileQuote ${s.profile}`),
  };
  sim.state.narrative = port;
  const merc = spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.NORTH);
  return { sim, t: sim.state, merc, calls };
}

function npc(s: Scene, id: number, profile: number, at: number): Soldier {
  const p = s.t.content.profiles[profile];
  if (p) s.t.profiles.set(profile, progressFromProfile(p));
  const civ = spawnSoldier(s.sim, id, Team.CIV, at, Direction.SOUTH, { profile });
  expect(civ.placed).toBe(true);
  return civ;
}

function miscFlags3(s: Scene, profile: number): number {
  return s.t.profiles.get(profile)?.miscFlags3 ?? 0;
}

function grenade(s: Scene, owner: Soldier | null, at = SHOP): void {
  spreadEffect(s.t, at, SPLINTER_RADIUS, itemId(s.t, 'HAND_GRENADE'), owner, Spread.NORMAL, 0, null);
}

describe('the owner of a building our explosion hits (Explosion_Control.cc HandleBuldingDestruction)', () => {
  it('pisses Lena off with her I-hate-you line, the stub pack giving her A10 room 1, and she stays neutral', () => {
    const s = scene([SHOP]);
    expect([s.t.content.profiles[Npc.ARNIE]?.roomRangeStart[0], s.t.content.profiles[Npc.ARNIE]?.roomRangeEnd[0]]).toEqual([1, 1]);
    const lena = npc(s, 116, Npc.ARNIE, OUTSIDE_THE_BLAST);
    igniteExplosion(s.t, s.merc, 0, SHOP, itemId(s.t, 'HAND_GRENADE'), 0);
    runExplosivesUntilIdle(s.sim);
    expect(s.calls).toEqual([`hostileQuote ${Npc.ARNIE}`]);
    expect(miscFlags3(s, Npc.ARNIE) & PISSED_OFF).toBe(PISSED_OFF);
    expect([lena.neutral, s.t.hostileQuoteList]).toEqual([true, []]);
  });

  it('angers the owner once for every tile of his rooms the blast reaches', () => {
    const s = scene([SHOP, SHOP + 1, SHOP - 1]);
    npc(s, 116, Npc.ARNIE, OUTSIDE_THE_BLAST);
    grenade(s, s.merc);
    expect(s.calls).toEqual(Array.from({ length: 3 }, () => `hostileQuote ${Npc.ARNIE}`));
  });

  it('puts any other owner on the hostile-quote list with his action cancelled, turning to the thrower, by his second room range too', () => {
    const s = scene([SHOP]);
    const vasko = npc(s, 116, Npc.DAMON, OUTSIDE_THE_BLAST);
    vasko.ai.action = AiAction.RANDOM_PATROL;
    grenade(s, s.merc);
    expect(s.t.hostileQuoteList).toEqual([vasko]);
    expect([vasko.ai.action, vasko.ai.nextAction, vasko.ai.nextActionData]).toEqual([
      AiAction.NONE,
      AiAction.CHANGE_FACING,
      atan8Of(vasko, s.merc),
    ]);
    expect(s.calls).toEqual([]);
  });

  it('ignores an explosion of another team or without an owner, and tiles outside the rooms', () => {
    const s = scene([SHOP]);
    npc(s, 116, Npc.ARNIE, OUTSIDE_THE_BLAST);
    const enemy = spawnSoldier(s.sim, 20, Team.ENEMY, ENEMY_AWAY, Direction.SOUTH);
    grenade(s, enemy);
    grenade(s, null);
    grenade(s, s.merc, SHOP + 20);
    expect(s.calls).toEqual([]);
    grenade(s, s.merc);
    expect(s.calls).toEqual([`hostileQuote ${Npc.ARNIE}`]);
  });

  it('spares a good guy while the army is in the sector, a hostile owner and one who is dead', () => {
    const s = scene([SHOP]);
    const lena = npc(s, 116, Npc.ARNIE, OUTSIDE_THE_BLAST);
    const progress = s.t.profiles.get(Npc.ARNIE);
    if (progress) progress.miscFlags3 |= GOODGUY;
    spawnSoldier(s.sim, 20, Team.ENEMY, ENEMY_AWAY, Direction.SOUTH);
    grenade(s, s.merc);
    expect(s.calls).toEqual([]);
    if (progress) progress.miscFlags3 &= ~GOODGUY;
    lena.neutral = false;
    grenade(s, s.merc);
    expect(s.calls).toEqual([]);
    lena.neutral = true;
    lena.life = 0;
    grenade(s, s.merc);
    expect(s.calls).toEqual([]);
    lena.life = 1;
    grenade(s, s.merc);
    expect(s.calls).toEqual([`hostileQuote ${Npc.ARNIE}`]);
  });
});

function ownershipMarker(s: Scene, at: number, profile: number, group: number = CivilianGroup.NONE): void {
  const marker = createItem(s.t.content.items, itemId(s.t, 'OWNERSHIP'), 100);
  marker.status[0] = i8(profile);
  marker.gunAmmoType = group;
  addItemToPool(s.t, at, marker, Visibility.INVISIBLE, 0);
}

function canteen(s: Scene, at: number): void {
  addItemToPool(s.t, at, createItem(s.t.content.items, itemId(s.t, 'CANTEEN'), 100), Visibility.VISIBLE, 0);
}

function stepTicks(s: Scene, ticks: number): void {
  for (let k = 0; k < ticks; k++) s.sim.step();
}

function checkScheduledNow(s: Scene, picker: Soldier, at: number): void {
  schedulePickedOwnershipCheck(s.t, picker, at);
  stepTicks(s, CHECK_TICKS);
  expect(s.t.pickedOwnershipCheck).not.toBeNull();
  s.sim.step();
  expect(s.t.pickedOwnershipCheck).toBeNull();
}

function stepUntilPickedUp(s: Scene): number {
  const canteenOnTheGround = () => s.t.worldItems.some((wi) => wi.object.item === itemId(s.t, 'CANTEEN'));
  for (let k = 0; k < PICKUP_TICKS; k++) {
    s.sim.step();
    if (!canteenOnTheGround()) return s.t.clockMs - TICK_MS;
  }
  throw new Error('nothing was picked up');
}

describe('a pickup from an owned tile (Handle_Items.cc CheckForPickedOwnership)', () => {
  it('angers the owner who sees the picker one second after the pickup, the ownership marker staying on the tile', () => {
    const s = scene();
    npc(s, 116, Npc.ARNIE, NEAR_THE_MERC);
    ownershipMarker(s, MERC_AT, Npc.ARNIE);
    canteen(s, MERC_AT);
    expect(s.sim.dispatch({ type: 'pickUp', soldier: s.merc.id })).toEqual({ ok: true });
    const pickedAt = stepUntilPickedUp(s);
    expect(s.t.pickedOwnershipCheck).toEqual({ picker: s.merc, gridNo: MERC_AT, dueMs: pickedAt + PICKED_OWNERSHIP_CHECK_DELAY_MS });
    stepTicks(s, CHECK_TICKS - 1);
    expect(s.calls).toEqual([]);
    stepTicks(s, 1);
    expect([s.calls, s.t.pickedOwnershipCheck]).toEqual([[`hostileQuote ${Npc.ARNIE}`], null]);
    expect(miscFlags3(s, Npc.ARNIE) & PISSED_OFF).toBe(PISSED_OFF);
  });

  it('leaves an owner alone who cannot see the picker or lies below OKLIFE', () => {
    const calls = [OUT_OF_SIGHT, NEAR_THE_MERC].flatMap((at) => {
      const s = scene();
      const lena = npc(s, 116, Npc.ARNIE, at);
      if (at === NEAR_THE_MERC) lena.life = OKLIFE - 1;
      ownershipMarker(s, MERC_AT, Npc.ARNIE);
      checkScheduledNow(s, s.merc, MERC_AT);
      return s.calls;
    });
    expect(calls).toEqual([]);
  });

  it('checks every member of the owning civilian group who sees the picker, unless the hicks are appeased by a marriage', () => {
    const s = scene();
    const goons = [npc(s, 116, NO_PROFILE, NEAR_THE_MERC), npc(s, 117, NO_PROFILE, NEAR_THE_MERC + 2)];
    for (const goon of goons) goon.civilianGroup = CivilianGroup.KINGPIN;
    ownershipMarker(s, MERC_AT, NO_PROFILE, CivilianGroup.KINGPIN);
    checkScheduledNow(s, s.merc, MERC_AT);
    expect(goons.map((g) => g.neutral)).toEqual([false, false]);

    const married = scene([], [Fact.HICKS_MARRIED_PLAYER_MERC]);
    const hick = npc(married, 116, NO_PROFILE, NEAR_THE_MERC);
    hick.civilianGroup = CivilianGroup.HICKS;
    ownershipMarker(married, MERC_AT, NO_PROFILE, CivilianGroup.HICKS);
    checkScheduledNow(married, married.merc, MERC_AT);
    expect(hick.neutral).toBe(true);
  });

  it('runs only the last pickup check: a second pickup within the second replaces the first', () => {
    const s = scene();
    npc(s, 116, Npc.ARNIE, NEAR_THE_MERC);
    ownershipMarker(s, MERC_AT, Npc.ARNIE);
    schedulePickedOwnershipCheck(s.t, s.merc, MERC_AT);
    stepTicks(s, 2);
    checkScheduledNow(s, s.merc, MERC_AT + 1);
    expect(s.calls).toEqual([]);
  });

  it('angers the owner at an enemy pickup too: the original checks after every soldier who picks up', () => {
    const s = scene();
    npc(s, 116, Npc.ARNIE, NEAR_THE_MERC);
    const enemy = spawnSoldier(s.sim, 20, Team.ENEMY, MERC_AT + 2, Direction.NORTH);
    ownershipMarker(s, enemy.gridNo, Npc.ARNIE);
    canteen(s, enemy.gridNo);
    const loot = s.t.worldItems.filter((wi) => wi.gridNo === enemy.gridNo && wi.object.item === itemId(s.t, 'CANTEEN'));
    expect(soldierPickupItem(s.t, enemy, enemy.gridNo, 0, loot)).toBe(true);
    stepUntilPickedUp(s);
    stepTicks(s, CHECK_TICKS);
    expect(s.calls).toEqual([`hostileQuote ${Npc.ARNIE}`]);
  });
});
