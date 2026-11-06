import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Orientation } from '../../../content/formats/jsd.ts';
import { NOTHING } from '../../../content/items/items.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { TravelCost } from '../../../content/world/movement-costs.ts';
import { StructureFlags } from '../../../content/world/structures.ts';
import { syntheticStructure } from '../../../content/world/synthetic.ts';
import { createItem } from '../../items/object.ts';
import { snapshotJson, snapshotTactical } from '../../snapshot/session.ts';
import type { TacticalContent } from '../content.ts';
import { SmokeTile, setSmokeFlagsAt } from '../explosions/smoke.ts';
import { InvSlot } from '../inventory.ts';
import {
  initLighting,
  lightSetBaseLevel,
  lightSpriteCreate,
  lightSpritePosition,
  lightSpritePower,
  lightSpriteRenderAll,
  NORMAL_LIGHTLEVEL_DAY,
  NORMAL_LIGHTLEVEL_NIGHT,
} from '../lighting/lighting.ts';
import { directionToward } from '../movement.ts';
import { sayFirstCreatureSightingQuote } from '../narrative/sighting-quotes.ts';
import { BloodKind, internalDropBlood, updateBloodGraphics } from '../smell.ts';
import { Body, type Soldier, TEAM_FIRST_ID, Team } from '../soldier.ts';
import { clearOccupants, placeOccupant, removeOccupant, type TacticalState } from '../state.ts';
import { reevaluateEnemyStance } from './enemy-stance.ts';
import {
  examineSlantRoofsOverRevealedTiles,
  markGroundRevealed,
  RevealedFlags,
  removeHiddenRoomRoofAt,
  restoreFogOfWar,
  setMapRevealedStatus,
} from './fov.ts';
import { lookUnlessUnchanged, setLookSkipping } from './look-memo.ts';
import { Opp } from './opp.ts';
import { allTeamsLookForAll, decayPublicOpplist } from './sight.ts';
import { SlantRoofSlots } from './slant-roofs.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

afterEach(() => {
  setLookSkipping(true);
});

const MERC_AT = gridNo(80, 80);
const CIVILIAN_AT = gridNo(80, 76);
const ELSEWHERE = gridNo(120, 120);
const ELSEWHERE_ROOM = 7;
const DAYLIGHT_ONLY = gridNo(80, 91);
const UNSEEN = -1;
const BLOOD = 3;

function scene() {
  const sim = newCombatSim(content);
  const t = sim.state;
  const merc = spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.SOUTH);
  const civilian = spawnSoldier(sim, TEAM_FIRST_ID[Team.CIV], Team.CIV, CIVILIAN_AT, Direction.SOUTH);
  civilian.neutral = true;
  let looks = 0;
  const look = (work: () => void = () => {}) =>
    lookUnlessUnchanged(t, () => {
      looks++;
      work();
    });
  return { sim, t, merc, civilian, look, looks: () => looks };
}

function lampAt(t: TacticalState, g: number): void {
  const lamp = lightSpriteCreate(t, 'L-R03.LHT');
  if (!lamp) throw new Error('no lamp template');
  lightSpritePower(lamp, true);
  lightSpritePosition(t, lamp, g % 160, Math.trunc(g / 160));
}

function roomElsewhere(t: TacticalState): void {
  const revealed = Uint8Array.from(t.fog.revealed);
  const roomHidden = Uint8Array.from(t.fog.roomHidden);
  roomHidden[ELSEWHERE_ROOM] = 1;
  restoreFogOfWar(t, revealed, roomHidden);
  t.world.level.rooms[ELSEWHERE] = ELSEWHERE_ROOM;
}

const WRITERS: readonly (readonly [string, (t: TacticalState, merc: Soldier, civilian: Soldier) => void])[] = [
  ['a smoke tile (setSmokeFlagsAt)', (t) => setSmokeFlagsAt(t, ELSEWHERE, 0, SmokeTile.SMOKE)],
  ['the ambient light (lightSetBaseLevel)', (t) => lightSetBaseLevel(t, NORMAL_LIGHTLEVEL_NIGHT)],
  ['a light drawn (lightSpritePosition)', (t) => lampAt(t, ELSEWHERE)],
  ['the lights rendered again (lightSpriteRenderAll)', (t) => lightSpriteRenderAll(t)],
  ['the map lights loaded (initLighting)', (t) => initLighting(t, { ambient: null, lights: null }, 12, NORMAL_LIGHTLEVEL_DAY)],
  ['a tile revealed (markGroundRevealed)', (t) => markGroundRevealed(t, ELSEWHERE)],
  ['the revealed tiles set (setMapRevealedStatus)', (t) => setMapRevealedStatus(t, (g) => g === ELSEWHERE)],
  ['a room revealed (removeHiddenRoomRoofAt)', (t) => removeHiddenRoomRoofAt(t, ELSEWHERE)],
  ['the fog of a sector restored (restoreFogOfWar)', (t) => restoreFogOfWar(t, new Uint8Array(t.fog.revealed.length), t.fog.roomHidden)],
  ['the slanted roof ceilings examined (examineSlantRoofsOverRevealedTiles)', (t) => examineSlantRoofsOverRevealedTiles(t)],
  ['blood to redraw (internalDropBlood)', (t) => internalDropBlood(t, ELSEWHERE, 0, BloodKind.HUMAN, BLOOD, UNSEEN)],
  ['an occupant taken off (removeOccupant)', (t, _merc, civilian) => removeOccupant(t, civilian)],
  ['the occupants cleared (clearOccupants)', (t) => clearOccupants(t)],
  ['a movement cost forced (MovementCosts.force)', (t) => t.world.costs.force(ELSEWHERE, 0, 0, TravelCost.WALL)],
  ['a movement cost raised (MovementCosts.raise)', (t) => t.world.costs.raise(ELSEWHERE, 0, 0, TravelCost.OBSTACLE)],
  ['a tile of movement costs cleared (MovementCosts.clearTile)', (t) => t.world.costs.clearTile(ELSEWHERE)],
  ['the movement costs replaced (MovementCosts.replaceWith)', (t) => t.world.costs.replaceWith(t.world.costs.values.slice())],
  [
    'a structure added (WorldStructures.add)',
    (t) => t.world.structures.add(ELSEWHERE, 0, syntheticStructure(StructureFlags.WALL, Orientation.OUTSIDE_RIGHT)),
  ],
];

describe('the remembered look: a look whose inputs all stand again changes nothing and is skipped', () => {
  it('skips a look while nothing changed since the last look that changed nothing', () => {
    const { look, looks } = scene();
    look();
    look();
    look();
    expect(looks()).toBe(1);
  });

  it.each(WRITERS)('looks again after %s, the writer counting its change', (_writer, write) => {
    const { t, merc, civilian, look, looks } = scene();
    roomElsewhere(t);
    look();
    write(t, merc, civilian);
    look();
    expect(looks()).toBe(2);
  });

  it('looks again after blood was redrawn by a look and after an occupant was placed, both counted', () => {
    const { t, civilian, look, looks } = scene();
    internalDropBlood(t, ELSEWHERE, 0, BloodKind.HUMAN, BLOOD, UNSEEN);
    removeOccupant(t, civilian);
    look();
    updateBloodGraphics(t, ELSEWHERE, 0);
    look();
    placeOccupant(t, civilian);
    look();
    expect(looks()).toBe(3);
  });

  it('looks again after a room was revealed whose tiles all were, counting the room alone', () => {
    const { t, look, looks } = scene();
    roomElsewhere(t);
    markGroundRevealed(t, ELSEWHERE);
    look();
    removeHiddenRoomRoofAt(t, ELSEWHERE);
    look();
    expect(looks()).toBe(2);
  });

  it('looks again after a seen tile of a slanted roof lost its ceiling, counting the ceiling alone', () => {
    const { t, look, looks } = scene();
    t.world.structures.add(ELSEWHERE, 1, syntheticStructure(StructureFlags.SLANTED_ROOF, Orientation.NONE, { tiles: [[0, 0]] }));
    markGroundRevealed(t, ELSEWHERE);
    t.fog.slantRoofCeilings[ELSEWHERE] = 1;
    look();
    const slots = new SlantRoofSlots();
    slots.addSeenTile(t, ELSEWHERE);
    slots.examine(t, (g) => ((t.fog.revealed[g] ?? 0) & RevealedFlags.GROUND) !== 0);
    look();
    expect([t.fog.slantRoofCeilings[ELSEWHERE], looks()]).toEqual([0, 2]);
  });

  it('looks again after a structure was taken away', () => {
    const { t, look, looks } = scene();
    const wall = t.world.structures.add(ELSEWHERE, 0, syntheticStructure(StructureFlags.WALL, Orientation.OUTSIDE_RIGHT));
    look();
    if (wall) t.world.structures.remove(wall);
    look();
    expect(looks()).toBe(2);
  });

  it('looks again after a soldier turned, an item showed or a door was seen', () => {
    const { t, merc, look, looks } = scene();
    const item = createItem(content.items, content.items.byName.get('GLOCK_17')?.index ?? 0, 100);
    t.worldItems.push({ gridNo: ELSEWHERE, level: 0, object: item, flags: 0, zHeight: 0, visible: 0 });
    t.doorStatus.set(ELSEWHERE, {
      open: false,
      perceivedOpen: false,
      perceivedNotSet: true,
      busy: false,
      shownOpen: false,
      hasTinCan: false,
    });
    look();
    merc.direction = Direction.NORTH;
    look();
    const lying = t.worldItems[0];
    if (lying) lying.visible = 1;
    look();
    const door = t.doorStatus.get(ELSEWHERE);
    if (door) door.perceivedNotSet = false;
    look();
    expect(looks()).toBe(4);
  });

  it('never remembers a look that readied an enemy weapon, whose inputs it does not record', () => {
    const { sim, merc, look, looks } = scene();
    const at = gridNo(84, 80);
    const enemy = spawnSoldier(sim, TEAM_FIRST_ID[Team.ENEMY], Team.ENEMY, at, directionToward(at, MERC_AT));
    enemy.inv[InvSlot.HAND] = createItem(content.items, NOTHING, 0);
    enemy.desiredDirection = enemy.direction;
    enemy.dontChargeReadyAPs = true;
    enemy.oppList[merc.id] = Opp.SEEN_CURRENTLY;
    enemy.ai.oppCount = 1;
    const readies = () => reevaluateEnemyStance(sim.state, enemy, enemy.state);
    look(readies);
    look(readies);
    expect(looks()).toBe(2);
  });

  it('never remembers a look in which a merc without a profile said the first creature line, which leaves no flag', () => {
    const { t, merc, look, looks } = scene();
    const said: number[] = [];
    t.narrative = { ...t.narrative, sayQuote: (_s, quote) => said.push(quote) };
    look(() => sayFirstCreatureSightingQuote(t, merc));
    look(() => sayFirstCreatureSightingQuote(t, merc));
    expect([looks(), said.length]).toEqual([2, 2]);
  });

  it('runs every look with the skip off', () => {
    const { look, looks } = scene();
    setLookSkipping(false);
    look();
    look();
    expect(looks()).toBe(2);
  });
});

describe('a skipped look leaves what the look would leave', () => {
  function lookout(skipping: boolean) {
    setLookSkipping(skipping);
    const { t, merc } = scene();
    lightSetBaseLevel(t, NORMAL_LIGHTLEVEL_NIGHT);
    allTeamsLookForAll(t);
    allTeamsLookForAll(t);
    return { t, merc };
  }

  it.each([true, false])('reveals what the day light reaches at the first look after the light changed (skip %s)', (skipping) => {
    const { t } = lookout(skipping);
    const before = (t.fog.revealed[DAYLIGHT_ONLY] ?? 0) & RevealedFlags.GROUND;
    lightSetBaseLevel(t, NORMAL_LIGHTLEVEL_DAY);
    allTeamsLookForAll(t);
    expect([before, (t.fog.revealed[DAYLIGHT_ONLY] ?? 0) & RevealedFlags.GROUND]).toEqual([0, RevealedFlags.GROUND]);
  });

  it.each([true, false])('puts back the last merc to radio, which the opplist decay forgot, as the look would (skip %s)', (skipping) => {
    const { t, merc } = lookout(skipping);
    decayPublicOpplist(t, Team.OUR);
    expect(t.perception.lastMercToRadio[Team.OUR]).toBeNull();
    allTeamsLookForAll(t);
    expect(t.perception.lastMercToRadio[Team.OUR]).toBe(merc);
  });

  it('leaves no trace of the memo, the change counts or the view markers in a snapshot', () => {
    const { sim, t } = scene();
    allTeamsLookForAll(t);
    allTeamsLookForAll(t);
    const json = snapshotJson(snapshotTactical(sim, { content }));
    expect(['lookMemo', 'changes', 'viewMarkers', 'markerValue'].filter((key) => json.includes(`"${key}"`))).toEqual([]);
  });
});

type Change = (t: TacticalState, merc: Soldier, civilian: Soldier) => void;

const asleep = new Set<Soldier>();
const tolerance = { corpseQuoteTolerance: 0 };

const SOLDIER_CHANGES: readonly (readonly [string, Change])[] = [
  ['placed', (_t, _m, c) => Object.assign(c, { placed: false })],
  ['life', (_t, _m, c) => c.life--],
  ['team', (_t, _m, c) => Object.assign(c, { team: Team.MILITIA })],
  ['side', (_t, _m, c) => c.side++],
  ['neutral', (_t, _m, c) => Object.assign(c, { neutral: false })],
  ['body', (_t, _m, c) => Object.assign(c, { bodyType: Body.BLOODCAT })],
  ['profile', (_t, _m, c) => c.profile++],
  ['soldier class', (_t, _m, c) => Object.assign(c, { soldierClass: c.soldierClass + 1 })],
  ['tile', (_t, _m, c) => c.gridNo++],
  ['level', (_t, _m, c) => c.level++],
  ['x', (_t, _m, c) => c.x++],
  ['y', (_t, _m, c) => c.y++],
  ['direction', (_t, m) => Object.assign(m, { direction: Direction.NORTH })],
  ['desired direction', (_t, m) => Object.assign(m, { desiredDirection: Direction.NORTH })],
  ['animation state', (_t, m) => m.state++],
  ['terrain', (_t, m) => m.overTerrain++],
  ['tiles moved', (_t, _m, c) => c.tilesMoved++],
  ['camouflage', (_t, _m, c) => c.camo++],
  ['blindness', (_t, m) => m.blindedCounter++],
  ['muzzle flash', (_t, _m, c) => Object.assign(c, { muzzleFlash: true })],
  ['gas', (_t, m) => Object.assign(m, { gassed: true })],
  ['smell', (_t, _m, c) => c.normalSmell++],
  ['creature smell', (_t, _m, c) => c.monsterSmell++],
  ['monster or animal', (_t, m) => Object.assign(m, { monsterOrAnimal: true })],
  ['first skill', (_t, m) => m.skillTrait1++],
  ['second skill', (_t, m) => m.skillTrait2++],
  ['head gear', (_t, m) => Object.assign(m.inv, { [InvSlot.HEAD1]: createItem(content.items, itemNamed('NIGHTGOGGLES'), 100) })],
  ['second head gear', (_t, m) => Object.assign(m.inv, { [InvSlot.HEAD2]: createItem(content.items, itemNamed('GASMASK'), 100) })],
  ['visibility', (_t, _m, c) => c.visible++],
  ['fade', (_t, _m, c) => c.fade++],
  ['AI turn control', (_t, _m, c) => Object.assign(c, { aiTurnControl: true })],
  ['turn from prone', (_t, _m, c) => c.turningFromPronePosition++],
  ['new opponents', (_t, m) => m.newOppCnt++],
  ['new situation', (_t, _m, c) => c.ai.newSituation++],
  ['alert status', (_t, _m, c) => c.ai.alertStatus++],
  ['opponent count', (_t, _m, c) => c.ai.oppCount++],
  ['noise tile', (_t, m) => m.ai.noiseGridNo++],
  ['noise volume', (_t, m) => m.ai.noiseVolume++],
  ['noise level', (_t, m) => m.ai.noiseLevel++],
  ['sleep', (_t, m) => asleep.add(m)],
  ['profile flags', (t, m) => t.profiles.set(m.profile, { ...(t.profiles.get(m.profile) ?? {}), miscFlags: 1 } as never)],
  ['corpse quote tolerance', () => tolerance.corpseQuoteTolerance++],
];

const KNOWLEDGE_CHANGES: readonly (readonly [string, Change])[] = [
  ['an opinion', (_t, m, c) => Object.assign(m.oppList, { [c.id]: Opp.SEEN_THIS_TURN })],
  ['a last known tile', (_t, m, c) => Object.assign(c.oppList, { [m.id]: Opp.SEEN_LAST_TURN }, c.lastKnownOpp, { [m.id]: MERC_AT })],
  ['a public opinion', (t, _m, c) => Object.assign(t.perception.publicOpp[Team.OUR] ?? [], { [c.id]: Opp.SEEN_LAST_TURN })],
  ['a watched location increment', (t, m) => Object.assign(t.turn.watched.incremented, { [m.id * 3]: 1 })],
  ['the best sighting size', (t) => t.perception.bestSize++],
  ['a best sighting', (t, m) => Object.assign(t.perception.best, { 0: m })],
  ['the creatures seen', (t) => t.perception.playerTeamSawCreatures++],
  ['sight disallowed', (t) => Object.assign(t.perception, { disallowSight: true })],
  ['awareness of opposition', (t) => Object.assign(t.perception.awareOfOpposition, { [Team.ENEMY]: true })],
  ['a public noise', (t) => Object.assign(t.perception.publicNoiseVolume, { [Team.ENEMY]: 5 })],
  ['the sight flags', (t) => t.turn.sightFlags++],
  ['the door sighting delay', (t) => Object.assign(t.turn, { delayResolvingBestSightingDueToDoor: true })],
  ['the interrupt provoker', (t, m) => Object.assign(t.turn, { interruptProvoker: m })],
  ['the panic chosen one', (t, _m, c) => Object.assign(t.panic, { chosenOne: c })],
  ['combat', (t) => Object.assign(t, { inCombat: true })],
  ['the difficulty', (t) => Object.assign(t.options, { difficulty: t.options.difficulty + 1 })],
  ['blood and gore', (t) => Object.assign(t.options, { bloodAndGore: false })],
  ['the sector', (t) => Object.assign(t, { sector: { x: 1, y: 1, z: 0 } })],
  ['underground', (t) => Object.assign(t.lighting, { underground: true })],
  ['a cave light', (t) => Object.assign(t.lighting, { caves: true })],
  ['a corpse', (t) => t.corpses.push({ gridNo: ELSEWHERE, level: 0 } as never)],
];

function itemNamed(name: string): number {
  return content.items.byName.get(name)?.index ?? 0;
}

describe('every input the look records', () => {
  it.each([...SOLDIER_CHANGES, ...KNOWLEDGE_CHANGES])('looks again after a change of %s', (_input, change) => {
    const { t, merc, civilian, look, looks } = scene();
    asleep.clear();
    tolerance.corpseQuoteTolerance = 0;
    t.narrative = { ...t.narrative, mercAsleep: (s) => asleep.has(s), corpseQuoteRecord: () => tolerance };
    Object.assign(t.options, { difficulty: 1 });
    look();
    change(t, merc, civilian);
    look();
    expect(looks()).toBe(2);
  });
});
