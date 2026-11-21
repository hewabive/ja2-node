import { beforeAll, describe, expect, it } from 'vitest';
import { progressFor } from '../../../tests/support/autoresolve.ts';
import { estimateAttack, newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { ItemClass } from '../../content/items/items.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { createItem, createItems, createMoney, type ItemObject } from '../items/object.ts';
import { ScriptedStream } from '../strategic/forces/autoresolve/replay-rng.ts';
import { animName } from './anim-states.ts';
import type { TacticalContent } from './content.ts';
import { createKeyObject } from './doors/keys.ts';
import { AP_RELOAD_GUN, apsToReloadGunWithAmmo, InvSlot, itemIn } from './inventory.ts';
import { attachmentsChanged } from './item-description-box.ts';
import { AP } from './points.ts';
import { type Soldier, Team } from './soldier.ts';
import type { TacticalSim } from './tactical-sim.ts';

let content: TacticalContent;

const MERC_PROFILE = 5;
const MALE = 0;
const FEMALE = 1;

beforeAll(async () => {
  content = await loadTestContent();
});

const item = (name: string) => content.items.byName.get(name)?.index ?? -1;
const itemAt = (s: Soldier, slot: number) => content.items.byIndex.get(itemIn(s.inv, slot))?.name ?? 'NOTHING';

function inCombat(sim: TacticalSim): void {
  spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 95), Direction.NORTH);
  sim.lookAround();
  expect(sim.state.inCombat).toBe(true);
}

function magazines(s: Soldier, slot: number, name: string, rounds: readonly number[]): void {
  const o = createItems(content.items, item(name), 100, rounds.length);
  o.status = [...rounds];
  s.inv[slot] = o;
}

function glockWith(s: Soldier, rounds: number): void {
  const gun = createItem(content.items, item('GLOCK_17'), 100);
  gun.gunShotsLeft = rounds;
  s.inv[InvSlot.HAND] = gun;
}

const roundsIn = (s: Soldier, slot: number): number[] => (s.inv[slot]?.status ?? []).slice(0, s.inv[slot]?.count ?? 0);

describe('moving items inside one inventory', () => {
  it('puts a pocket item into the hand, swapping the old hand item back into the pocket, for free in combat', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    merc.inv[InvSlot.BIGPOCK1] = createItem(content.items, item('HAND_GRENADE'), 100);
    inCombat(sim);
    const before = merc.actionPoints;
    const moved = sim.dispatch({ type: 'moveItem', soldier: 0, from: 'bigPocket1', to: 'hand' });
    expect(moved).toMatchObject({ ok: true, data: { item: 'HAND_GRENADE', count: 1 } });
    expect(itemAt(merc, InvSlot.HAND)).toBe('HAND_GRENADE');
    expect(itemAt(merc, InvSlot.BIGPOCK1)).toBe('GLOCK_17');
    expect(merc.actionPoints).toBe(before);
    expect(sim.drainEvents().find((e) => e.type === 'itemMoved')).toMatchObject({ soldier: 0, item: 'HAND_GRENADE', from: 7, to: 5 });
  });

  it('moves one object of a stack with count 1 and refuses armour in the wrong slot', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    merc.inv[InvSlot.BIGPOCK1] = createItems(content.items, item('CLIP9_15'), 100, 4);
    merc.inv[InvSlot.BIGPOCK2] = createItem(content.items, item('FLAK_JACKET'), 90);
    expect(sim.dispatch({ type: 'moveItem', soldier: 0, from: 7, to: 'smallPocket1', count: 1 })).toMatchObject({ ok: true });
    expect(merc.inv[InvSlot.BIGPOCK1]?.count).toBe(3);
    expect(merc.inv[InvSlot.SMALLPOCK1]?.count).toBe(1);
    expect(sim.dispatch({ type: 'moveItem', soldier: 0, from: 'bigPocket2', to: 'helmet' })).toMatchObject({
      ok: false,
      data: { refusal: 'doesNotFit' },
    });
    expect(sim.dispatch({ type: 'moveItem', soldier: 0, from: 'bigPocket2', to: 'vest' })).toMatchObject({ ok: true });
    expect(itemAt(merc, InvSlot.VEST)).toBe('FLAK_JACKET');
  });

  it('puts one object taken off a stack back at the end of that stack, as PlaceObject stacks it there', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    magazines(merc, InvSlot.BIGPOCK1, 'CLIP9_15', [15, 7, 3]);
    merc.inv[InvSlot.BIGPOCK2] = createItem(content.items, item('CLIP9_15'), 100);
    const back = { type: 'moveItem', soldier: 0, from: 'bigPocket1', to: 'bigPocket1', count: 1 };
    expect(sim.dispatch(back)).toEqual({ ok: true, data: { item: 'CLIP9_15', count: 1 } });
    expect(roundsIn(merc, InvSlot.BIGPOCK1)).toEqual([7, 3, 15]);
    expect(sim.dispatch({ ...back, index: 1 })).toMatchObject({ ok: true });
    expect(roundsIn(merc, InvSlot.BIGPOCK1)).toEqual([7, 15, 3]);
    expect(sim.dispatch({ ...back, count: 'all' })).toMatchObject({ ok: false, data: { refusal: 'sameSlot' } });
    expect(sim.dispatch({ ...back, from: 'bigPocket2', to: 'bigPocket2' })).toMatchObject({ ok: false, data: { refusal: 'sameSlot' } });
  });

  it('asks before merging on a hand item and attaches through attach', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    merc.inv[InvSlot.HAND] = createItem(content.items, item('FIRSTAIDKIT'), 40);
    merc.inv[InvSlot.BIGPOCK1] = createItem(content.items, item('FIRSTAIDKIT'), 30);
    expect(sim.dispatch({ type: 'moveItem', soldier: 0, from: 'bigPocket1', to: 'hand' })).toMatchObject({
      ok: false,
      data: { refusal: 'mergePrompt' },
    });
    expect(sim.dispatch({ type: 'moveItem', soldier: 0, from: 'bigPocket1', to: 'hand', merge: true })).toMatchObject({
      ok: true,
      data: { result: 'merged' },
    });
    expect(merc.inv[InvSlot.HAND]?.status[0]).toBe(70);
    expect(itemAt(merc, InvSlot.BIGPOCK1)).toBe('NOTHING');
    merc.inv[InvSlot.HAND] = createItem(content.items, item('GLOCK_17'), 100);
    merc.inv[InvSlot.BIGPOCK2] = createItem(content.items, item('SILENCER'), 90);
    expect(sim.dispatch({ type: 'moveItem', soldier: 0, from: 'bigPocket2', to: 'hand' })).toMatchObject({
      ok: false,
      data: { refusal: 'useAttach' },
    });
    expect(sim.dispatch({ type: 'attach', soldier: 0, item: 'bigPocket2', to: 'hand' })).toMatchObject({
      ok: true,
      data: { result: 'attached' },
    });
    expect(merc.inv[InvSlot.HAND]?.attachments[0]?.item).toBe(item('SILENCER'));
    expect(sim.dispatch({ type: 'detach', soldier: 0, slot: 'hand', attachment: 'SILENCER' })).toMatchObject({ ok: true });
    expect(merc.inv.some((o) => o.item === item('SILENCER'))).toBe(true);
    expect(merc.inv[InvSlot.HAND]?.attachments[0]?.item).toBe(0);
  });

  it('treats armour with compound 18 for AP_MERGE in combat and pours magazine rounds into the chosen stack object', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    merc.inv[InvSlot.VEST] = createItem(content.items, item('KEVLAR_VEST'), 80);
    merc.inv[InvSlot.BIGPOCK1] = createItem(content.items, item('COMPOUND18'), 100);
    merc.inv[InvSlot.BIGPOCK2] = createItems(content.items, item('CLIP9_15'), 100, 2);
    merc.inv[InvSlot.SMALLPOCK1] = createItem(content.items, item('CLIP9_15'), 100);
    (merc.inv[InvSlot.BIGPOCK2] as { status: number[] }).status = [15, 4];
    (merc.inv[InvSlot.SMALLPOCK1] as { status: number[] }).status = [6];
    inCombat(sim);
    const ap = merc.actionPoints;
    expect(sim.dispatch({ type: 'attach', soldier: 0, item: 'bigPocket1', to: 'vest' })).toMatchObject({
      ok: true,
      data: { result: 'merged' },
    });
    expect(itemAt(merc, InvSlot.VEST)).toBe('KEVLAR_VEST_18');
    expect(merc.inv[InvSlot.VEST]?.status[0]).toBe(80);
    expect(ap - merc.actionPoints).toBe(AP.MERGE);
    expect(sim.dispatch({ type: 'attach', soldier: 0, item: 'smallPocket1', to: 'bigPocket2', index: 1 })).toMatchObject({
      ok: true,
      data: { result: 'merged' },
    });
    expect(merc.inv[InvSlot.BIGPOCK2]?.status.slice(0, 2)).toEqual([15, 10]);
    expect(itemAt(merc, InvSlot.SMALLPOCK1)).toBe('NOTHING');
    expect(ap - merc.actionPoints).toBe(AP.MERGE);
  });

  it('swaps the hands and lowers a rifle when the pistol comes up', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { gun: 'MP5K' });
    merc.inv[InvSlot.SECOND_HAND] = createItem(content.items, item('GLOCK_17'), 100);
    expect(sim.dispatch({ type: 'swapHands', soldier: 0 })).toEqual({ ok: true });
    expect(itemAt(merc, InvSlot.HAND)).toBe('GLOCK_17');
    expect(itemAt(merc, InvSlot.SECOND_HAND)).toBe('MP5K');
    expect(['LOWER_RIFLE', 'STANDING']).toContain(animName(t.content, merc.state));
  });
});

describe('what an attachment or merge sounds like (Items.cc AttachObject)', () => {
  function attached(sim: TacticalSim) {
    return sim.drainEvents().filter((e) => e.type === 'itemAttached');
  }

  function failsEveryCheck(sim: TacticalSim): void {
    Object.assign(sim.state, { pre: new ScriptedStream([], 99) });
  }

  function passesEveryCheck(sim: TacticalSim): void {
    Object.assign(sim.state, { pre: new ScriptedStream([], 0) });
  }

  function merc(sim: TacticalSim): Soldier {
    const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { profile: MERC_PROFILE });
    sim.drainEvents();
    return s;
  }

  it('plays the sound of the host for an attachment: gun, armour or bomb', () => {
    const sim = newCombatSim(content);
    const s = merc(sim);
    passesEveryCheck(sim);
    s.inv[InvSlot.BIGPOCK1] = createItem(content.items, item('SILENCER'), 90);
    s.inv[InvSlot.VEST] = createItem(content.items, item('KEVLAR_VEST'), 90);
    s.inv[InvSlot.BIGPOCK2] = createItem(content.items, item('CERAMIC_PLATES'), 90);
    s.inv[InvSlot.BIGPOCK3] = createItem(content.items, item('TNT'), 90);
    s.inv[InvSlot.BIGPOCK4] = createItem(content.items, item('DETONATOR'), 90);
    const attach = (from: string, to: string) =>
      expect(sim.dispatch({ type: 'attach', soldier: 0, item: from, to })).toMatchObject({ ok: true });
    attach('bigPocket1', 'hand');
    attach('bigPocket2', 'vest');
    attach('bigPocket4', 'bigPocket3');
    expect(attached(sim).map((e) => [e.result, e.sound, e.reaction])).toEqual([
      ['attached', 'ATTACH_TO_GUN', undefined],
      ['attached', 'ATTACH_CERAMIC_PLATES', undefined],
      ['attached', 'ATTACH_DETONATOR', undefined],
    ]);
  });

  it('has the merc curse an attachment that fails its skill check, without the sound of a success', () => {
    const sim = newCombatSim(content);
    const s = merc(sim);
    s.stats.mechanical = 1;
    s.inv[InvSlot.BIGPOCK1] = createItem(content.items, item('GUN_BARREL_EXTENDER'), 90);
    failsEveryCheck(sim);
    expect(sim.dispatch({ type: 'attach', soldier: 0, item: 'bigPocket1', to: 'hand', permanent: true })).toMatchObject({
      ok: true,
      data: { result: 'failedCheck' },
    });
    expect(attached(sim).map((e) => [e.sound, e.reaction])).toEqual([[undefined, 'CURSE1']]);
  });

  it('has the merc say COOL1 for a merge that makes a new item, nothing for pooled points, and curse one that destroys both', () => {
    const sim = newCombatSim(content);
    const s = merc(sim);
    s.inv[InvSlot.VEST] = createItem(content.items, item('KEVLAR_VEST'), 80);
    s.inv[InvSlot.BIGPOCK1] = createItem(content.items, item('COMPOUND18'), 100);
    s.inv[InvSlot.SECOND_HAND] = createItem(content.items, item('FIRSTAIDKIT'), 40);
    s.inv[InvSlot.BIGPOCK2] = createItem(content.items, item('FIRSTAIDKIT'), 30);
    s.inv[InvSlot.LEGS] = createItem(content.items, item('KEVLAR_LEGGINGS_Y'), 80);
    s.inv[InvSlot.BIGPOCK3] = createItem(content.items, item('COMPOUND18'), 100);
    const attach = (from: string, to: string) =>
      expect(sim.dispatch({ type: 'attach', soldier: 0, item: from, to })).toMatchObject({ ok: true });
    attach('bigPocket1', 'vest');
    attach('bigPocket2', 'secondHand');
    attach('bigPocket3', 'legs');
    expect(attached(sim).map((e) => [e.result, e.reaction])).toEqual([
      ['merged', 'COOL1'],
      ['merged', undefined],
      ['destroyed', 'CURSE1'],
    ]);
  });
});

describe('what a refused attachment tells (Items.cc ValidItemAttachment, PlaceObject)', () => {
  const gunTaking = (wanted: readonly string[]) =>
    [...content.items.byIndex.values()].find((d) => wanted.every((a) => d.weapon?.attachments.includes(a)))?.index ?? -1;
  const gunRefusing = (attachment: string) =>
    [...content.items.byIndex.values()].find((d) => d.weapon && d.itemClass === ItemClass.GUN && !d.weapon.attachments.includes(attachment))
      ?.index ?? -1;

  function armed(gun: number, attachment: string) {
    const sim = newCombatSim(content);
    const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    s.inv[InvSlot.HAND] = createItem(content.items, gun, 100);
    s.inv[InvSlot.BIGPOCK1] = createItem(content.items, item(attachment), 90);
    sim.drainEvents();
    return { sim, s, attach: () => sim.dispatch({ type: 'attach', soldier: 0, item: 'bigPocket1', to: 'hand' }) };
  }

  const complaints = (sim: TacticalSim) => sim.drainEvents().flatMap((e) => (e.type === 'attachmentRefused' ? [e.complaint] : []));

  it('names both items when the attachment is of the kind the host class takes, but not for this host', () => {
    const gun = gunRefusing('SILENCER');
    const { sim, attach } = armed(gun, 'SILENCER');
    expect(attach()).toMatchObject({ ok: false, data: { refusal: 'cannotAttach' } });
    expect(complaints(sim)).toEqual([{ kind: 'cannotAttach', item: item('SILENCER'), to: gun }]);
  });

  it('says nothing about an item of no attachment class at all', () => {
    const { sim, attach } = armed(item('GLOCK_17'), 'FIRSTAIDKIT');
    expect(attach()).toMatchObject({ ok: false, data: { refusal: 'cannotAttach' } });
    expect(complaints(sim)).toEqual([]);
  });

  it('says the host already has it, the two detonators counting as one', () => {
    const { sim, s, attach } = armed(item('GLOCK_17'), 'SILENCER');
    (s.inv[InvSlot.HAND] as { attachments: { item: number; status: number }[] }).attachments[0] = { item: item('SILENCER'), status: 90 };
    expect(attach()).toMatchObject({ ok: false });
    expect(complaints(sim)).toEqual([{ kind: 'alreadyAttached' }]);
    const bomb = armed(item('TNT'), 'REMDETONATOR');
    (bomb.s.inv[InvSlot.HAND] as { attachments: { item: number; status: number }[] }).attachments[0] = {
      item: item('DETONATOR'),
      status: 90,
    };
    expect(bomb.attach()).toMatchObject({ ok: false });
    expect(complaints(bomb.sim)).toEqual([{ kind: 'alreadyAttached' }]);
  });

  it('names the two items that exclude each other, the one on the gun first', () => {
    const { sim, s, attach } = armed(gunTaking(['BIPOD', 'UNDER_GLAUNCHER']), 'BIPOD');
    (s.inv[InvSlot.HAND] as { attachments: { item: number; status: number }[] }).attachments[0] = {
      item: item('UNDER_GLAUNCHER'),
      status: 90,
    };
    expect(attach()).toMatchObject({ ok: false });
    expect(complaints(sim)).toEqual([{ kind: 'cannotUseBoth', first: item('UNDER_GLAUNCHER'), second: item('BIPOD') }]);
  });

  it('names two face items that do not go together when one is moved next to the other', () => {
    const sim = newCombatSim(content);
    const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    s.inv[InvSlot.HEAD1] = createItem(content.items, item('SUNGOGGLES'), 90);
    s.inv[InvSlot.BIGPOCK1] = createItem(content.items, item('NIGHTGOGGLES'), 90);
    sim.drainEvents();
    expect(sim.dispatch({ type: 'moveItem', soldier: 0, from: 'bigPocket1', to: 'head2' })).toMatchObject({
      ok: false,
      data: { refusal: 'doesNotFit' },
    });
    expect(complaints(sim)).toEqual([{ kind: 'cannotUseBoth', first: item('NIGHTGOGGLES'), second: item('SUNGOGGLES') }]);
  });
});

describe('reloading two guns with the points for one (Items.cc AutoReload)', () => {
  it('reloads the hand gun and says the second stays empty', () => {
    const sim = newCombatSim(content);
    const s = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { profile: MERC_PROFILE });
    glockWith(s, 0);
    const second = createItem(content.items, item('GLOCK_17'), 100);
    second.gunShotsLeft = 0;
    s.inv[InvSlot.SECOND_HAND] = second;
    s.inv[InvSlot.BIGPOCK1] = createItems(content.items, item('CLIP9_15'), 100, 2);
    inCombat(sim);
    s.actionPoints = apsToReloadGunWithAmmo(content.items, s.inv[InvSlot.HAND] as ItemObject, s.inv[InvSlot.BIGPOCK1] as ItemObject);
    sim.drainEvents();
    expect(sim.dispatch({ type: 'reload', soldier: 0 })).toMatchObject({ ok: true });
    expect(s.inv[InvSlot.HAND]?.gunShotsLeft).toBeGreaterThan(0);
    expect(second.gunShotsLeft).toBe(0);
    expect(sim.drainEvents().filter((e) => e.type === 'reloadedOneGunOnly')).toEqual([expect.objectContaining({ soldier: 0 })]);
  });
});

describe('the AP of a plain attach or detach, a description box of its own (DeleteItemDescriptionBox)', () => {
  function gunner(sim: TacticalSim): Soldier {
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    merc.inv[InvSlot.HAND] = createItem(content.items, item('GLOCK_17'), 100);
    merc.inv[InvSlot.BIGPOCK2] = createItem(content.items, item('SILENCER'), 90);
    return merc;
  }

  it('charges AP_RELOAD_GUN in combat for an accepted attach and for an accepted detach', () => {
    const sim = newCombatSim(content);
    const merc = gunner(sim);
    inCombat(sim);
    const ap = merc.actionPoints;
    expect(sim.dispatch({ type: 'attach', soldier: 0, item: 'bigPocket2', to: 'hand' })).toMatchObject({
      ok: true,
      data: { result: 'attached' },
    });
    expect(ap - merc.actionPoints).toBe(AP_RELOAD_GUN);
    expect(sim.dispatch({ type: 'detach', soldier: 0, slot: 'hand', attachment: 'SILENCER' })).toMatchObject({ ok: true });
    expect(ap - merc.actionPoints).toBe(2 * AP_RELOAD_GUN);
  });

  it("charges the merc whose item is attached when it goes onto another merc's gun", () => {
    const sim = newCombatSim(content);
    const owner = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    owner.inv[InvSlot.HAND] = createItem(content.items, item('GLOCK_17'), 100);
    const attacher = spawnSoldier(sim, 1, Team.OUR, gridNo(81, 80), Direction.SOUTH);
    attacher.inv[InvSlot.BIGPOCK2] = createItem(content.items, item('SILENCER'), 90);
    inCombat(sim);
    const [ownerAp, attacherAp] = [owner.actionPoints, attacher.actionPoints];
    expect(sim.dispatch({ type: 'attach', soldier: 1, item: 'bigPocket2', to: 'hand', toSoldier: 0 })).toMatchObject({ ok: true });
    expect(owner.inv[InvSlot.HAND]?.attachments[0]?.item).toBe(item('SILENCER'));
    expect(attacherAp - attacher.actionPoints).toBe(AP_RELOAD_GUN);
    expect(owner.actionPoints).toBe(ownerAp);
  });

  it('charges nothing out of combat, for a refused attach or for a merge that leaves the attachments alone', () => {
    const calm = newCombatSim(content);
    const relaxed = gunner(calm);
    const calmAp = relaxed.actionPoints;
    expect(calm.dispatch({ type: 'attach', soldier: 0, item: 'bigPocket2', to: 'hand' })).toMatchObject({ ok: true });
    expect(calm.dispatch({ type: 'detach', soldier: 0, slot: 'hand', attachment: 'SILENCER' })).toMatchObject({ ok: true });
    expect(relaxed.actionPoints).toBe(calmAp);

    const sim = newCombatSim(content);
    const merc = gunner(sim);
    merc.inv[InvSlot.VEST] = createItem(content.items, item('KEVLAR_VEST'), 80);
    merc.inv[InvSlot.SECOND_HAND] = createItem(content.items, item('FIRSTAIDKIT'), 40);
    merc.inv[InvSlot.BIGPOCK1] = createItem(content.items, item('FIRSTAIDKIT'), 30);
    inCombat(sim);
    const ap = merc.actionPoints;
    expect(sim.dispatch({ type: 'attach', soldier: 0, item: 'bigPocket2', to: 'vest' })).toMatchObject({
      ok: false,
      data: { refusal: 'cannotAttach' },
    });
    expect(sim.dispatch({ type: 'attach', soldier: 0, item: 'bigPocket1', to: 'secondHand' })).toMatchObject({
      ok: true,
      data: { result: 'merged' },
    });
    expect(merc.actionPoints).toBe(ap);
    merc.actionPoints = AP_RELOAD_GUN - 1;
    expect(sim.dispatch({ type: 'attach', soldier: 0, item: 'bigPocket2', to: 'hand' })).toMatchObject({
      ok: false,
      data: { refusal: 'notEnoughAP' },
    });
    expect(merc.actionPoints).toBe(AP_RELOAD_GUN - 1);
  });

  it('compares the attachments as the box does: item and status, in any position', () => {
    const none = { item: 0, status: 0 };
    const scope = { item: item('SNIPERSCOPE'), status: 90 };
    const bipod = { item: item('BIPOD'), status: 60 };
    expect(attachmentsChanged([scope, bipod, none, none], [bipod, none, scope, none])).toBe(false);
    expect(attachmentsChanged([scope, none, none, none], [{ ...scope, status: 89 }, none, none, none])).toBe(true);
    expect(attachmentsChanged([none, none, none, none], [bipod, none, none, none])).toBe(true);
    expect(attachmentsChanged([scope, bipod, none, none], [scope, none, none, none])).toBe(true);
  });
});

describe('throwing a grenade from a pocket', () => {
  it('moves the grenade into the hand and throws it with attack', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    merc.inv[InvSlot.SMALLPOCK1] = createItem(content.items, item('HAND_GRENADE'), 100);
    expect(sim.dispatch({ type: 'moveItem', soldier: 0, from: 'smallPocket1', to: 'hand' })).toMatchObject({ ok: true });
    runUntilIdle(sim);
    const target = gridNo(80, 88);
    expect(estimateAttack(sim, { soldier: 0, target })).toMatchObject({ ok: true, data: { pathClear: true } });
    expect(sim.dispatch({ type: 'attack', soldier: 0, target })).toEqual({ ok: true });
    const events = runUntilIdle(sim);
    expect(events.some((e) => e.type === 'explosion')).toBe(true);
    expect(itemAt(merc, InvSlot.HAND)).toBe('NOTHING');
  });
});

describe('what a detach or an unload into an occupied pocket swaps out (Interface_Items.cc CancelItemPointer)', () => {
  function droppedAtFeet(sim: TacticalSim, merc: Soldier): string[] {
    return sim.state.worldItems
      .filter((wi) => wi.gridNo === merc.gridNo)
      .map((wi) => content.items.byIndex.get(wi.object.item)?.name ?? '');
  }

  it("drops it at the merc's feet with free pockets left, as the cursor of a detached attachment or an unloaded magazine has no slot to go back to", () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    glockWith(merc, 15);
    merc.inv[InvSlot.BIGPOCK1] = createItem(content.items, item('SILENCER'), 90);
    expect(sim.dispatch({ type: 'attach', soldier: 0, item: 'bigPocket1', to: 'hand' })).toMatchObject({ ok: true });
    merc.inv[InvSlot.BIGPOCK1] = createItem(content.items, item('HAND_GRENADE'), 100);
    merc.inv[InvSlot.BIGPOCK2] = createItem(content.items, item('SMOKE_GRENADE'), 100);
    expect(sim.dispatch({ type: 'detach', soldier: 0, slot: 'hand', attachment: 'SILENCER', to: 'bigPocket1' })).toMatchObject({
      ok: true,
    });
    expect(sim.dispatch({ type: 'unload', soldier: 0, slot: 'hand', to: 'bigPocket2' })).toMatchObject({ ok: true });
    expect([itemAt(merc, InvSlot.BIGPOCK1), itemAt(merc, InvSlot.BIGPOCK2), itemAt(merc, InvSlot.BIGPOCK3)]).toEqual([
      'SILENCER',
      'CLIP9_15',
      'NOTHING',
    ]);
    expect(droppedAtFeet(sim, merc)).toEqual(['HAND_GRENADE', 'SMOKE_GRENADE']);
  });
});

describe('reloading and unloading', () => {
  it('unloads for free, reloads by hand for 5 AP in combat and 10 AP with a magazine of another size', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    merc.inv[InvSlot.BIGPOCK1] = createItems(content.items, item('CLIP9_15'), 100, 2);
    merc.inv[InvSlot.BIGPOCK2] = createItem(content.items, item('CLIP9_30'), 100);
    inCombat(sim);
    const ap = merc.actionPoints;
    expect(sim.dispatch({ type: 'unload', soldier: 0 })).toMatchObject({ ok: true, data: { magazine: 'CLIP9_15', rounds: 15 } });
    expect(merc.inv[InvSlot.HAND]?.gunShotsLeft).toBe(0);
    expect(merc.actionPoints).toBe(ap);
    expect(sim.dispatch({ type: 'unload', soldier: 0 })).toMatchObject({ ok: false, data: { refusal: 'gunEmpty' } });
    expect(sim.dispatch({ type: 'reload', soldier: 0 })).toMatchObject({ ok: true, data: { shots: 15 } });
    expect(ap - merc.actionPoints).toBe(AP.RELOAD_GUN);
    merc.inv[InvSlot.HAND] = { ...(merc.inv[InvSlot.HAND] as NonNullable<(typeof merc.inv)[number]>), gunShotsLeft: 0 };
    const before = merc.actionPoints;
    expect(sim.dispatch({ type: 'reload', soldier: 0, ammo: 'bigPocket2' })).toMatchObject({ ok: true, data: { shots: 15 } });
    expect(before - merc.actionPoints).toBe(2 * AP.RELOAD_GUN);
    expect(sim.dispatch({ type: 'reload', soldier: 0, ammo: 'bigPocket1', slot: 'vest' })).toMatchObject({
      ok: false,
      data: { refusal: 'emptySlot' },
    });
  });

  it('leaves the rest of a magazine that tops the gun off in its pocket and names it, where the cursor keeps it', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    glockWith(merc, 10);
    magazines(merc, InvSlot.BIGPOCK1, 'CLIP9_15', [15, 15, 15]);
    expect(sim.dispatch({ type: 'moveItem', soldier: 0, from: 'bigPocket1', to: 'hand', count: 1 })).toMatchObject({
      ok: true,
      data: { leftover: { item: 'CLIP9_15', soldier: 0, slot: InvSlot.BIGPOCK1, count: 1, index: 2 } },
    });
    expect([merc.inv[InvSlot.HAND]?.gunShotsLeft, roundsIn(merc, InvSlot.BIGPOCK1)]).toEqual([15, [15, 15, 10]]);
    glockWith(merc, 12);
    magazines(merc, InvSlot.BIGPOCK2, 'CLIP9_15', [15]);
    expect(sim.dispatch({ type: 'moveItem', soldier: 0, from: 'bigPocket2', to: 'hand' })).toMatchObject({
      data: { leftover: { item: 'CLIP9_15', slot: InvSlot.BIGPOCK2, count: 'all' } },
    });
    expect(roundsIn(merc, InvSlot.BIGPOCK2)).toEqual([12]);
  });

  it('keeps a magazine swapped out for another ammo type off the stack the new one came from', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    glockWith(merc, 10);
    magazines(merc, InvSlot.BIGPOCK1, 'CLIP9_15_AP', [15, 15, 15]);
    const moved = sim.dispatch({ type: 'moveItem', soldier: 0, from: 'bigPocket1', to: 'hand', count: 1 });
    expect(moved).toMatchObject({ ok: true, data: { leftover: { item: 'CLIP9_15', soldier: 0, count: 'all' } } });
    const slot = (moved.data as { leftover: { slot: number } }).leftover.slot;
    expect([itemAt(merc, slot), roundsIn(merc, slot)]).toEqual(['CLIP9_15', [10]]);
    expect([itemAt(merc, InvSlot.BIGPOCK1), roundsIn(merc, InvSlot.BIGPOCK1)]).toEqual(['CLIP9_15_AP', [15, 15]]);
  });

  it('names no leftover when it finds no pocket and falls at his feet', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    glockWith(merc, 10);
    magazines(merc, InvSlot.BIGPOCK1, 'CLIP9_15_AP', [15, 15]);
    for (let slot: number = InvSlot.SECOND_HAND; slot <= InvSlot.SMALLPOCK8; slot++)
      if (slot !== InvSlot.BIGPOCK1) merc.inv[slot] = createItem(content.items, item('CLIP9_15_AP'), 100);
    const moved = sim.dispatch({ type: 'moveItem', soldier: 0, from: 'bigPocket1', to: 'hand', count: 1 });
    expect(moved).toMatchObject({ ok: true });
    expect(moved.data).not.toHaveProperty('leftover');
    expect(merc.inv.some((_, slot) => itemAt(merc, slot) === 'CLIP9_15')).toBe(false);
  });

  it('refuses ammunition of another calibre and a reload without ammo', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    merc.inv[InvSlot.BIGPOCK1] = createItem(content.items, item('CLIP45_7'), 100);
    expect(sim.dispatch({ type: 'reload', soldier: 0, ammo: 'bigPocket1' })).toMatchObject({ ok: false, data: { refusal: 'wrongAmmo' } });
    expect(sim.dispatch({ type: 'reload', soldier: 0 })).toMatchObject({ ok: false, data: { refusal: 'noAmmo' } });
  });
});

const DYING = 10;
const FIRST_SQUAD = 0;
const SECOND_SQUAD = 1;

describe('passing items between mercs', () => {
  it('charges 2 AP to each merc in combat and needs both to have 3', () => {
    const sim = newCombatSim(content);
    const a = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const b = spawnSoldier(sim, 1, Team.OUR, gridNo(81, 81), Direction.NORTH);
    a.inv[InvSlot.BIGPOCK1] = createItems(content.items, item('CLIP9_15'), 100, 2);
    inCombat(sim);
    const apA = a.actionPoints;
    const apB = b.actionPoints;
    expect(sim.dispatch({ type: 'moveItem', soldier: 0, from: 'bigPocket1', toSoldier: 1, to: 'bigPocket1' })).toMatchObject({ ok: true });
    expect(b.inv[InvSlot.BIGPOCK1]?.count).toBe(2);
    expect(apA - a.actionPoints).toBe(2);
    expect(apB - b.actionPoints).toBe(2);
    b.actionPoints = 2;
    expect(sim.dispatch({ type: 'moveItem', soldier: 0, from: 'hand', toSoldier: 1, to: 'bigPocket2' })).toMatchObject({
      ok: false,
      data: { refusal: 'notEnoughAP' },
    });
  });

  it('passes to a merc below OKLIFE only when a near merc of the current squad sees him (IsMercOnCurrentSquad)', () => {
    const sim = newCombatSim(content);
    const a = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const dying = spawnSoldier(sim, 1, Team.OUR, gridNo(81, 81), Direction.NORTH);
    a.inv[InvSlot.BIGPOCK1] = createItems(content.items, item('CLIP9_15'), 100, 2);
    dying.life = DYING;
    const squads = new Map([[a.id, SECOND_SQUAD]]);
    sim.state.narrative = { ...sim.state.narrative, assignment: (m) => squads.get(m.id) ?? FIRST_SQUAD, currentSquad: () => FIRST_SQUAD };
    const pass = () => sim.dispatch({ type: 'moveItem', soldier: 0, from: 'bigPocket1', toSoldier: 1, to: 'bigPocket1' });
    expect(pass()).toMatchObject({ ok: false, data: { refusal: 'tooFar' } });
    squads.set(a.id, FIRST_SQUAD);
    expect(pass()).toMatchObject({ ok: true });
  });

  it('refuses a merc out of passing range', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    spawnSoldier(sim, 1, Team.OUR, gridNo(86, 80), Direction.NORTH);
    expect(sim.dispatch({ type: 'moveItem', soldier: 0, from: 'hand', toSoldier: 1, to: 'bigPocket1' })).toMatchObject({
      ok: false,
      data: { refusal: 'tooFar' },
    });
  });
});

describe('splitting money off a pocket (the money box, RemoveMoney, then the drop)', () => {
  it('splits into an empty pocket, merges into a money pocket and moves the whole pocket', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    merc.inv[InvSlot.SMALLPOCK1] = createMoney(content.items, 1500);
    merc.inv[InvSlot.SMALLPOCK3] = createMoney(content.items, 200);
    expect(sim.dispatch({ type: 'splitMoney', soldier: 0, slot: 'smallPocket1', amount: 400, to: 'smallPocket2' })).toEqual({
      ok: true,
      data: { amount: 400 },
    });
    expect([merc.inv[InvSlot.SMALLPOCK1]?.money, merc.inv[InvSlot.SMALLPOCK2]?.money]).toEqual([1100, 400]);
    expect(sim.drainEvents().find((e) => e.type === 'moneySplit')).toMatchObject({ soldier: 0, slot: 11, to: 12, amount: 400 });
    expect(sim.dispatch({ type: 'splitMoney', soldier: 0, slot: 'smallPocket2', amount: 100, to: 'smallPocket3' })).toMatchObject({
      ok: true,
    });
    expect([merc.inv[InvSlot.SMALLPOCK2]?.money, merc.inv[InvSlot.SMALLPOCK3]?.money]).toEqual([300, 300]);
    expect(sim.dispatch({ type: 'splitMoney', soldier: 0, slot: 'smallPocket2', amount: 300, to: 'smallPocket4' })).toMatchObject({
      ok: true,
    });
    expect(itemAt(merc, InvSlot.SMALLPOCK2)).toBe('NOTHING');
    expect(merc.inv[InvSlot.SMALLPOCK4]?.money).toBe(300);
  });

  it('refuses what the money box and the drop would not allow, changing nothing', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    merc.inv[InvSlot.SMALLPOCK1] = createMoney(content.items, 1000);
    merc.inv[InvSlot.SMALLPOCK2] = createMoney(content.items, 9900);
    const refusal = (cmd: Record<string, unknown>) =>
      (sim.dispatch({ type: 'splitMoney', soldier: 0, ...cmd }).data as { refusal?: string })?.refusal;
    expect(refusal({ slot: 'smallPocket1', amount: 0, to: 'smallPocket5' })).toBe('badAmount');
    expect(refusal({ slot: 'smallPocket1', amount: 1001, to: 'smallPocket5' })).toBe('notEnoughMoney');
    expect(refusal({ slot: 'hand', amount: 10, to: 'smallPocket5' })).toBe('notMoney');
    expect(refusal({ slot: 'smallPocket6', amount: 10, to: 'smallPocket5' })).toBe('emptySlot');
    expect(refusal({ slot: 'smallPocket1', amount: 10, to: 'smallPocket1' })).toBe('sameSlot');
    expect(refusal({ slot: 'smallPocket1', amount: 200, to: 'smallPocket2' })).toBe('doesNotFit');
    expect(refusal({ slot: 'smallPocket1', amount: 10, to: 'hand' })).toBe('doesNotFit');
    expect(refusal({ slot: 'smallPocket1', amount: 10, to: 'vest' })).toBe('doesNotFit');
    expect([merc.inv[InvSlot.SMALLPOCK1]?.money, merc.inv[InvSlot.SMALLPOCK2]?.money]).toEqual([1000, 9900]);
    expect(itemAt(merc, InvSlot.HAND)).toBe('GLOCK_17');
  });

  it('passes money to another merc in passing range for 2 AP each in combat', () => {
    const sim = newCombatSim(content);
    const a = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const b = spawnSoldier(sim, 1, Team.OUR, gridNo(81, 81), Direction.NORTH);
    spawnSoldier(sim, 2, Team.OUR, gridNo(86, 80), Direction.NORTH);
    a.inv[InvSlot.SMALLPOCK1] = createMoney(content.items, 500);
    inCombat(sim);
    const apA = a.actionPoints;
    const apB = b.actionPoints;
    expect(
      sim.dispatch({ type: 'splitMoney', soldier: 0, slot: 'smallPocket1', amount: 50, toSoldier: 1, to: 'smallPocket1' }),
    ).toMatchObject({
      ok: true,
    });
    expect([a.inv[InvSlot.SMALLPOCK1]?.money, b.inv[InvSlot.SMALLPOCK1]?.money]).toEqual([450, 50]);
    expect([apA - a.actionPoints, apB - b.actionPoints]).toEqual([2, 2]);
    expect(
      sim.dispatch({ type: 'splitMoney', soldier: 0, slot: 'smallPocket1', amount: 50, toSoldier: 2, to: 'smallPocket1' }),
    ).toMatchObject({ ok: false, data: { refusal: 'tooFar' } });
  });
});

describe('items applied to a merc and dropped', () => {
  it('drinks from a canteen for 5 AP and gets breath back', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    merc.inv[InvSlot.BIGPOCK1] = createItem(content.items, item('CANTEEN'), 100);
    inCombat(sim);
    merc.breathRed = 5000;
    merc.breath = merc.breathMax - 50;
    const ap = merc.actionPoints;
    const breath = merc.breath;
    expect(sim.dispatch({ type: 'applyItem', soldier: 0, slot: 'bigPocket1' })).toMatchObject({ ok: true, data: { item: 'CANTEEN' } });
    expect(ap - merc.actionPoints).toBe(AP.DRINK);
    expect(merc.breath).toBeGreaterThan(breath);
    expect(merc.inv[InvSlot.BIGPOCK1]?.status[0]).toBe(80);
  });

  it('lets a merc lying collapsed from breath alone drink whatever his APs, not one a sleep dart put down (original-bugs "Drink while collapsed")', () => {
    const OUT_OF_BREATH = 0;
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    merc.inv[InvSlot.BIGPOCK1] = createItem(content.items, item('CANTEEN'), 100);
    merc.inv[InvSlot.BIGPOCK2] = createItem(content.items, item('CAMOUFLAGEKIT'), 100);
    inCombat(sim);
    merc.breath = OUT_OF_BREATH;
    merc.collapsed = true;
    merc.actionPoints = 0;
    expect(sim.dispatch({ type: 'applyItem', soldier: 0, slot: 'bigPocket2' })).toMatchObject({
      ok: false,
      data: { refusal: 'notEnoughAP' },
    });
    expect(sim.dispatch({ type: 'moveItem', soldier: 0, from: 'bigPocket1', to: 'hand' })).toMatchObject({
      ok: false,
      data: { refusal: 'outOfBreath' },
    });
    expect(sim.dispatch({ type: 'applyItem', soldier: 0, slot: 'bigPocket1' })).toMatchObject({ ok: true, data: { item: 'CANTEEN' } });
    expect(merc.breath).toBeGreaterThan(OUT_OF_BREATH);
    merc.breath = OUT_OF_BREATH;
    merc.sleepDrugCounter = 1;
    expect(sim.dispatch({ type: 'applyItem', soldier: 0, slot: 'bigPocket1' })).toMatchObject({
      ok: false,
      data: { refusal: 'notEnoughAP' },
    });
  });

  it('drinks with the drinking sound of the profile’s sex, which the other applied items leave to the panel', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { profile: MERC_PROFILE });
    sim.state.profiles.set(MERC_PROFILE, progressFor(MERC_PROFILE, { sex: FEMALE }));
    merc.inv[InvSlot.BIGPOCK1] = createItem(content.items, item('CANTEEN'), 100);
    merc.inv[InvSlot.BIGPOCK2] = createItem(content.items, item('CAMOUFLAGEKIT'), 100);
    sim.drainEvents();
    for (const slot of ['bigPocket1', 'bigPocket2'])
      expect(sim.dispatch({ type: 'applyItem', soldier: 0, slot })).toMatchObject({ ok: true });
    sim.state.profiles.set(MERC_PROFILE, progressFor(MERC_PROFILE, { sex: MALE }));
    expect(sim.dispatch({ type: 'applyItem', soldier: 0, slot: 'bigPocket1' })).toMatchObject({ ok: true });
    expect(sim.drainEvents().filter((e) => e.type === 'itemApplied')).toEqual([
      expect.objectContaining({ item: 'CANTEEN', sound: 'DRINK_CANTEEN_FEMALE' }),
      expect.not.objectContaining({ sound: expect.anything() }),
      expect.objectContaining({ item: 'CANTEEN', sound: 'DRINK_CANTEEN_MALE' }),
    ]);
  });

  it('tells what is left in the cursor after an apply, and where one object left went back on top of its stack', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    merc.inv[InvSlot.BIGPOCK1] = createItems(content.items, item('CANTEEN'), 100, 3);
    expect(sim.dispatch({ type: 'applyItem', soldier: 0, slot: 'bigPocket1' })).toMatchObject({ data: { left: 1, index: 2 } });
    expect(merc.inv[InvSlot.BIGPOCK1]?.status.slice(0, 3)).toEqual([100, 100, 80]);
    merc.inv[InvSlot.BIGPOCK2] = createItems(content.items, item('ADRENALINE_BOOSTER'), 100, 3);
    expect(sim.dispatch({ type: 'applyItem', soldier: 0, slot: 'bigPocket2', index: 1 })).toEqual({
      ok: true,
      data: { item: 'ADRENALINE_BOOSTER', left: 0 },
    });
    expect(sim.dispatch({ type: 'applyItem', soldier: 0, slot: 'bigPocket2', count: 'all' })).toEqual({
      ok: true,
      data: { item: 'ADRENALINE_BOOSTER', left: 1 },
    });
  });

  it('paints camouflage', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    merc.inv[InvSlot.BIGPOCK1] = createItem(content.items, item('CAMOUFLAGEKIT'), 100);
    expect(sim.dispatch({ type: 'applyItem', soldier: 0, slot: 'bigPocket1' })).toMatchObject({ ok: true });
    expect(merc.camo).toBe(100);
    expect(merc.inv[InvSlot.BIGPOCK1]?.status[0]).toBe(50);
  });

  it('gives another merc a booster from the pocket for no AP in combat, and refuses a syringe as no drug', () => {
    const sim = newCombatSim(content);
    const medic = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const patient = spawnSoldier(sim, 1, Team.OUR, gridNo(81, 81), Direction.NORTH);
    medic.inv[InvSlot.BIGPOCK1] = createItems(content.items, item('ADRENALINE_BOOSTER'), 100, 2);
    medic.inv[InvSlot.BIGPOCK2] = createItem(content.items, item('SYRINGE_3'), 100);
    inCombat(sim);
    patient.actionPoints = 0;
    const ap = medic.actionPoints;
    expect(sim.dispatch({ type: 'applyItem', soldier: 0, slot: 'bigPocket1', target: 1 })).toMatchObject({
      ok: true,
      data: { item: 'ADRENALINE_BOOSTER' },
    });
    expect([medic.actionPoints, patient.actionPoints, medic.inv[InvSlot.BIGPOCK1]?.count]).toEqual([ap, 0, 1]);
    expect(patient.drugs.adrenaline).toMatchObject({ future: 15, sideEffect: 20 });
    expect(sim.drainEvents().filter((e) => e.type === 'itemApplied')).toMatchObject([
      { soldier: 0, target: 1, item: 'ADRENALINE_BOOSTER' },
    ]);
    expect(sim.dispatch({ type: 'applyItem', soldier: 0, slot: 'bigPocket2', target: 1 })).toMatchObject({
      ok: false,
      data: { refusal: 'cannotApply' },
    });
  });

  it('applies the whole stack with count all, as SHIFT takes it into the cursor, and one object of it by index', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    merc.inv[InvSlot.BIGPOCK1] = createItems(content.items, item('CAMOUFLAGEKIT'), 30, 2);
    expect(sim.dispatch({ type: 'applyItem', soldier: 0, slot: 'bigPocket1', count: 'all' })).toMatchObject({ ok: true });
    expect([merc.camo, merc.inv[InvSlot.BIGPOCK1]?.count, merc.inv[InvSlot.BIGPOCK1]?.status[0]]).toEqual([100, 1, 10]);
    merc.inv[InvSlot.BIGPOCK2] = createItems(content.items, item('REGEN_BOOSTER'), 100, 2);
    const boosters = merc.inv[InvSlot.BIGPOCK2];
    if (boosters) boosters.status[1] = 50;
    expect(sim.dispatch({ type: 'applyItem', soldier: 0, slot: 'bigPocket2', index: 1 })).toMatchObject({ ok: true });
    expect([merc.regenerationCounter, merc.inv[InvSlot.BIGPOCK2]?.count, merc.inv[InvSlot.BIGPOCK2]?.status[0]]).toEqual([2, 1, 100]);
    const refusal = (fields: Record<string, unknown>) =>
      (sim.dispatch({ type: 'applyItem', soldier: 0, slot: 'bigPocket2', ...fields }) as { data?: { refusal?: string } }).data?.refusal;
    expect([refusal({ count: 2 }), refusal({ index: 1 })]).toEqual(['badCount', 'badIndex']);
  });

  it('drops one magazine of a stack at the feet', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    merc.inv[InvSlot.BIGPOCK1] = createItems(content.items, item('CLIP9_15'), 100, 3);
    expect(sim.dispatch({ type: 'moveItem', soldier: 0, from: 'bigPocket1', to: 'ground', count: 1 })).toEqual({ ok: true });
    runUntilIdle(sim);
    expect(merc.inv[InvSlot.BIGPOCK1]?.count).toBe(2);
    expect(sim.visibleItems()).toMatchObject([{ gridNo: merc.gridNo, item: 'CLIP9_15', count: 1 }]);
  });
});

describe('keys in and out of the key ring (KeyRingSlotInvClickCallbackPrimary, BeginKeyRingItemPointer)', () => {
  const NO_KEY = 255;
  const keys = (keyId: number, count: number) => {
    const o = createKeyObject(content, count, keyId);
    if (!o) throw new Error(`no key item for lock ${keyId}`);
    return o;
  };

  function keyHolder(): { sim: TacticalSim; merc: Soldier } {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    return { sim, merc };
  }

  it('takes one key off the ring into a pocket, all of the position with count all, and only where they all fit', () => {
    const { sim, merc } = keyHolder();
    const ring = merc.keyRing ?? [];
    ring[0] = { keyId: 1, count: 3 };
    const one = sim.dispatch({ type: 'moveKey', soldier: 0, from: { ring: 0 }, to: 'smallPocket1', count: 1 });
    expect(one).toMatchObject({ ok: true, data: { count: 1 } });
    expect(merc.inv[InvSlot.SMALLPOCK1]).toMatchObject({ count: 1, keyId: 1 });
    expect(ring[0]).toEqual({ keyId: 1, count: 2 });
    expect(sim.dispatch({ type: 'moveKey', soldier: 0, from: { ring: 0 }, to: 'helmet' })).toMatchObject({
      data: { refusal: 'doesNotFit' },
    });
    expect(sim.dispatch({ type: 'moveKey', soldier: 0, from: { ring: 0 }, to: 'hand' })).toMatchObject({ data: { refusal: 'doesNotFit' } });
    expect(sim.dispatch({ type: 'moveKey', soldier: 0, from: { ring: 0 }, to: 'bigPocket1' })).toMatchObject({
      ok: true,
      data: { count: 2 },
    });
    expect(merc.inv[InvSlot.BIGPOCK1]).toMatchObject({ count: 2, keyId: 1 });
    expect(ring[0]).toEqual({ keyId: NO_KEY, count: 0 });
    expect(sim.drainEvents().filter((e) => e.type === 'keyMoved')).toMatchObject([
      { soldier: 0, count: 1, from: { ring: 0 }, to: { slot: InvSlot.SMALLPOCK1 } },
      { soldier: 0, count: 2, from: { ring: 0 }, to: { slot: InvSlot.BIGPOCK1 } },
    ]);
  });

  it('adds a pocket key to an empty position or to the same key up to its ubPerPocket, leaving the rest in the pocket', () => {
    const { sim, merc } = keyHolder();
    const ring = merc.keyRing ?? [];
    merc.inv[InvSlot.BIGPOCK1] = keys(2, 1);
    expect(sim.dispatch({ type: 'moveKey', soldier: 0, from: 'bigPocket1', to: { ring: 5 } })).toMatchObject({ ok: true });
    expect(ring[5]).toEqual({ keyId: 2, count: 1 });
    expect(itemAt(merc, InvSlot.BIGPOCK1)).toBe('NOTHING');
    const perPocket = content.items.byIndex.get(keys(1, 1).item)?.perPocket ?? 0;
    ring[0] = { keyId: 1, count: perPocket - 2 };
    merc.inv[InvSlot.BIGPOCK2] = keys(1, 3);
    expect(sim.dispatch({ type: 'moveKey', soldier: 0, from: 'bigPocket2', to: { ring: 0 } })).toMatchObject({
      ok: true,
      data: { count: 2 },
    });
    expect(ring[0]).toEqual({ keyId: 1, count: perPocket });
    expect(merc.inv[InvSlot.BIGPOCK2]).toMatchObject({ count: 1, keyId: 1 });
    expect(sim.dispatch({ type: 'moveKey', soldier: 0, from: 'bigPocket2', to: { ring: 0 } })).toMatchObject({
      ok: false,
      data: { refusal: 'keyRingFull' },
    });
    expect(sim.dispatch({ type: 'moveKey', soldier: 0, from: 'hand', to: { ring: 1 } })).toMatchObject({ data: { refusal: 'notAKey' } });
  });

  it('keeps the lock of a key taken alone off a stack, onto the ring or into a pocket (deviation: single key off a stack)', () => {
    const { sim, merc } = keyHolder();
    const ring = merc.keyRing ?? [];
    merc.inv[InvSlot.BIGPOCK1] = keys(2, 2);
    merc.inv[InvSlot.BIGPOCK2] = keys(3, 2);
    expect(sim.dispatch({ type: 'moveKey', soldier: 0, from: 'bigPocket1', to: { ring: 0 }, count: 1 })).toMatchObject({ ok: true });
    expect(ring[0]).toEqual({ keyId: 2, count: 1 });
    expect(merc.inv[InvSlot.BIGPOCK1]).toMatchObject({ count: 1, keyId: 2 });
    expect(sim.dispatch({ type: 'moveItem', soldier: 0, from: 'bigPocket2', to: 'smallPocket1', count: 1 })).toMatchObject({ ok: true });
    expect(merc.inv[InvSlot.SMALLPOCK1]).toMatchObject({ count: 1, keyId: 3 });
    expect(merc.inv[InvSlot.BIGPOCK2]).toMatchObject({ count: 1, keyId: 3 });
  });

  it("swaps a pocket key with another lock's keys on the ring, which go back to the pocket", () => {
    const { sim, merc } = keyHolder();
    const ring = merc.keyRing ?? [];
    ring[0] = { keyId: 1, count: 2 };
    merc.inv[InvSlot.BIGPOCK1] = keys(2, 1);
    expect(sim.dispatch({ type: 'moveKey', soldier: 0, from: 'bigPocket1', to: { ring: 0 } })).toMatchObject({ ok: true });
    expect(ring[0]).toEqual({ keyId: 2, count: 1 });
    expect(merc.inv[InvSlot.BIGPOCK1]).toMatchObject({ count: 2, keyId: 1 });
  });

  it('moves keys between ring positions only onto an empty position or the same keys', () => {
    const { sim, merc } = keyHolder();
    const ring = merc.keyRing ?? [];
    ring[0] = { keyId: 1, count: 2 };
    ring[1] = { keyId: 2, count: 1 };
    expect(sim.dispatch({ type: 'moveKey', soldier: 0, from: { ring: 0 }, to: { ring: 3 }, count: 1 })).toMatchObject({ ok: true });
    expect([ring[0], ring[3]]).toEqual([
      { keyId: 1, count: 1 },
      { keyId: 1, count: 1 },
    ]);
    expect(sim.dispatch({ type: 'moveKey', soldier: 0, from: { ring: 0 }, to: { ring: 1 } })).toMatchObject({
      data: { refusal: 'doesNotFit' },
    });
    expect(sim.dispatch({ type: 'moveKey', soldier: 0, from: 'hand', to: 'bigPocket1' })).toMatchObject({
      data: { refusal: 'useMoveItem' },
    });
    expect(sim.dispatch({ type: 'moveKey', soldier: 0, from: { ring: 70 }, to: 'bigPocket1' })).toMatchObject({
      data: { refusal: 'badKeySpot' },
    });
  });

  it("charges 2 AP to each merc in combat for a key going onto another merc's ring, and needs 2 each", () => {
    const sim = newCombatSim(content);
    const a = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const b = spawnSoldier(sim, 1, Team.OUR, gridNo(81, 81), Direction.NORTH);
    a.inv[InvSlot.BIGPOCK1] = keys(1, 1);
    a.inv[InvSlot.BIGPOCK2] = keys(1, 1);
    inCombat(sim);
    const apA = a.actionPoints;
    const apB = b.actionPoints;
    expect(sim.dispatch({ type: 'moveKey', soldier: 0, from: 'bigPocket1', count: 1, toSoldier: 1, to: { ring: 0 } })).toMatchObject({
      ok: true,
    });
    expect(b.keyRing?.[0]).toEqual({ keyId: 1, count: 1 });
    expect([apA - a.actionPoints, apB - b.actionPoints]).toEqual([2, 2]);
    b.actionPoints = 1;
    expect(sim.dispatch({ type: 'moveKey', soldier: 0, from: 'bigPocket2', toSoldier: 1, to: { ring: 0 } })).toMatchObject({
      ok: false,
      data: { refusal: 'notEnoughAP' },
    });
  });
});
