import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { objectOf } from '../../../../tests/support/explosives.ts';
import { testProfile } from '../../../../tests/support/profiles.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { NOTHING } from '../../../content/items/items.ts';
import { DIRECTION_INCREMENT, Direction, gridNo } from '../../../content/world/grid.ts';
import { createItem } from '../../items/object.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { MercQuote } from '../narrative/merc-quotes.ts';
import { NO_NARRATIVE_PORT } from '../narrative/port.ts';
import { Opp } from '../perception/opp.ts';
import { Body, CivilianGroup, NO_PROFILE, type Soldier, TEAM_FIRST_ID, Team } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { handleItem, ItemHandle } from './attack.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const GOODGUY = 0x80;
const MERC = 3;
const OTHER_MERC = 4;
const NPC = 70;
const MERC_AT = gridNo(80, 80);
const TARGET_AT = gridNo(80, 84);
const EAST = DIRECTION_INCREMENT[Direction.EAST] ?? 0;
const HAND_ITEM_ROLL = 80;
const CIV_ID = TEAM_FIRST_ID[Team.CIV];
const ENEMY_ID = TEAM_FIRST_ID[Team.ENEMY];
const WALL_ROW = 84;

interface Scene {
  readonly sim: TacticalSim;
  readonly merc: Soldier;
  readonly quotes: number[];
  readonly draws: number[];
}

function scene(flags3 = 0, walls: readonly number[] = []): Scene {
  const sim = newCombatSim(content, walls);
  const t = sim.state;
  const quotes: number[] = [];
  t.narrative = { ...NO_NARRATIVE_PORT, sayQuote: (_s, quote) => void quotes.push(quote) };
  t.profiles.set(MERC, testProfile(MERC, { miscFlags3: flags3 }));
  const merc = spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.SOUTH, { profile: MERC });
  const draws: number[] = [];
  const rng = t.rng as unknown as { int(n: number): number };
  const int = rng.int.bind(rng);
  rng.int = (n: number) => {
    draws.push(n);
    return int(n);
  };
  return { sim, merc, quotes, draws };
}

function unarmed(s: Soldier): Soldier {
  s.inv[InvSlot.HAND] = createItem(content.items, NOTHING, 0);
  return s;
}

function civilian(sim: TacticalSim, options: { profile?: number; group?: number; neutral?: boolean } = {}): Soldier {
  const civ = unarmed(spawnSoldier(sim, CIV_ID, Team.CIV, TARGET_AT, Direction.NORTH, { profile: options.profile ?? NO_PROFILE }));
  civ.neutral = options.neutral ?? true;
  civ.civilianGroup = options.group ?? CivilianGroup.NONE;
  return civ;
}

function attack(sim: TacticalSim, target = TARGET_AT) {
  return sim.dispatch({ type: 'attack', soldier: 0, target });
}

describe('the refusals of a click on a good guy, a buddy or a rebel (HandleItem fFromUI)', () => {
  it("refuses a good guy's shot at a nameless neutral civilian with his refusing line, after the hand item roll", () => {
    const { sim, merc, quotes, draws } = scene(GOODGUY);
    civilian(sim);
    const before = merc.actionPoints;
    expect(attack(sim)).toMatchObject({ ok: false, data: { refusal: 'refusesOrder' } });
    expect([draws, quotes, merc.actionPoints]).toEqual([[HAND_ITEM_ROLL], [MercQuote.REFUSING_ORDER], before]);
  });

  it('lets a merc without the good guy flag shoot the same civilian', () => {
    const { sim, quotes } = scene();
    civilian(sim);
    expect(attack(sim)).toEqual({ ok: true });
    expect(quotes).toEqual([]);
  });

  it("refuses a good guy's shot at a good guy with a name, neutral or of ours, but not at a named NPC without the flag", () => {
    const named = scene(GOODGUY);
    named.sim.state.profiles.set(NPC, testProfile(NPC, { miscFlags3: GOODGUY }));
    civilian(named.sim, { profile: NPC });
    expect(attack(named.sim)).toMatchObject({ ok: false, data: { refusal: 'refusesOrder' } });
    const ours = scene(GOODGUY);
    ours.sim.state.profiles.set(OTHER_MERC, testProfile(OTHER_MERC, { miscFlags3: GOODGUY }));
    spawnSoldier(ours.sim, 1, Team.OUR, TARGET_AT, Direction.NORTH, { profile: OTHER_MERC });
    expect(attack(ours.sim)).toMatchObject({ ok: false, data: { refusal: 'refusesOrder' } });
    const plain = scene(GOODGUY);
    plain.sim.state.profiles.set(NPC, testProfile(NPC));
    civilian(plain.sim, { profile: NPC });
    expect(attack(plain.sim)).toEqual({ ok: true });
  });

  it('refuses to shoot a buddy of ours, by any slot, the learned-to-like one included (WhichBuddy)', () => {
    const { sim, quotes } = scene();
    sim.state.profiles.set(MERC, testProfile(MERC, { buddies: [-1, -1, OTHER_MERC] }));
    spawnSoldier(sim, 1, Team.OUR, TARGET_AT, Direction.NORTH, { profile: OTHER_MERC });
    expect(attack(sim)).toMatchObject({ ok: false, data: { refusal: 'refusesOrder' } });
    expect(quotes).toEqual([MercQuote.REFUSING_ORDER]);
  });

  it("refuses a recruited rebel's shot at a neutral rebel or nameless civilian, never at a hostile rebel", () => {
    const atRebel = scene();
    atRebel.merc.civilianGroup = CivilianGroup.REBEL;
    civilian(atRebel.sim, { group: CivilianGroup.REBEL });
    expect(attack(atRebel.sim)).toMatchObject({ ok: false, data: { refusal: 'refusesOrder' } });
    const atCivilian = scene();
    atCivilian.merc.civilianGroup = CivilianGroup.REBEL;
    civilian(atCivilian.sim);
    expect(attack(atCivilian.sim)).toMatchObject({ ok: false, data: { refusal: 'refusesOrder' } });
    const atHostile = scene();
    atHostile.merc.civilianGroup = CivilianGroup.REBEL;
    civilian(atHostile.sim, { group: CivilianGroup.REBEL, neutral: false });
    expect(attack(atHostile.sim)).toEqual({ ok: true });
  });

  it('never refuses a crow, a medkit, a merc of no profile or the AI', () => {
    const crow = scene(GOODGUY);
    unarmed(spawnSoldier(crow.sim, CIV_ID, Team.CIV, TARGET_AT, Direction.NORTH, { body: Body.CROW })).neutral = true;
    expect(attack(crow.sim)).toEqual({ ok: true });
    const kit = scene(GOODGUY);
    const civ = civilian(kit.sim);
    kit.merc.inv[InvSlot.HAND] = objectOf(kit.sim.state, 'FIRSTAIDKIT');
    expect(handleItem(kit.sim.state, kit.merc, civ.gridNo, 0, kit.merc.inv[InvSlot.HAND]?.item ?? NOTHING, true)).not.toBe(
      ItemHandle.REFUSAL,
    );
    const nameless = scene(GOODGUY);
    nameless.merc.profile = NO_PROFILE;
    civilian(nameless.sim);
    expect(attack(nameless.sim)).toEqual({ ok: true });
    const ai = scene(GOODGUY);
    const target = civilian(ai.sim);
    const gun = ai.merc.inv[InvSlot.HAND]?.item ?? NOTHING;
    expect(handleItem(ai.sim.state, ai.merc, target.gridNo, 0, gun)).toBe(ItemHandle.OK);
  });

  it('makes a good guy refuse to plant a bomb at his own feet: the soldier on the tile of his click is himself', () => {
    const goodGuy = scene(GOODGUY);
    goodGuy.merc.inv[InvSlot.HAND] = objectOf(goodGuy.sim.state, 'MINE');
    expect(goodGuy.sim.dispatch({ type: 'plantBomb', soldier: 0, gridNo: MERC_AT })).toMatchObject({
      ok: false,
      data: { refusal: 'refusesOrder' },
    });
    expect(goodGuy.quotes).toEqual([MercQuote.REFUSING_ORDER]);
    expect(goodGuy.sim.dispatch({ type: 'plantBomb', soldier: 0, gridNo: MERC_AT + EAST })).toEqual({ ok: true });
    const other = scene();
    other.merc.inv[InvSlot.HAND] = objectOf(other.sim.state, 'MINE');
    expect(other.sim.dispatch({ type: 'plantBomb', soldier: 0, gridNo: MERC_AT })).toEqual({ ok: true });
  });
});

describe('the poor shot of a click in combat (HandleCheckForBadChangeToGetThrough)', () => {
  function behindWall(): Scene & { readonly enemy: Soldier } {
    const walls = Array.from({ length: 9 }, (_, k) => gridNo(76 + k, WALL_ROW));
    const s = scene(0, walls);
    const enemy = spawnSoldier(s.sim, ENEMY_ID, Team.ENEMY, gridNo(80, 88), Direction.NORTH);
    s.sim.state.inCombat = true;
    s.merc.oppList[enemy.id] = Opp.SEEN_CURRENTLY;
    return { ...s, enemy };
  }

  it('holds the first shot with his no-line-of-fire line and no APs; the same attack again fires and keeps the case', () => {
    const { sim, merc, enemy, quotes } = behindWall();
    const before = merc.actionPoints;
    expect(attack(sim, enemy.gridNo)).toMatchObject({ ok: false, data: { refusal: 'noLineOfFire' } });
    expect([quotes, merc.actionPoints]).toEqual([[MercQuote.NO_LINE_OF_FIRE], before]);
    expect(sim.state.gameEvents).toEqual([]);
    expect(attack(sim, enemy.gridNo)).toEqual({ ok: true });
    expect(sim.state.gameEvents).toMatchObject([{ kind: 'beginFireWeapon', soldier: merc.id }]);
    expect(sim.state.turn.cantGetThrough).toMatchObject({ soldier: merc, gridNo: enemy.gridNo, soldierGridNo: merc.gridNo });
    expect(quotes).toEqual([MercQuote.NO_LINE_OF_FIRE]);
  });

  it('asks again for another target, and forgets the case after a shot with a fair chance', () => {
    const { sim, merc, enemy, quotes } = behindWall();
    const inTheOpen = spawnSoldier(sim, ENEMY_ID + 1, Team.ENEMY, MERC_AT + 3 * EAST, Direction.WEST);
    merc.oppList[inTheOpen.id] = Opp.SEEN_CURRENTLY;
    expect(attack(sim, enemy.gridNo)).toMatchObject({ ok: false, data: { refusal: 'noLineOfFire' } });
    expect(attack(sim, enemy.gridNo + EAST)).toMatchObject({ ok: false, data: { refusal: 'noLineOfFire' } });
    expect(quotes).toEqual([MercQuote.NO_LINE_OF_FIRE, MercQuote.NO_LINE_OF_FIRE]);
    sim.state.turn.cantGetThrough = { soldier: merc, gridNo: enemy.gridNo, soldierGridNo: merc.gridNo };
    expect(handleItem(sim.state, merc, inTheOpen.gridNo, 0, merc.inv[InvSlot.HAND]?.item ?? NOTHING, true)).toBe(ItemHandle.OK);
    expect(sim.state.turn.cantGetThrough).toBeNull();
  });

  it("never holds a shot in real time, or the AI's", () => {
    const realTime = behindWall();
    realTime.sim.state.inCombat = false;
    expect(attack(realTime.sim, realTime.enemy.gridNo)).toEqual({ ok: true });
    const ai = behindWall();
    expect(handleItem(ai.sim.state, ai.merc, ai.enemy.gridNo, 0, ai.merc.inv[InvSlot.HAND]?.item ?? NOTHING)).toBe(ItemHandle.OK);
    expect([ai.quotes, ai.sim.state.turn.cantGetThrough]).toEqual([[], null]);
  });
});
