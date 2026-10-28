import { describe, expect, it } from 'vitest';
import { profileMap, testProfile } from '../../../../tests/support/profiles.ts';
import { ScriptedRolls } from '../../../../tests/support/strategic.ts';
import type { SectorPosition } from '../../strategic/state.ts';
import type { SoldierCreate } from '../creation.ts';
import { emptyInventory } from '../inventory.ts';
import type { ProfileProgress } from '../profiles.ts';
import { Body, CivilianGroup, createSoldier, NO_PROFILE, NOWHERE, Orders, Team } from '../soldier.ts';
import {
  civilianPlacementOverride,
  iceCreamTruckWithheld,
  type PlacementNarrative,
  PlacementVerdict,
  profilePlacementAllowed,
} from './placement.ts';
import {
  type ProfileInsertionHooks,
  setupProfileInsertionDataForSoldier,
  updateSoldierPointerDataIntoProfile,
} from './profile-insertion.ts';

const C5: SectorPosition = { x: 5, y: 3, z: 0 };

function narrative(o: {
  world?: SectorPosition;
  profiles?: ProfileProgress[];
  onTeam?: number[];
  hostility?: Record<number, number>;
  facts?: Record<number, number>;
  quests?: Record<number, number>;
  rolls?: number[];
  pre?: number[];
  enemyControlled?: boolean;
  alternateQueen?: boolean;
}) {
  const profiles = profileMap(o.profiles ?? []);
  const rolls = new ScriptedRolls(o.rolls ?? []);
  const pre = new ScriptedRolls(o.pre ?? []);
  const n: PlacementNarrative = {
    world: o.world ?? C5,
    profile: (id) => profiles.get(id) ?? null,
    profileOnPlayerTeam: (id) => (o.onTeam ?? []).includes(id),
    civGroupHostility: (g) => o.hostility?.[g] ?? 0,
    questStatus: (q) => o.quests?.[q] ?? 0,
    checkFact: (id) => (o.facts?.[id] ?? 0) !== 0,
    rawFact: (id) => o.facts?.[id] ?? 0,
    inMeanwhile: () => false,
    useAlternateQueenPosition: () => o.alternateQueen ?? false,
    sectorEnemyControlled: () => o.enemyControlled ?? true,
    random: (k) => rolls.int(k),
    preRandom: (k) => pre.int(k),
  };
  return { n, rolls, pre, profiles };
}

function create(o: Partial<SoldierCreate> = {}): SoldierCreate {
  return {
    profile: NO_PROFILE,
    team: Team.CIV,
    soldierClass: 0,
    civilianGroup: CivilianGroup.NONE,
    bodyType: Body.MANCIV,
    orders: Orders.STATIONARY,
    attitude: 0,
    direction: 0,
    insertionGridNo: 1000,
    onRoof: false,
    hasKeys: false,
    patrolCount: 0,
    patrolGrid: [],
    expLevel: 0,
    life: 0,
    lifeMax: 0,
    agility: 0,
    dexterity: 0,
    marksmanship: 0,
    medical: 0,
    mechanical: 0,
    explosives: 0,
    leadership: 0,
    strength: 0,
    wisdom: 0,
    morale: 0,
    visible: false,
    palettes: {},
    inv: emptyInventory(),
    name: '',
    scheduleId: 0,
    ...o,
  };
}

describe('AddPlacementToWorld profile filter', () => {
  it('needs the profile in the loaded sector including z, alive, free and without insertion data', () => {
    const base = { sectorX: 5, sectorY: 3, sectorZ: 0 };
    const allowed = (p: ProfileProgress, world = C5) => profilePlacementAllowed(narrative({ world, profiles: [p] }).n, p.id);
    expect(allowed(testProfile(91, base))).toBe(true);
    expect(allowed(testProfile(91, base), { ...C5, z: 1 })).toBe(false);
    expect(allowed(testProfile(91, { ...base, miscFlags: 0x01 }))).toBe(false);
    expect(allowed(testProfile(91, { ...base, miscFlags: 0x40 }))).toBe(false);
    expect(allowed(testProfile(91, { ...base, life: 0 }))).toBe(false);
    expect(allowed(testProfile(91, { ...base, useProfileInsertion: true }))).toBe(false);
  });

  it('tests the ice-cream truck by profile 26 (the body type) and then Hamous', () => {
    const hamous = testProfile(63, { sectorX: 5, sectorY: 3 });
    expect(iceCreamTruckWithheld(narrative({ profiles: [hamous] }).n)).toBe(false);
    expect(iceCreamTruckWithheld(narrative({ profiles: [hamous], onTeam: [26] }).n)).toBe(false);
    expect(iceCreamTruckWithheld(narrative({ profiles: [testProfile(63)], onTeam: [26] }).n)).toBe(true);
    expect(iceCreamTruckWithheld(narrative({ profiles: [{ ...hamous, miscFlags: 0x01 }], onTeam: [26] }).n)).toBe(true);
  });
});

describe('civilian quest overrides', () => {
  it('posts Kingpin’s men around Hans’ door with two range draws and PreRandom orders', () => {
    const h = narrative({ hostility: { [CivilianGroup.KINGPIN]: 2 }, rolls: [0, 14], pre: [2] });
    const pp = create({ civilianGroup: CivilianGroup.KINGPIN });
    expect(civilianPlacementOverride(h.n, pp)).toBe(PlacementVerdict.CREATE);
    expect(h.rolls.ranges).toEqual([15, 15]);
    expect(pp.insertionGridNo).toBe(13531 - 7 + 7 * 160);
    expect(pp.orders).toBe(Orders.ONCALL);
    const billy = narrative({ hostility: { [CivilianGroup.KINGPIN]: 2 }, rolls: [29, 29] });
    const billyPp = create({ civilianGroup: CivilianGroup.KINGPIN, profile: 133 });
    civilianPlacementOverride(billy.n, billyPp);
    expect(billy.rolls.ranges).toEqual([59, 59]);
    expect(billyPp).toMatchObject({ insertionGridNo: 13531, orders: Orders.SEEKENEMY });
    const madame = narrative({ quests: { 4: 1 }, facts: { 276: 1 } });
    expect(civilianPlacementOverride(madame.n, create({ civilianGroup: CivilianGroup.KINGPIN, profile: 107 }))).toBe(PlacementVerdict.SKIP);
    const calm = narrative({});
    expect(civilianPlacementOverride(calm.n, create({ civilianGroup: CivilianGroup.KINGPIN, profile: 107 }))).toBe(PlacementVerdict.CREATE);
  });

  it('keeps only the Queen’s group in the palace while she lives, and drops it once she is dead', () => {
    const p3 = { x: 3, y: 16, z: 0 };
    const alive = narrative({ world: p3, alternateQueen: true });
    const queen = create({ civilianGroup: CivilianGroup.QUEENS, profile: 75 });
    expect(civilianPlacementOverride(alive.n, queen)).toBe(PlacementVerdict.CREATE);
    expect(queen.insertionGridNo).toBe(11448);
    expect(civilianPlacementOverride(alive.n, create())).toBe(PlacementVerdict.SKIP);
    const dead = narrative({ world: p3, facts: { 170: 1 } });
    expect(civilianPlacementOverride(dead.n, create({ civilianGroup: CivilianGroup.QUEENS }))).toBe(PlacementVerdict.SKIP);
    expect(civilianPlacementOverride(dead.n, create())).toBe(PlacementVerdict.CREATE);
  });

  it('empties liberated Tixa of unprofiled adults and frees the kids of C13', () => {
    const tixa = narrative({ world: { x: 9, y: 10, z: 0 }, enemyControlled: false });
    expect(civilianPlacementOverride(tixa.n, create())).toBe(PlacementVerdict.SKIP);
    expect(civilianPlacementOverride(tixa.n, create({ bodyType: Body.KIDCIV }))).toBe(PlacementVerdict.CREATE);
    expect(civilianPlacementOverride(tixa.n, create({ profile: 59 }))).toBe(PlacementVerdict.CREATE);
    const kids = narrative({ world: { x: 13, y: 3, z: 0 }, facts: { 318: 1 } });
    expect(civilianPlacementOverride(kids.n, create({ bodyType: Body.HATKIDCIV }))).toBe(PlacementVerdict.SKIP);
  });
});

const STATS = {
  agility: 50,
  dexterity: 50,
  strength: 50,
  wisdom: 50,
  leadership: 50,
  marksmanship: 50,
  mechanical: 50,
  explosives: 50,
  medical: 50,
  experience: 3,
};

function soldierFor(id: number, team: number, profile: number, life: number, lifeMax = 60) {
  return createSoldier({
    id,
    team,
    name: '',
    profile,
    bodyType: Body.MANCIV,
    palettes: { hair: '', skin: '', vest: '', pants: '' },
    stats: { ...STATS },
    life,
    lifeMax,
    gridNo: 500,
    direction: 0,
    state: 0,
  });
}

function hooks(profiles: Map<number, ProfileProgress>): ProfileInsertionHooks {
  return {
    profile: (id) => profiles.get(id) ?? null,
    insertedProfileIds: () => [...profiles.keys()],
    isPlayerMerc: (id) => id < 50,
    insertionContext: () => ({ worldSector: C5, mercSector: C5, startSector: C5, usingEdgepoints: false }),
    reachedDestination: () => {},
    hasUnusedRecordWithApproach: () => true,
  };
}

describe('taking NPCs out of a sector', () => {
  it('keeps a pending walk as gridno insertion and overwrites the record with the action id', () => {
    const profiles = profileMap([testProfile(91)]);
    const s = soldierFor(40, Team.CIV, 91, 50);
    s.quoteRecord = 7;
    s.quoteActionId = 1;
    s.finalDestination = 900;
    s.absoluteFinalDestination = NOWHERE;
    setupProfileInsertionDataForSoldier(s, { inSector: true, strategicInsertionCode: 0 }, hooks(profiles));
    expect(profiles.get(91)).toMatchObject({ useProfileInsertion: true, insertionData: 900, quoteRecord: 1, quoteActionId: 1 });
  });

  it('moves a traversing NPC one sector and flags the done-traversal record', () => {
    const profiles = profileMap([testProfile(91, { sectorX: 5, sectorY: 3, useProfileInsertion: true })]);
    const s = soldierFor(40, Team.CIV, 91, 50);
    s.quoteRecord = 3;
    s.quoteActionId = 5;
    setupProfileInsertionDataForSoldier(s, { inSector: true, strategicInsertionCode: 0 }, hooks(profiles));
    expect(profiles.get(91)).toMatchObject({ sectorX: 6, sectorY: 3, useProfileInsertion: false, miscFlags3: 0x08 });
  });

  it('writes the life and stats of non-player soldiers back into their profiles', () => {
    const profiles = profileMap([testProfile(91), testProfile(3)]);
    const npc = soldierFor(40, Team.CIV, 91, 12);
    const merc = soldierFor(3, Team.OUR, 3, 1);
    npc.placed = true;
    merc.placed = true;
    updateSoldierPointerDataIntoProfile({ mercSlots: [npc, merc] } as never, hooks(profiles));
    expect(profiles.get(91)?.life).toBe(12);
    expect(profiles.get(91)?.stats.lifeMax).toBe(60);
    expect(profiles.get(3)?.life).toBe(50);
  });
});
