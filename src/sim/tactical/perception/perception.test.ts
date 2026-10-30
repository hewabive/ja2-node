import { beforeAll, describe, expect, it, vi } from 'vitest';
import { progressFor } from '../../../../tests/support/autoresolve.ts';
import { loadTestContent, testDoorCosts } from '../../../../tests/support/tactical.ts';
import { Orientation } from '../../../content/formats/jsd.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { StructureFlags, type WorldStructures } from '../../../content/world/structures.ts';
import { syntheticStructure, syntheticWorld } from '../../../content/world/synthetic.ts';
import { Terrain } from '../../../content/world/terrain.ts';
import { Rng } from '../../../core/rng.ts';
import { createItem } from '../../items/object.ts';
import { initNewSoldierAnim, states } from '../animation.ts';
import type { TacticalContent } from '../content.ts';
import { InvSlot } from '../inventory.ts';
import { lightSetBaseLevel, lightSpriteCreate, lightSpritePosition, lightSpritePower } from '../lighting/lighting.ts';
import { setSoldierPosition } from '../movement.ts';
import { BOXING_RING } from '../narrative/boxing-state.ts';
import { StatKind } from '../profiles.ts';
import { Body, createSoldier, SkillTrait, type Soldier, Team } from '../soldier.ts';
import { createTacticalState, registerSoldier, type SectorRef, type TacticalState } from '../state.ts';
import { addItemToPool, Visibility } from '../world-items.ts';
import { revealedRooms, revealRoofsAndItems } from './fov.ts';
import { HeightClass, lineOfSightTest, soldierToSoldierLineOfSight } from './los.ts';
import { allTeamsLookForAll, distanceVisible, handleSight, Opp, SightFlags } from './sight.ts';
import { perceptionHooks } from './wiring.ts';

const doorCosts = testDoorCosts();
const MERC_PROFILE = 5;
const BLOODCAT_ARENA = { x: 5, y: 14, z: 0 };
const BESIDE_THE_ARENA = { x: 4, y: 14, z: 0 };
const ROOM_SURROUNDING_BOXING_RING = 3;
const SPOTTED_SOMETHING_TWO = 12;
let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const STATS = {
  agility: 60,
  dexterity: 60,
  strength: 60,
  wisdom: 60,
  leadership: 50,
  marksmanship: 60,
  mechanical: 30,
  explosives: 30,
  medical: 30,
  experience: 3,
};

function tactical(place: (s: WorldStructures) => void = () => {}): TacticalState {
  const w = syntheticWorld(doorCosts, place);
  const t = createTacticalState({ ...w, mapDoors: new Map() }, content, Rng.fromSeed(11));
  t.perceptionHooks = perceptionHooks(t, { checkForChangingOrders: () => {}, setNewSituation: () => {} });
  return t;
}

function spawn(t: TacticalState, team: number, at: number, direction: number): Soldier {
  const s = createSoldier({
    id: t.soldiers.length,
    team,
    name: '',
    bodyType: 0,
    palettes: { hair: '', skin: '', vest: '', pants: '' },
    stats: STATS,
    life: 80,
    gridNo: at,
    direction,
    state: states(content.animations).STANDING,
  });
  registerSoldier(t, s);
  setSoldierPosition(t, s, at);
  initNewSoldierAnim(t, s, states(content.animations).STANDING, 0, true);
  return s;
}

const NO_CAMO = { bodyType: Body.REGMALE, camo: 0, tilesMoved: 0, overTerrain: Terrain.FLAT_GROUND };
const stand = (g: number) => ({ gridNo: g, level: 0, heightClass: HeightClass.STAND, ...NO_CAMO });

describe('line of sight', () => {
  it('sees across open ground within range and not beyond it', () => {
    const t = tactical();
    const world = { structures: t.world.structures, heights: t.world.level.heights };
    expect(soldierToSoldierLineOfSight(world, stand(gridNo(80, 80)), stand(gridNo(80, 95)), 26, true)).toBeGreaterThan(0);
    expect(soldierToSoldierLineOfSight(world, stand(gridNo(80, 80)), stand(gridNo(80, 110)), 26, true)).toBe(0);
    expect(
      lineOfSightTest(world, gridNo(80, 80), 175, gridNo(80, 80), 175, { tileLimit: 26, treeReduction: 6, aware: true, camo: 0 }),
    ).toBe(0);
  });

  it('is blocked by a wall but not by a transparent structure', () => {
    const t = tactical((w) => {
      for (let x = 70; x <= 90; x++) w.add(gridNo(x, 85), 0, syntheticStructure(StructureFlags.WALL, Orientation.INSIDE_LEFT));
      w.add(gridNo(60, 85), 0, syntheticStructure(StructureFlags.GENERIC | StructureFlags.TRANSPARENT));
    });
    const world = { structures: t.world.structures, heights: t.world.level.heights };
    expect(soldierToSoldierLineOfSight(world, stand(gridNo(80, 80)), stand(gridNo(80, 90)), 26, true)).toBe(0);
    expect(soldierToSoldierLineOfSight(world, stand(gridNo(60, 80)), stand(gridNo(60, 90)), 26, true)).toBeGreaterThan(0);
  });

  it('loses range through foliage, more for an unaware viewer', () => {
    const t = tactical((w) => {
      for (let y = 87; y <= 88; y++) w.add(gridNo(80, y), 0, syntheticStructure(StructureFlags.TREE, Orientation.NONE, { height: 3 }));
    });
    const world = { structures: t.world.structures, heights: t.world.level.heights };
    const aware = soldierToSoldierLineOfSight(world, stand(gridNo(80, 80)), stand(gridNo(80, 96)), 26, true);
    const unaware = soldierToSoldierLineOfSight(world, stand(gridNo(80, 80)), stand(gridNo(80, 96)), 26, false);
    expect(aware).toBeGreaterThan(0);
    expect(unaware).toBe(0);
  });

  it('reads the land height at either end from the tile with column and row swapped', () => {
    const viewer = { gridNo: gridNo(70, 80), level: 0, heightClass: HeightClass.CROUCH, ...NO_CAMO };
    const swappedTile = gridNo(80, 70);
    const t = tactical((w) => w.add(gridNo(70, 81), 0, syntheticStructure(StructureFlags.GENERIC, Orientation.NONE, { height: 2 })));
    const heights = new Uint8Array(t.world.level.heights);
    const overTheCrate = () =>
      soldierToSoldierLineOfSight({ structures: t.world.structures, heights }, viewer, stand(gridNo(70, 86)), 26, true);
    expect(overTheCrate()).toBeGreaterThan(0);
    heights[swappedTile] = 15;
    expect(overTheCrate()).toBe(0);
  });
});

describe('sighting', () => {
  it('lets mercs reveal an enemy they face and start combat', () => {
    const t = tactical();
    const merc = spawn(t, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const enemy = spawn(t, Team.ENEMY, gridNo(80, 90), Direction.NORTH);
    expect(enemy.visible).toBe(-1);
    allTeamsLookForAll(t);
    expect(merc.oppList[enemy.id]).toBe(Opp.SEEN_CURRENTLY);
    expect(enemy.visible).toBe(1);
    expect(t.inCombat).toBe(true);
    expect(t.events.some((e) => e.type === 'combatStarted')).toBe(true);
  });

  it('does not see behind and keeps neutral civilians out of combat', () => {
    const t = tactical();
    spawn(t, Team.OUR, gridNo(80, 80), Direction.NORTH);
    const enemy = spawn(t, Team.ENEMY, gridNo(80, 95), Direction.SOUTH);
    const civ = spawn(t, Team.CIV, gridNo(81, 79), Direction.SOUTH);
    handleSight(t, t.soldiers[0] as Soldier, SightFlags.LOOK | SightFlags.RADIO);
    expect(enemy.visible).toBe(-1);
    expect(civ.visible).toBe(1);
    expect(t.inCombat).toBe(false);
  });

  it('gives a merc ten experience chances for an enemy he reveals who has not seen him, none for one who has', () => {
    const chancesOnRevealing = (enemyFacing: number) => {
      const t = tactical();
      const merc = spawn(t, Team.OUR, gridNo(80, 80), Direction.SOUTH);
      merc.profile = MERC_PROFILE;
      const p = progressFor(MERC_PROFILE);
      t.profiles.set(MERC_PROFILE, p);
      spawn(t, Team.ENEMY, gridNo(80, 90), enemyFacing);
      handleSight(t, merc, SightFlags.LOOK | SightFlags.RADIO);
      return p.statChangeChances[StatKind.EXPERIENCE];
    };
    expect(chancesOnRevealing(Direction.SOUTH)).toBe(10);
    expect(chancesOnRevealing(Direction.NORTH)).toBe(0);
  });

  it('puts the militia on red alert when a merc radios them an enemy he sees', () => {
    const t = tactical();
    const merc = spawn(t, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    spawn(t, Team.MILITIA, gridNo(60, 60), Direction.NORTH);
    spawn(t, Team.ENEMY, gridNo(80, 90), Direction.SOUTH);
    handleSight(t, merc, SightFlags.LOOK);
    expect(t.perception.awareOfOpposition[Team.MILITIA]).toBe(false);
    handleSight(t, merc, SightFlags.RADIO);
    expect(t.perception.awareOfOpposition[Team.MILITIA]).toBe(true);
  });

  it('turns every bloodcat hostile as soon as one is seen and lets creatures hunt neutral civilians', () => {
    const t = tactical();
    const merc = spawn(t, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const cats = [spawn(t, Team.CREATURE, gridNo(80, 90), Direction.NORTH), spawn(t, Team.CREATURE, gridNo(80, 70), Direction.NORTH)];
    for (const cat of cats) Object.assign(cat, { bodyType: Body.BLOODCAT, neutral: true });
    allTeamsLookForAll(t);
    expect(cats.map((c) => c.neutral)).toEqual([false, false]);
    expect([merc.ai.oppCount, cats[0]?.ai.oppCount, cats[1]?.oppList[merc.id]]).toEqual([1, 1, Opp.NOT_HEARD_OR_SEEN]);
    expect(t.inCombat).toBe(true);
    const other = tactical();
    const civ = spawn(other, Team.CIV, gridNo(80, 80), Direction.SOUTH);
    const creature = spawn(other, Team.CREATURE, gridNo(80, 90), Direction.NORTH);
    civ.neutral = true;
    allTeamsLookForAll(other);
    expect([creature.ai.oppCount, civ.ai.oppCount]).toEqual([1, 1]);
  });

  it('keeps the army and the creatures blind to each other in the bloodcat arena of N5, never the squad', () => {
    const sightings = (sector: SectorRef) => {
      const t = tactical();
      t.sector = sector;
      const soldier = spawn(t, Team.ENEMY, gridNo(80, 80), Direction.SOUTH);
      const cat = spawn(t, Team.CREATURE, gridNo(80, 86), Direction.NORTH);
      cat.bodyType = Body.BLOODCAT;
      const merc = spawn(t, Team.OUR, gridNo(86, 83), Direction.WEST);
      allTeamsLookForAll(t);
      return [soldier.oppList[cat.id], cat.oppList[soldier.id], merc.oppList[cat.id]];
    };
    expect(sightings(BLOODCAT_ARENA)).toEqual([Opp.NOT_HEARD_OR_SEEN, Opp.NOT_HEARD_OR_SEEN, Opp.SEEN_CURRENTLY]);
    expect(sightings(BESIDE_THE_ARENA)).toEqual([Opp.SEEN_CURRENTLY, Opp.SEEN_CURRENTLY, Opp.SEEN_CURRENTLY]);
  });
});

describe('fog of war', () => {
  function markRoom(t: TacticalState, room: number, x0: number, x1: number, y0: number, y1: number): void {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) t.world.level.rooms[gridNo(x, y)] = room;
  }

  it('reveals a room in view and reports it once', () => {
    const t = tactical();
    markRoom(t, 5, 78, 82, 84, 87);
    spawn(t, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    allTeamsLookForAll(t);
    allTeamsLookForAll(t);
    expect(revealedRooms(t)).toEqual([5]);
    expect(t.events.filter((e) => e.type === 'roomRevealed')).toEqual([{ type: 'roomRevealed', room: 5 }]);
  });

  it('keeps rooms behind walls, behind the viewer and in enemy view hidden', () => {
    const t = tactical((w) => {
      for (let x = 70; x <= 90; x++) w.add(gridNo(x, 85), 0, syntheticStructure(StructureFlags.WALL, Orientation.INSIDE_LEFT));
    });
    markRoom(t, 6, 78, 82, 86, 89);
    markRoom(t, 7, 78, 82, 74, 77);
    markRoom(t, 8, 58, 62, 84, 87);
    spawn(t, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    spawn(t, Team.ENEMY, gridNo(60, 80), Direction.SOUTH);
    allTeamsLookForAll(t);
    expect(revealedRooms(t)).toEqual([]);
  });

  it('shows the items lying anywhere in a room it reveals, with one spotted-something quote for the room (Render_Fun.cc RemoveRoomRoof)', () => {
    const t = tactical();
    markRoom(t, 5, 78, 82, 84, 87);
    markRoom(t, 5, 78, 82, 100, 103);
    const glock = content.items.byName.get('GLOCK_17')?.index ?? 0;
    const outOfView = [gridNo(78, 101), gridNo(82, 103)];
    const lying = outOfView.map((g) => addItemToPool(t, g, createItem(content.items, glock, 100), Visibility.INVISIBLE, 0));
    const merc = spawn(t, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    const said: [number, number][] = [];
    t.narrative = { ...t.narrative, sayQuote: (s, quote) => said.push([s.id, quote]) };
    const draws = vi.spyOn(t.rng, 'int').mockReturnValue(1);
    revealRoofsAndItems(t, merc, true);
    expect(lying.map((wi) => wi?.visible)).toEqual([Visibility.VISIBLE, Visibility.VISIBLE]);
    expect(t.events.filter((e) => e.type === 'itemsRevealed').map((e) => e.gridNo)).toEqual(outOfView);
    expect(said).toEqual([[merc.id, SPOTTED_SOMETHING_TWO]]);
    expect(draws.mock.calls).toEqual([[2]]);
  });

  it('reveals the boxing ring with the room around it, in the boxing sector only', () => {
    const revealed = (sector: SectorRef) => {
      const t = tactical();
      t.sector = sector;
      markRoom(t, ROOM_SURROUNDING_BOXING_RING, 78, 82, 84, 87);
      markRoom(t, BOXING_RING, 78, 82, 110, 112);
      revealRoofsAndItems(t, spawn(t, Team.OUR, gridNo(80, 80), Direction.SOUTH), true);
      return revealedRooms(t);
    };
    expect(revealed({ x: 5, y: 4, z: 0 })).toEqual([ROOM_SURROUNDING_BOXING_RING, BOXING_RING]);
    expect(revealed({ x: 5, y: 4, z: 1 })).toEqual([ROOM_SURROUNDING_BOXING_RING]);
    expect(revealed({ x: 6, y: 4, z: 0 })).toEqual([ROOM_SURROUNDING_BOXING_RING]);
  });

  it('reveals nothing to a vehicle or a blinded merc', () => {
    const revealed = (prepare: (s: Soldier) => void) => {
      const t = tactical();
      markRoom(t, 5, 78, 82, 84, 87);
      const merc = spawn(t, Team.OUR, gridNo(80, 80), Direction.SOUTH);
      prepare(merc);
      revealRoofsAndItems(t, merc, true);
      return [revealedRooms(t), t.fog.revealed.some((flags) => flags !== 0)];
    };
    expect(revealed(() => {})).toEqual([[5], true]);
    expect(
      revealed((s) => {
        s.bodyType = Body.HUMVEE;
      }),
    ).toEqual([[], false]);
    expect(
      revealed((s) => {
        s.blindedCounter = 2;
      }),
    ).toEqual([[], false]);
  });
});

describe('light for vision', () => {
  const ANY_DIRECTION = -1;
  const TARGET = gridNo(80, 90);

  function lamp(t: TacticalState, g: number): void {
    const l = lightSpriteCreate(t, 'L-R03.LHT');
    if (!l) throw new Error('no lamp');
    lightSpritePower(l, true);
    lightSpritePosition(t, l, g % 160, Math.trunc(g / 160));
  }

  function wear(viewer: Soldier, item: string): void {
    viewer.inv[InvSlot.HEAD1] = createItem(content.items, content.items.byName.get(item)?.index ?? 0, 100);
  }

  it('sees less far into the dark and farther into a lit tile', () => {
    const t = tactical();
    const viewer = spawn(t, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    lightSetBaseLevel(t, 12);
    expect(distanceVisible(t, viewer, ANY_DIRECTION, ANY_DIRECTION, TARGET, 0)).toBe(11);
    lamp(t, TARGET);
    expect(distanceVisible(t, viewer, ANY_DIRECTION, ANY_DIRECTION, TARGET, 0)).toBe(16);
  });

  it('adds night-ops and goggle bonuses in the dark and sun goggles in glare', () => {
    const t = tactical();
    const viewer = spawn(t, Team.OUR, gridNo(80, 80), Direction.SOUTH);
    lightSetBaseLevel(t, 12);
    viewer.skillTrait1 = SkillTrait.NIGHTOPS;
    expect(distanceVisible(t, viewer, ANY_DIRECTION, ANY_DIRECTION, TARGET, 0)).toBe(12);
    wear(viewer, 'NIGHTGOGGLES');
    expect(distanceVisible(t, viewer, ANY_DIRECTION, ANY_DIRECTION, TARGET, 0)).toBe(14);
    lightSetBaseLevel(t, 3);
    lamp(t, TARGET);
    expect(distanceVisible(t, viewer, ANY_DIRECTION, ANY_DIRECTION, TARGET, 0)).toBe(22);
    wear(viewer, 'SUNGOGGLES');
    expect(distanceVisible(t, viewer, ANY_DIRECTION, ANY_DIRECTION, TARGET, 0)).toBe(24);
  });
});
