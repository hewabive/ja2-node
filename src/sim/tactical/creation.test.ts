import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../../tests/support/sectors.ts';
import type { BasicPlacement } from '../../content/formats/map.ts';
import { NOTHING } from '../../content/items/items.ts';
import { ScriptedStream } from '../strategic/forces/autoresolve/replay-rng.ts';
import {
  type CreationContext,
  type CreationEnv,
  createDetailedPlacementGivenBasicPlacementInfo,
  type SoldierCreate,
  tacticalCreateSoldier,
} from './creation.ts';
import { createEquipmentState } from './equipment.ts';
import { InvSlot } from './inventory.ts';
import { Attitude, Body, NO_PROFILE, Orders, SkillTrait, SoldierClass, Team } from './soldier.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

function creation(values: readonly number[], progress = 0): { c: CreationContext; rolls: ScriptedStream } {
  const rolls = new ScriptedStream(values);
  const equipment = createEquipmentState(kit.content.items);
  equipment.progress = progress;
  return {
    rolls,
    c: {
      rng: rolls,
      content: kit.content,
      options: { gunNut: false, bloodAndGore: true },
      equipment,
      campaign: { difficultyModifier: 30, progress },
    },
  };
}

const ENV = (difficultyModifier: number, difficulty = 2): CreationEnv => ({
  difficultyModifier: () => difficultyModifier,
  difficulty,
  bloodcatLair: false,
});

function basic(o: Partial<BasicPlacement>): BasicPlacement {
  return {
    detailed: true,
    startingGridNo: 1000,
    team: Team.ENEMY,
    relativeAttributeLevel: 2,
    relativeEquipmentLevel: 2,
    direction: 0,
    orders: Orders.STATIONARY,
    attitude: 0,
    bodyType: Body.REGMALE,
    patrolGrid: [],
    patrolCount: 0,
    onRoof: false,
    soldierClass: SoldierClass.ARMY,
    civilianGroup: 0,
    priorityExistence: false,
    hasKeys: false,
    ...o,
  };
}

function create(o: Partial<SoldierCreate>): SoldierCreate {
  return {
    profile: NO_PROFILE,
    team: Team.ENEMY,
    soldierClass: SoldierClass.ARMY,
    civilianGroup: 0,
    bodyType: Body.REGMALE,
    orders: Orders.STATIONARY,
    attitude: 0,
    direction: 0,
    insertionGridNo: 1000,
    onRoof: false,
    hasKeys: false,
    patrolCount: 0,
    patrolGrid: [],
    expLevel: 3,
    life: 60,
    lifeMax: 60,
    agility: 60,
    dexterity: 60,
    marksmanship: 60,
    medical: 60,
    mechanical: 60,
    explosives: 60,
    leadership: 60,
    strength: 60,
    wisdom: 60,
    morale: 60,
    visible: false,
    palettes: {},
    inv: Array.from({ length: 19 }, () => ({
      item: NOTHING,
      count: 0,
      status: [],
      gunAmmoType: 0,
      gunShotsLeft: 0,
      gunAmmoItem: NOTHING,
      gunAmmoStatus: 0,
      money: 0,
      attachments: [],
      flags: 0,
      trap: 0,
      imprintId: 0,
      keyId: 0,
    })),
    name: '',
    scheduleId: 0,
    ...o,
  };
}

const ZEROS = (n: number) => new Array<number>(n).fill(0);

describe('CreateDetailedPlacementGivenBasicPlacementInfo (docs/06 §7, docs/19 §2.4)', () => {
  it('clamps elites to the policy range 6..10 and leaves them out of ReduceHighExpLevels', () => {
    const { c, rolls } = creation(ZEROS(22));
    const pp = createDetailedPlacementGivenBasicPlacementInfo(
      c,
      basic({ soldierClass: SoldierClass.ELITE, relativeAttributeLevel: 4 }),
      ENV(100),
    );
    expect(pp.expLevel).toBe(10);
    expect(pp.lifeMax).toBe(85);
    expect(rolls.requested).toHaveLength(22);
  });

  it('reduces high experience levels by difficulty with one Chance roll', () => {
    const low = creation([...ZEROS(22), 49]);
    expect(createDetailedPlacementGivenBasicPlacementInfo(low.c, basic({ relativeAttributeLevel: 4 }), ENV(100)).expLevel).toBe(7);
    const high = creation([...ZEROS(22), 50]);
    expect(createDetailedPlacementGivenBasicPlacementInfo(high.c, basic({ relativeAttributeLevel: 4 }), ENV(100)).expLevel).toBe(6);
  });

  it('rolls a creature level from its body with Random(2) for the adults', () => {
    const { c, rolls } = creation([1, ...ZEROS(22)]);
    const pp = createDetailedPlacementGivenBasicPlacementInfo(
      c,
      basic({ team: Team.CREATURE, soldierClass: SoldierClass.CREATURE, bodyType: Body.AM_MONSTER }),
      ENV(40),
    );
    expect([pp.expLevel, pp.soldierClass]).toEqual([6, SoldierClass.CREATURE]);
    expect(rolls.requested[0]).toBe(2);
  });
});

describe('TacticalCreateSoldier (docs/06 §3.2)', () => {
  it('gives elites night ops (and the expert level late in the game), then palettes, battle sound and the female sound', () => {
    const { c, rolls } = creation([10, 5, 0, 50, 2, 1], 60);
    const s = tacticalCreateSoldier(c, create({ soldierClass: SoldierClass.ELITE, bodyType: Body.REGFEMALE }), 30, ENV(40));
    expect([s?.skillTrait1, s?.skillTrait2]).toEqual([SkillTrait.NIGHTOPS, SkillTrait.NIGHTOPS]);
    expect(rolls.requested).toEqual([100, 100, 4, 100, 3, 2]);
    expect(s?.battleSoundId).toBe(8);
    expect([s?.breath, s?.breathMax]).toEqual([99, 100]);
  });

  it('turns female soldiers of the army into men', () => {
    const { c, rolls } = creation([99, 0, 50, 0, 2]);
    const s = tacticalCreateSoldier(c, create({ bodyType: Body.REGFEMALE }), 31, ENV(40));
    expect(s?.bodyType).toBe(Body.STOCKYMALE);
    expect(rolls.requested).toEqual([100, 4, 100, 3, 3]);
  });

  it('weakens civilians by body type after the palettes', () => {
    const { c } = creation([0, 0, 50, 1, 0, 10, 2]);
    const s = tacticalCreateSoldier(c, create({ team: Team.CIV, soldierClass: SoldierClass.NONE, bodyType: Body.MANCIV }), 120, ENV(40));
    expect([s?.life, s?.lifeMax, s?.palettes.pants]).toEqual([45, 45, 'TANPANTS']);
  });

  it('arms creatures with their natural weapons and hides and rolls the body parts they drop', () => {
    const { c } = creation([0, 0, 0, 0, 0, 10, 0, 50, 40, 20]);
    const s = tacticalCreateSoldier(
      c,
      create({ team: Team.CREATURE, soldierClass: SoldierClass.CREATURE, bodyType: Body.AM_MONSTER }),
      52,
      ENV(40),
    );
    if (!s) throw new Error('no creature');
    const name = (slot: number) => kit.content.items.byIndex.get(s.inv[slot]?.item ?? NOTHING)?.name;
    expect([name(InvSlot.HAND), name(InvSlot.SECOND_HAND), name(InvSlot.VEST)]).toEqual([
      'CREATURE_OLD_MALE_CLAWS',
      'CREATURE_OLD_MALE_SPIT',
      'CREATURE_OLD_MALE_HIDE',
    ]);
    expect([name(InvSlot.BIGPOCK1), name(InvSlot.BIGPOCK2), name(InvSlot.BIGPOCK3)]).toEqual([
      'CREATURE_PART_CLAWS',
      'NOTHING',
      'CREATURE_PART_ORGAN',
    ]);
    expect([s.ai.orders, s.ai.attitude, s.monsterSmell, s.monsterOrAnimal]).toEqual([Orders.FARPATROL, Attitude.AGGRESSIVE, 20, true]);
  });
});
