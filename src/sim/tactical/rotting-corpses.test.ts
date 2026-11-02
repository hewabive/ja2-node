import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import { addCorpseStructure } from './combat/death.ts';
import type { TacticalContent } from './content.ts';
import { Profile } from './narrative/constants.ts';
import {
  addRottingCorpse,
  corpseInSlot,
  decapitateCorpse,
  ROTTING_STAGE2,
  removeRottingCorpse,
  rottingCorpseSlots,
} from './rotting-corpses.ts';
import { NO_PROFILE } from './soldier.ts';
import type { TacticalState } from './state.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const CORPSE_AT = gridNo(80, 81);
const MS_PER_MINUTE = 60_000;
const A_DAY_AND_A_BIT_MINUTES = 1500;
const FOUR_DAYS_MINUTES = 4 * 1440;

const corpseType = (name: string) => content.corpses.table.types.indexOf(name);
const itemIndex = (name: string) => content.items.byName.get(name)?.index ?? -1;

function withCorpse(type: string, profile = NO_PROFILE, ageMinutes = 0): TacticalState {
  const t = newCombatSim(content).state;
  t.explosives.worldMs = ageMinutes * MS_PER_MINUTE;
  const corpse = { gridNo: CORPSE_AT, level: 0, heightAdjustment: 0, bodyType: 0, direction: Direction.NORTH, state: 0, profile };
  t.corpses.push({ ...corpse, type: corpseType(type), timeOfDeath: 0, headTaken: false, servicingCrows: 0 });
  addCorpseStructure(t, CORPSE_AT, 0, corpseType(type), Direction.NORTH);
  return t;
}

const heads = (t: TacticalState) => t.worldItems.filter((wi) => wi.gridNo === CORPSE_AT).map((wi) => wi.object.item);

describe('DecapitateCorpse', () => {
  it.each([
    [Profile.CHRIS, 'HEAD_2'],
    [Profile.T_REX, 'HEAD_3'],
    [Profile.SLAY, 'HEAD_4'],
    [Profile.DRUGGIST, 'HEAD_5'],
    [Profile.ANNIE, 'HEAD_6'],
    [Profile.TIFFANY, 'HEAD_7'],
    [NO_PROFILE, 'HEAD_1'],
  ])("takes profile %i's head %s once from a civilian corpse, which has no headless picture and stays", (profile, head) => {
    const t = withCorpse('M_DEAD1', profile);
    decapitateCorpse(t, CORPSE_AT);
    decapitateCorpse(t, CORPSE_AT);
    expect(heads(t)).toEqual([itemIndex(head)]);
    expect(t.corpses).toMatchObject([{ type: corpseType('M_DEAD1'), headTaken: true }]);
  });

  it('leaves the corpses of creatures, vehicles and a headless merc whole', () => {
    for (const type of ['BLOODCAT_DEAD', 'TANK1_DEAD', 'SMERC_JFK']) {
      const t = withCorpse(type);
      decapitateCorpse(t, CORPSE_AT);
      expect(heads(t)).toEqual([]);
      expect(t.corpses).toMatchObject([{ type: corpseType(type), headTaken: false }]);
    }
  });

  it('forgets the taken head of a merc corpse cut a day after death: it rots on the spot and gives a second head', () => {
    const t = withCorpse('MMERC_FWD', NO_PROFILE, A_DAY_AND_A_BIT_MINUTES);
    decapitateCorpse(t, CORPSE_AT);
    expect(t.corpses).toMatchObject([{ type: ROTTING_STAGE2, headTaken: false }]);
    decapitateCorpse(t, CORPSE_AT);
    expect(heads(t)).toEqual([itemIndex('HEAD_1'), itemIndex('HEAD_1')]);
    expect(t.corpses).toMatchObject([{ type: ROTTING_STAGE2, headTaken: true }]);
  });

  it('drops the head of a merc corpse cut long after death and lets the body go', () => {
    const t = withCorpse('FMERC_PRN', NO_PROFILE, FOUR_DAYS_MINUTES);
    decapitateCorpse(t, CORPSE_AT);
    expect(t.corpses).toEqual([]);
    expect(t.world.structures.find(CORPSE_AT, StructureFlags.CORPSE)).toBeNull();
    expect(heads(t)).toEqual([itemIndex('HEAD_1')]);
  });
});

describe('the rotting corpse slots (Rotting_Corpses.cc GetFreeRottingCorpse, RemoveCorpse)', () => {
  const at = (k: number) => CORPSE_AT + 4 * k;
  const lying = (k: number) => ({
    gridNo: at(k),
    level: 0,
    heightAdjustment: 0,
    bodyType: 0,
    direction: Direction.NORTH,
    state: 0,
    profile: NO_PROFILE,
    type: corpseType('M_DEAD1'),
    timeOfDeath: 0,
    headTaken: false,
    servicingCrows: 0,
  });
  const base = (t: TacticalState, g: number) => {
    const found = t.world.structures.find(g, StructureFlags.CORPSE);
    if (!found) throw new Error('no corpse structure');
    return t.world.structures.findBase(found) ?? found;
  };
  const slotsOf = (t: TacticalState) => Array.from({ length: rottingCorpseSlots(t) }, (_, slot) => corpseInSlot(t, slot)?.gridNo ?? null);

  it('keeps a removed corpse slot empty but counted until a new corpse takes the first empty slot', () => {
    const t = newCombatSim(content).state;
    for (const k of [0, 1, 2]) addRottingCorpse(t, lying(k), { nowMinute: 0, loadingSave: false });
    const middle = t.corpses[1];
    if (!middle) throw new Error('no corpse');
    removeRottingCorpse(t, middle, base(t, at(1)));
    expect(slotsOf(t)).toEqual([at(0), null, at(2)]);
    addRottingCorpse(t, lying(3), { nowMinute: 0, loadingSave: false });
    expect(slotsOf(t)).toEqual([at(0), at(3), at(2)]);
    expect(t.corpses.map((c) => c.gridNo)).toEqual([at(0), at(3), at(2)]);
  });

  it('takes a slot for a corpse too old to lie and leaves it empty', () => {
    const t = newCombatSim(content).state;
    addRottingCorpse(t, lying(0), { nowMinute: 0, loadingSave: false });
    addRottingCorpse(t, lying(1), { nowMinute: FOUR_DAYS_MINUTES, loadingSave: false });
    expect(slotsOf(t)).toEqual([at(0), null]);
    expect(t.world.structures.find(at(1), StructureFlags.CORPSE)).toBeNull();
  });

  it('lays a headless corpse in the first empty slot, which may come before the cut one', () => {
    const t = withCorpse('MMERC_FWD');
    addRottingCorpse(t, lying(1), { nowMinute: 0, loadingSave: false });
    addRottingCorpse(t, lying(2), { nowMinute: 0, loadingSave: false });
    const first = t.corpses[0];
    if (!first) throw new Error('no corpse');
    removeRottingCorpse(t, first, base(t, CORPSE_AT));
    const cut = t.corpses.find((c) => c.gridNo === at(2));
    if (!cut) throw new Error('no corpse');
    t.corpses[t.corpses.indexOf(cut)] = { ...cut, type: corpseType('MMERC_FWD') };
    decapitateCorpse(t, at(2));
    expect(slotsOf(t)).toEqual([at(2), at(1), null]);
  });
});
