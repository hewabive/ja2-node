import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { AmmoType } from '../../../content/items/items.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { createItem, type ItemObject } from '../../items/object.ts';
import { ScriptedStream } from '../../strategic/forces/autoresolve/replay-rng.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot, itemIn } from '../inventory.ts';
import { MercQuote } from '../narrative/merc-quotes.ts';
import { Personality, type Soldier, Team } from '../soldier.ts';
import type { TacticalSim } from '../tactical-sim.ts';
import { totalArmourProtection } from './armour.ts';
import { attackOpcode, checkForGunJam, FireResult, handItemWorks, handleItem, ItemHandle } from './attack.ts';
import { eventSoldierGotHit, soldierTakeDamage } from './hit.ts';
import { AimShot, DamageReason, Special } from './types.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const MERC_PROFILE = 4;
const OK_FIRE_WEAPON = 470;
const NEVER_BREAKS = 0;
const BREAKS_A_WORN_GUN = 79;
const WORN = 40;
const UNUSABLE = 5;
const JAMS_EASILY = 50;
const USABLE_PLATES = 10;
const HARD_HIT = 100;
const LIFE_OF_A_MERC_NEARLY_OUT = 20;

const item = (name: string) => content.items.byName.get(name)?.index ?? -1;

interface Scene {
  readonly sim: TacticalSim;
  readonly merc: Soldier;
  readonly enemy: Soldier;
  readonly said: [number, number][];
  readonly facesShut: number[];
}

function scene(gun = 'GLOCK_17'): Scene {
  const sim = newCombatSim(content);
  const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { profile: MERC_PROFILE, gun });
  const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 86), Direction.NORTH, { life: 100, gun });
  const said: [number, number][] = [];
  const facesShut: number[] = [];
  const t = sim.state;
  t.narrative = {
    ...t.narrative,
    sayQuote: (s, quote) => said.push([s.id, quote]),
    shutUpSoldierFace: (s) => facesShut.push(s.id),
  };
  sim.drainEvents();
  return { sim, merc, enemy, said, facesShut };
}

const handOf = (s: Soldier) => s.inv[InvSlot.HAND] as ItemObject;

function aimWith(s: Soldier, slot: number): void {
  s.attackingHand = slot;
  s.attackingWeapon = itemIn(s.inv, slot);
}

function scriptRandom(sim: TacticalSim, rolls: readonly number[]): ScriptedStream {
  const rng = new ScriptedStream(rolls, 0);
  Object.assign(sim.state, { rng });
  return rng;
}

describe('the jammed-gun line (Weapons.cc CheckForGunJam)', () => {
  function jamCheck(s: Scene, jamRoll: number): number {
    aimWith(s.merc, InvSlot.HAND);
    (handOf(s.merc).status as number[])[0] = JAMS_EASILY;
    Object.assign(s.sim.state, { pre: new ScriptedStream([0, jamRoll]) });
    return checkForGunJam(s.sim.state, s.merc);
  }

  it('has our merc say it when the gun jams, and says nothing when the shot goes off', () => {
    const jammed = scene();
    expect(jamCheck(jammed, 0)).toBe(FireResult.JAMMED);
    expect(handOf(jammed.merc).gunAmmoStatus).toBeLessThan(0);
    expect(jammed.said).toEqual([[jammed.merc.id, MercQuote.JAMMED_GUN]]);
    const fired = scene();
    expect(jamCheck(fired, 99)).toBe(FireResult.FIREABLE);
    expect(fired.said).toEqual([]);
  });
});

describe('the useless-item line (Handle_Items.cc HandItemWorks)', () => {
  it('is said when the item breaks in his hand, which also drops its status below usable', () => {
    const s = scene();
    (handOf(s.merc).status as number[])[0] = WORN;
    scriptRandom(s.sim, [BREAKS_A_WORN_GUN]);
    expect(handItemWorks(s.sim.state, s.merc, InvSlot.HAND)).toBe(false);
    expect(s.said).toEqual([[s.merc.id, MercQuote.USELESS_ITEM]]);
  });

  it('is said for an item already unusable, without a roll', () => {
    const s = scene();
    (handOf(s.merc).status as number[])[0] = UNUSABLE;
    const rng = scriptRandom(s.sim, []);
    expect(handItemWorks(s.sim.state, s.merc, InvSlot.HAND)).toBe(false);
    expect(rng.requested).toEqual([]);
    expect(s.said).toEqual([[s.merc.id, MercQuote.USELESS_ITEM]]);
  });

  it('is said once for the second gun of a pair that breaks, and not for a working item', () => {
    const s = scene();
    s.merc.inv[InvSlot.SECOND_HAND] = createItem(content.items, item('GLOCK_17'), WORN);
    scriptRandom(s.sim, [NEVER_BREAKS, BREAKS_A_WORN_GUN]);
    expect(handItemWorks(s.sim.state, s.merc, InvSlot.HAND)).toBe(false);
    expect(s.said).toEqual([[s.merc.id, MercQuote.USELESS_ITEM]]);
    const working = scene();
    scriptRandom(working.sim, [NEVER_BREAKS]);
    expect(handItemWorks(working.sim.state, working.merc, InvSlot.HAND)).toBe(true);
    expect(working.said).toEqual([]);
  });

  it('is not said by a soldier of another team', () => {
    const s = scene();
    (handOf(s.enemy).status as number[])[0] = UNUSABLE;
    expect(handItemWorks(s.sim.state, s.enemy, InvSlot.HAND)).toBe(false);
    expect(s.said).toEqual([]);
  });

  it('answers the refused attack of the player, so the click is not met with silence', () => {
    const s = scene();
    (handOf(s.merc).status as number[])[0] = UNUSABLE;
    expect(s.sim.dispatch({ type: 'attack', soldier: s.merc.id, target: s.enemy.gridNo })).toMatchObject({
      ok: false,
      data: { refusal: 'weaponBroken' },
    });
    expect(s.said).toEqual([[s.merc.id, MercQuote.USELESS_ITEM]]);
  });
});

describe("the psycho's switch to burst (Handle_Items.cc HandleItem)", () => {
  function psychoFires(burstRoll: number) {
    const s = scene('MP5K');
    s.merc.personalityTrait = Personality.PSYCHO;
    scriptRandom(s.sim, [NEVER_BREAKS, burstRoll]);
    const gun = itemIn(s.merc.inv, InvSlot.HAND);
    expect(handleItem(s.sim.state, s.merc, s.enemy.gridNo, 0, gun)).toBe(ItemHandle.OK);
    return { merc: s.merc, told: s.sim.drainEvents().filter((e) => e.type === 'psychoBurst') };
  }

  it('is told when the roll takes him to burst, naming him', () => {
    const { merc, told } = psychoFires(0);
    expect(merc.doBurst).toBe(1);
    expect(told).toEqual([expect.objectContaining({ type: 'psychoBurst', soldier: merc.id })]);
  });

  it('is not told when he keeps to the single shot', () => {
    const { merc, told } = psychoFires(1);
    expect(merc.doBurst).toBe(0);
    expect(told).toEqual([]);
  });
});

describe('the second gun out of rounds (Weapons.cc OKFireWeapon)', () => {
  function secondGunFires(s: Scene, shooter: Soldier) {
    const empty = createItem(content.items, item('GLOCK_17'), 100);
    empty.gunShotsLeft = 0;
    shooter.inv[InvSlot.SECOND_HAND] = empty;
    aimWith(shooter, InvSlot.SECOND_HAND);
    attackOpcode(s.sim.state, shooter, OK_FIRE_WEAPON);
    return s.sim.drainEvents().filter((e) => e.type === 'secondClipDepleted');
  }

  it('is reported for our merc and for nobody else', () => {
    const s = scene();
    expect(secondGunFires(s, s.merc)).toHaveLength(1);
    expect(secondGunFires(s, s.enemy)).toEqual([]);
  });
});

describe('ceramic plates smashed by a hit (Weapons.cc TotalArmourProtection)', () => {
  function shotInThePlates(s: Scene, wearer: Soldier) {
    const vest = createItem(content.items, item('KEVLAR_VEST'), 100);
    vest.attachments[0] = { item: item('CERAMIC_PLATES'), status: USABLE_PLATES };
    wearer.inv[InvSlot.VEST] = vest;
    Object.assign(s.sim.state, { pre: new ScriptedStream([], 0) });
    totalArmourProtection(s.sim.state, wearer, AimShot.TORSO, HARD_HIT, AmmoType.REGULAR);
    return { plates: vest.attachments[0], told: s.sim.drainEvents().filter((e) => e.type === 'ceramicPlatesSmashed') };
  }

  it('are reported for our merc', () => {
    const s = scene();
    const { plates, told } = shotInThePlates(s, s.merc);
    expect(plates.item).toBe(0);
    expect(told).toEqual([expect.objectContaining({ soldier: s.merc.id })]);
  });

  it('go silently on anybody else', () => {
    const s = scene();
    const { plates, told } = shotInThePlates(s, s.enemy);
    expect(plates.item).toBe(0);
    expect(told).toEqual([]);
  });
});

describe('the line of a merc blinded by spit (Soldier_Control.cc SoldierGotHitGunFire)', () => {
  const spat = (s: Scene, target: Soldier) =>
    eventSoldierGotHit(
      s.sim.state,
      target,
      itemIn(s.enemy.inv, InvSlot.HAND),
      1,
      0,
      Direction.NORTH,
      1,
      s.enemy,
      Special.BLINDED_BY_SPIT,
      AimShot.TORSO,
    );

  it('is said when the spit first blinds him, not again while he is blind', () => {
    const s = scene();
    spat(s, s.merc);
    expect(s.merc.blindedCounter).toBeGreaterThan(0);
    spat(s, s.merc);
    expect(s.said.filter(([, quote]) => quote === MercQuote.BLINDED)).toEqual([[s.merc.id, MercQuote.BLINDED]]);
  });

  it('is not said by a soldier who is not ours', () => {
    const s = scene();
    spat(s, s.enemy);
    expect(s.enemy.blindedCounter).toBeGreaterThan(0);
    expect(s.said.filter(([, quote]) => quote === MercQuote.BLINDED)).toEqual([]);
  });
});

describe('a merc knocked below consciousness stops talking (Soldier_Control.cc SoldierTakeDamage: ShutupaYoFace)', () => {
  it('shuts his face when the damage leaves him below consciousness, and not for a lesser wound', () => {
    const s = scene();
    soldierTakeDamage(s.sim.state, s.merc, 1, 0, DamageReason.GUNFIRE, s.enemy);
    expect(s.facesShut).toEqual([]);
    s.merc.life = LIFE_OF_A_MERC_NEARLY_OUT;
    soldierTakeDamage(s.sim.state, s.merc, LIFE_OF_A_MERC_NEARLY_OUT - 1, 0, DamageReason.GUNFIRE, s.enemy);
    expect(s.facesShut).toEqual([s.merc.id]);
  });
});
