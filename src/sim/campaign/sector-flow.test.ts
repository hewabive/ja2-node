import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { progressFor } from '../../../tests/support/autoresolve.ts';
import {
  type CampaignKit,
  createTestCampaign,
  landFirstSquad,
  ourSoldiers,
  runTicks,
  runUntilIdle,
  startFirstSquadsDrop,
  walkSquadToEastEdge,
} from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { itemId, runExplosivesUntilIdle } from '../../../tests/support/explosives.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { reloadPoint } from '../../../tests/support/reload.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { MapModificationType } from '../../content/formats/savegame-temp-files.ts';
import { type Sector, sectorFromId, sectorId, strategicIndex } from '../../content/strategic/sector-ids.ts';
import { Direction, WORLD_COLS, WORLD_MAX } from '../../content/world/grid.ts';
import { levelTilesAt } from '../../content/world/level.ts';
import { RestrictedScroll } from '../../content/world/render-bounds.ts';
import { has, StructureFlags } from '../../content/world/structures.ts';
import { syntheticStructure } from '../../content/world/synthetic.ts';
import { tileIndex, tileTypeOf, typeIndex } from '../../content/world/tile-tables.ts';
import { idiv } from '../../core/int.ts';
import { createItem } from '../items/object.ts';
import { assignGameOptions } from '../options.ts';
import { EncounterCode, InsertionCode, SectorFlag } from '../strategic/forces/constants.ts';
import { createNewEnemyGroupDepartingFromSector, getGroup } from '../strategic/forces/groups.ts';
import { getSectorFlagStatus, sectorInfo, setSectorFlag } from '../strategic/map/sectors.ts';
import { Warp } from '../strategic/time/constants.ts';
import { warpGameTime, worldDay, worldHour } from '../strategic/time/world-clock.ts';
import { Situation } from '../tactical/ai/actions.ts';
import { PanicFlags } from '../tactical/ai/panic-triggers.ts';
import { anim } from '../tactical/anim-states.ts';
import { Detonator, PANIC_FREQUENCY, setDelay, setDetonator, setFrequency } from '../tactical/bombs/bomb-object.ts';
import { addBlueFlag, knownMineTiles, MineFlag, setMineFlag } from '../tactical/bombs/mine-flags.ts';
import { perceiveDoor } from '../tactical/doors/door-status.ts';
import { handleDoorChangeFromGridNo, isDoorOpenAt } from '../tactical/doors.ts';
import { igniteExplosion } from '../tactical/explosions/explosion.ts';
import { InvSlot } from '../tactical/inventory.ts';
import { setHelicopterOnMap } from '../tactical/landed-helicopter.ts';
import {
  lightSpriteRenderAll,
  lightTrueLevel,
  NORMAL_LIGHTLEVEL_DAY,
  NORMAL_LIGHTLEVEL_NIGHT,
  timeOfDayAmbientLevel,
} from '../tactical/lighting/lighting.ts';
import {
  addObjectToHead,
  MapChangeKind,
  objectLayerAt,
  recordStructureRemoved,
  removeStructTile,
  structLayerAt,
} from '../tactical/map-changes.ts';
import { setSoldierPosition } from '../tactical/movement.ts';
import { militiaChangesSides } from '../tactical/narrative/civ-hostility.ts';
import { RevealedFlags } from '../tactical/perception/fov.ts';
import { addRottingCorpse, ROTTING_STAGE2 } from '../tactical/rotting-corpses.ts';
import { NO_SAVED_SECTOR_CHANGES } from '../tactical/save-import.ts';
import { pickGridNoNearestEdge } from '../tactical/sector-exit.ts';
import { BloodKind, bloodFloorStrength, dropSmell, internalDropBlood, MAX_BLOOD_QUANTITY, smellStrength } from '../tactical/smell.ts';
import { Body, NO_PROFILE, Side, SoldierClass, TEAM_FIRST_ID, Team } from '../tactical/soldier.ts';
import { sectorMapOf, type TacticalState, teamMembers, WaitForMercs, whoIsThere } from '../tactical/state.ts';
import { addItemToPool, Visibility, WorldItemFlags } from '../tactical/world-items.ts';
import { bloodViews, tileChangeViews } from '../tactical/world-view.ts';
import { lastMapRestrictedScroll } from './flow-state.ts';
import { helicopterDropUnderWay } from './helicopter-drop-flow.ts';
import { sectorKey } from './sector-diff.ts';
import { type SectorWorlds, UnloadCode } from './sector-flow.ts';
import { sectorDiffOf } from './sector-loot.ts';
import { addStructToUnloadedSector } from './unloaded-map.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const A9 = { x: 9, y: 1, z: 0 };
const POOL_ROWS_SOUTH = 3;
const STRONG_SMELL = 40;
const UNSEEN = -1;
const A10 = { x: 10, y: 1, z: 0 };
const NO_GARRISON = { admins: 0, troops: 0, elites: 0 };
const NO_GARRISON_COUNTS = { numAdmins: 0, numTroops: 0, numElites: 0 };
const LONE_ADMIN = { admins: 1, troops: 0, elites: 0 };
const WALK_OFF_TICKS = 2000;
const LEAVER_PROFILE = 1;
const RAN_AWAY_MORALE = -5;
const TICKS_PER_WORLD_SECOND = 200;
const QUICK_TRAVERSAL_MINUTES = 5;
const MIN_CROWS_POSSIBLE = 5;
const MAX_CROWS_POSSIBLE = 9;
const FIRST_TENSE_QUOTE_DELAY_MIN = 10;
const FIRST_TENSE_QUOTE_DELAY_MAX = 29;
const NIGHT_ENDS_HOUR = 7;
const CROW_LANDING_RADIUS = 2;
const NOON_HOUR = 12;
const HOURS_PER_DAY = 24;
const B13 = { x: 13, y: 2, z: 0 };
const STUB_A10_MAP = 'maps/a10.dat';
const DRASSEN_HELIPAD = 9001;
const TAIL_BOOM_GRIDNO = DRASSEN_HELIPAD - 800;
const TAIL_BOOM_SUB_INDEX = 3;
const BESIDE_HELIPAD = DRASSEN_HELIPAD + 2;
const AIRFIELD_DOOR = 8060;
const AIRFIELD_WINDOW = 7889;
const DOOR_PERCEIVED_OPEN = 0x02;
const NIGHT_LIGHTS_HOUR = 22;
const HANGAR_DOOR = 8374;
const HANGAR_WALL = HANGAR_DOOR + 1;
const HANGAR_FLOOR = HANGAR_WALL - 160;
const GROUND_LEVEL = 0;
const LANDING_WALK_RADIUS = 3;
const BITS_PER_BYTE = 8;

describe('loading a sector from the strategic layer', () => {
  it('lands the first squad in A9 and places the garrison from the strategic counts', () => {
    const { campaign } = createTestCampaign(kit, { seed: 5, garrison: { admins: 1, troops: 3, elites: 1 } });
    landFirstSquad(campaign);
    const t = campaign.tactical?.state;
    expect(campaign.state.worldSector).toEqual(A9);
    expect(campaign.state.flow).toBe('tactical');
    if (!t) throw new Error('no sector');
    expect(ourSoldiers(campaign)).toHaveLength(4);
    const enemies = teamMembers(t, Team.ENEMY);
    const classes = enemies.map((s) => s.soldierClass).sort();
    expect(classes).toEqual(
      [SoldierClass.ADMINISTRATOR, SoldierClass.ELITE, SoldierClass.ARMY, SoldierClass.ARMY, SoldierClass.ARMY].sort(),
    );
    const a9 = sectorInfo(campaign.state.map, A9);
    expect([a9.adminsInBattle, a9.troopsInBattle, a9.elitesInBattle]).toEqual([1, 3, 1]);
    for (const flag of [SectorFlag.ALREADY_VISITED, SectorFlag.ALREADY_LOADED, SectorFlag.HAS_ENTERED_TACTICAL])
      expect(getSectorFlagStatus(campaign.state.map, A9, flag)).toBe(true);
    expect(t.rng).toBe(campaign.state.rng);
    expect(t.pre).toBe(campaign.state.pre);
    expect(t.profiles).toBe(campaign.state.profiles);
  });

  it('drops the mercs one at a time, the next once the one before reaches code 467, which turns him east and walks him to the closest free tile of his south-east quadrant (Merc_Entering.cc:579, Soldier_Ani.cc code 467)', () => {
    const { campaign } = createTestCampaign(kit, { seed: 5, garrison: NO_GARRISON });
    startFirstSquadsDrop(campaign);
    const t = campaign.tactical?.state;
    if (!t) throw new Error('no sector');
    const landed = new Map<number, { gridNo: number; eastFree: boolean; direction: number }>();
    const helidrop = anim(t.content, 'HELIDROP');
    let engaged = false;
    for (let tick = 0; helicopterDropUnderWay(campaign); tick++) {
      if (tick > 40_000) throw new Error('the drop did not end');
      campaign.step();
      const dropping = ourSoldiers(campaign).filter((s) => s.state === helidrop);
      expect(dropping.length).toBeLessThanOrEqual(1);
      const freed = engaged && !t.helicopterDrop.engagedInDrop;
      engaged = t.helicopterDrop.engagedInDrop;
      if (!freed) continue;
      const s = ourSoldiers(campaign).find((m) => !landed.has(m.id));
      if (s) landed.set(s.id, { gridNo: s.gridNo, eastFree: whoIsThere(t, s.gridNo + 1, 0) === null, direction: s.direction });
    }
    expect(landed.size).toBe(4);
    expect(new Set([...landed.values()].map((l) => l.direction))).toEqual(new Set([Direction.EAST]));
    runUntilIdle(campaign);
    const steps = ourSoldiers(campaign).map((s) => {
      const from = landed.get(s.id) ?? { gridNo: s.gridNo, eastFree: false };
      const east = (s.gridNo % WORLD_COLS) - (from.gridNo % WORLD_COLS);
      const south = idiv(s.gridNo, WORLD_COLS) - idiv(from.gridNo, WORLD_COLS);
      return { east, south, eastFree: from.eastFree, direction: s.direction };
    });
    const inQuadrant = ({ east, south }: { east: number; south: number }) =>
      east >= 0 && south >= 0 && east <= LANDING_WALK_RADIUS && south <= LANDING_WALK_RADIUS && east + south > 0;
    expect(steps.every(inQuadrant)).toBe(true);
    const eastward = steps.filter((step) => step.eastFree);
    expect(eastward.length).toBeGreaterThan(0);
    expect(eastward).toEqual(eastward.map((step) => ({ ...step, east: 1, south: 0, direction: Direction.EAST })));
    expect(steps.some((step) => !step.eastFree)).toBe(true);
  });

  it('uses the guide description of a described town sector once, H13 only with sci-fi', () => {
    const { campaign } = createTestCampaign(kit, { seed: 7, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    const flow = flowOf(campaign);
    const visit = (sector: { x: number; y: number; z: number }) => {
      for (const m of flow.setup.roster.all()) m.sector = { ...sector };
      expect(flow.setCurrentWorldSector(sector)).toBe(true);
      return getSectorFlagStatus(campaign.state.map, sector, SectorFlag.HAVE_USED_GUIDE_QUOTE);
    };
    assignGameOptions(campaign.state.options, { sciFi: false });
    expect(getSectorFlagStatus(campaign.state.map, A9, SectorFlag.HAVE_USED_GUIDE_QUOTE)).toBe(false);
    expect(visit({ x: 13, y: 2, z: 0 })).toBe(true);
    expect(visit({ x: 13, y: 8, z: 0 })).toBe(false);
    assignGameOptions(campaign.state.options, { sciFi: true });
    expect(visit({ x: 14, y: 8, z: 0 })).toBe(true);
    expect(visit({ x: 13, y: 8, z: 0 })).toBe(true);
  });

  it('reports the death of a placed enemy to the Queen', () => {
    const { campaign } = createTestCampaign(kit, { seed: 6, garrison: { admins: 0, troops: 2, elites: 0 } });
    landFirstSquad(campaign);
    const t = campaign.tactical?.state;
    if (!t) throw new Error('no sector');
    const victim = teamMembers(t, Team.ENEMY)[0];
    if (!victim) throw new Error('no enemy');
    t.sectorHooks.soldierDied(t, victim);
    const a9 = sectorInfo(campaign.state.map, A9);
    expect([a9.numTroops, a9.troopsInBattle]).toEqual([1, 1]);
  });
});

describe('leaving a sector', () => {
  it('walks the squad off the east edge, waits at most 2500 ms and loads A10 with a walk-in', () => {
    const { campaign } = createTestCampaign(kit, { seed: 7, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    walkSquadToEastEdge(campaign);
    const minute = Math.trunc(campaign.state.clock.seconds / 60);
    const result = campaign.dispatch({ type: 'exitSector', soldier: 0, direction: 'east', who: 'squad' });
    expect(result).toMatchObject({ ok: true, data: { who: 'squad', load: true, target: 'A10' } });
    expect(campaign.tactical?.state.mercsWaiting?.code).toBe(WaitForMercs.WALKOFF_SCREEN);
    expect(campaign.tactical?.state.perception.disallowSight).toBe(true);
    expect(campaign.dispatch({ type: 'move', soldier: 1, to: 12880 })).toMatchObject({ ok: false });
    const before = campaign.tactical?.state;
    if (!before) throw new Error('no sector');
    const startMs = before.clockMs;
    runTicks(campaign, 2000, () => campaign.tactical?.state !== before);
    expect(campaign.tactical?.state).not.toBe(before);
    expect(campaign.state.worldSector).toEqual(A10);
    expect(before.clockMs - startMs).toBeLessThanOrEqual(2505);
    expect(Math.trunc(campaign.state.clock.seconds / 60)).toBe(minute + 5);
    const after = campaign.tactical?.state;
    if (!after) throw new Error('no sector');
    expect(after.mercsWaiting?.code).toBe(WaitForMercs.WALKON_SCREEN);
    expect(campaign.dispatch({ type: 'stance', soldier: 1, stance: 'crouch' })).toMatchObject({ ok: false });
    expect(ourSoldiers(campaign)).toHaveLength(4);
    const diff = campaign.state.sectorDiffs.get(sectorKey(A9));
    expect(diff?.items).not.toBeNull();
    expect(getSectorFlagStatus(campaign.state.map, A9, SectorFlag.ITEM_TEMP_FILE_EXISTS)).toBe(true);
    runUntilIdle(campaign);
    expect(campaign.tactical?.state.mercsWaiting).toBeNull();
    expect(campaign.tactical?.state.perception.disallowSight).toBe(false);
  });

  it('keeps a hostile sector the last merc walked off without a load until the map opens, which unloads it so time compresses again (GameScreen.cc InternalLeaveTacticalScreen)', () => {
    const { campaign, roster } = createTestCampaign(kit, { seed: 11, mercs: 1, garrison: LONE_ADMIN });
    landFirstSquad(campaign);
    const leaver = ourSoldiers(campaign)[0];
    if (!leaver) throw new Error('no merc');
    walkSquadToEastEdge(campaign);
    expect(campaign.tactical?.state.turn.enemyInSector).toBe(true);
    const r = campaign.dispatch({ type: 'exitSector', soldier: leaver.id, direction: 'east', who: 'merc', load: false });
    expect(r).toMatchObject({ ok: true, data: { who: 'merc', load: false, target: 'A10' } });
    runTicks(campaign, 2000, () => !roster.get(leaver.id)?.soldier.placed && !campaign.tactical?.state.mercsWaiting);
    expect([campaign.state.worldSector, campaign.tactical?.state.turn.enemyInSector]).toEqual([A9, true]);
    expect(campaign.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    expect([campaign.tactical, campaign.state.worldSector]).toEqual([null, null]);
    expect(campaign.dispatch({ type: 'compressTime', mode: 2 })).toEqual({ ok: true });
  });

  it('counts the squad walked off the edge, still in the sector, in its strength at the retreat, so the run away hits its morale at once (PlayerStrength, Strategic_Town_Loyalty.cc:1153, Morale.cc:344)', () => {
    const { campaign, roster } = createTestCampaign(kit, { seed: 11, mercs: 1, garrison: LONE_ADMIN });
    landFirstSquad(campaign);
    const leaver = ourSoldiers(campaign)[0];
    if (!leaver) throw new Error('no merc');
    leaver.profile = LEAVER_PROFILE;
    campaign.state.profiles.set(LEAVER_PROFILE, progressFor(LEAVER_PROFILE));
    walkSquadToEastEdge(campaign);
    expect(campaign.dispatch({ type: 'exitSector', soldier: leaver.id, direction: 'east', who: 'squad', load: true }).ok).toBe(true);
    runTicks(campaign, WALK_OFF_TICKS, () => campaign.state.worldSector?.x === A10.x);
    const left = roster.get(leaver.id)?.soldier;
    expect([left?.strategicMoraleMod, left?.delayedStrategicMoraleMod]).toEqual([RAN_AWAY_MORALE, 0]);
  });

  it('stands the world clock while a merc walks off, the interface lock pausing the game, and runs it again once he is gone (StrategicMap.cc JumpIntoAdjacentSector LU_BEGINUILOCK)', () => {
    const { campaign, roster } = createTestCampaign(kit, { seed: 11, mercs: 1, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    const leaver = ourSoldiers(campaign)[0];
    if (!leaver) throw new Error('no merc');
    walkSquadToEastEdge(campaign);
    const r = campaign.dispatch({ type: 'exitSector', soldier: leaver.id, direction: 'east', who: 'merc', load: false });
    expect(r).toMatchObject({ ok: true, data: { who: 'merc', load: false } });
    const seconds = campaign.state.clock.seconds;
    const clock = () => campaign.state.clock;
    const walking = runTicks(campaign, WALK_OFF_TICKS, () => !campaign.tactical?.state.mercsWaiting);
    expect(walking).toBeGreaterThan(TICKS_PER_WORLD_SECOND);
    expect(roster.get(leaver.id)?.soldier.placed).toBe(false);
    expect([clock().seconds, clock().paused, clock().pauseLocked]).toEqual([seconds, false, false]);
    runTicks(campaign, TICKS_PER_WORLD_SECOND);
    expect(clock().seconds).toBe(seconds + 1);
  });

  it('lifts the pause of a traversal into a hostile sector once the squad has walked in (Overhead.cc WAIT_FOR_MERCS_TO_WALKON_SCREEN, Handle_UI.cc UIHandleLUIEndLock)', () => {
    const { campaign } = createTestCampaign(kit, { seed: 7, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    Object.assign(sectorInfo(campaign.state.map, A10), { ...NO_GARRISON_COUNTS, numAdmins: 1 });
    walkSquadToEastEdge(campaign);
    expect(campaign.dispatch({ type: 'exitSector', soldier: 0, direction: 'east', who: 'squad' })).toMatchObject({
      ok: true,
      data: { load: true, target: 'A10' },
    });
    const before = campaign.tactical?.state;
    runTicks(campaign, 2000, () => campaign.tactical?.state !== before);
    const clock = () => campaign.state.clock;
    expect([campaign.state.worldSector, campaign.tactical?.state.turn.enemyInSector, clock().paused]).toEqual([A10, true, true]);
    runTicks(campaign, 4000, () => campaign.tactical?.state.mercsWaiting === null);
    expect([campaign.tactical?.state.mercsWaiting, clock().paused, clock().pauseLocked]).toEqual([null, false, false]);
  });

  it('never lowers the underground traversal flag, so every traversal after the first underground one takes a minute (StrategicMap.cc AllMercsHaveWalkedOffSector)', () => {
    const { campaign } = createTestCampaign(kit, { seed: 7, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    walkSquadToEastEdge(campaign);
    campaign.state.movement.undergroundTacticalTraversal = true;
    const result = campaign.dispatch({ type: 'exitSector', soldier: 0, direction: 'east', who: 'squad' });
    expect(result).toMatchObject({ ok: true, data: { load: true, target: 'A10' } });
    const before = campaign.tactical?.state;
    runTicks(campaign, 2000, () => campaign.tactical?.state !== before);
    expect(campaign.state.worldSector).toEqual(A10);
    expect(campaign.state.movement.tacticalTraversal.active).toBe(false);
    expect(campaign.state.movement.undergroundTacticalTraversal).toBe(true);
  });

  it('takes a gassed merc into A10 still gassed, until the first real-time turn there finds him off gas (SOLDIER_GASSED)', () => {
    const { campaign } = createTestCampaign(kit, { seed: 7, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    walkSquadToEastEdge(campaign);
    const id = ourSoldiers(campaign)[0]?.id ?? 0;
    const merc = () => ourSoldiers(campaign).find((s) => s.id === id);
    const gassed = merc();
    if (!gassed) throw new Error('no merc');
    gassed.gassed = true;
    expect(campaign.dispatch({ type: 'exitSector', soldier: id, direction: 'east', who: 'squad' }).ok).toBe(true);
    runTicks(campaign, 2000, () => campaign.state.worldSector?.x === 10);
    expect(campaign.state.worldSector).toEqual(A10);
    expect(merc()?.gassed).toBe(true);
    const lastTurn = () => campaign.state.sectorFlow.realtimeClock.lastTurnMs;
    const loadedTurn = lastTurn();
    runTicks(campaign, 2000, () => lastTurn() !== loadedTurn);
    expect(lastTurn()).not.toBe(loadedTurn);
    expect(merc()?.gassed).toBe(false);
  });

  it('keeps the dropped items, corpses and revealed tiles of A9 and ages the corpses by the days away', () => {
    const { campaign } = createTestCampaign(kit, { seed: 8, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    runUntilIdle(campaign);
    const merc = ourSoldiers(campaign)[0];
    if (!merc) throw new Error('no merc');
    expect(campaign.dispatch({ type: 'drop', soldier: merc.id, slot: InvSlot.HAND })).toEqual({ ok: true });
    runUntilIdle(campaign);
    const t = campaign.tactical?.state;
    if (!t) throw new Error('no sector');
    const dropped = t.worldItems.map((wi) => [wi.gridNo, wi.object.item]);
    t.corpses.push(
      {
        gridNo: merc.gridNo + 3,
        level: 0,
        heightAdjustment: 0,
        bodyType: 0,
        direction: 0,
        state: 0,
        profile: 200,
        type: 1,
        timeOfDeath: 0,
        headTaken: false,
        servicingCrows: 0,
      },
      {
        gridNo: merc.gridNo + 5,
        level: 0,
        heightAdjustment: 0,
        bodyType: 0,
        direction: 0,
        state: 0,
        profile: 200,
        type: 1,
        timeOfDeath: 0,
        headTaken: false,
        servicingCrows: 0,
      },
    );
    const revealed = Uint8Array.from(t.fog.revealed);
    walkSquadToEastEdge(campaign);
    campaign.dispatch({ type: 'exitSector', soldier: merc.id, direction: 'east', who: 'squad' });
    runTicks(campaign, 2000, () => campaign.state.worldSector?.x === 10);
    const diff = campaign.state.sectorDiffs.get(sectorKey(A9));
    if (!diff?.corpses) throw new Error('no corpses saved');
    const now = Math.trunc(campaign.state.clock.seconds / 60);
    diff.corpses = [
      { ...(diff.corpses[0] as (typeof diff.corpses)[number]), timeOfDeath: now - 1500 },
      { ...(diff.corpses[1] as (typeof diff.corpses)[number]), timeOfDeath: now - 5000 },
    ];
    runUntilIdle(campaign);
    walkWest(campaign);
    expect(campaign.dispatch({ type: 'exitSector', soldier: merc.id, direction: 'west', who: 'squad' }).ok).toBe(true);
    runTicks(campaign, 2000, () => campaign.state.worldSector?.x === 9);
    const back = campaign.tactical?.state;
    if (!back) throw new Error('no sector');
    expect(back.worldItems.map((wi) => [wi.gridNo, wi.object.item])).toEqual(dropped);
    expect(back.corpses.map((c) => c.type)).toEqual([ROTTING_STAGE2]);
    for (let g = 0; g < revealed.length; g++) if (revealed[g]) expect(back.fog.revealed[g]).toBeTruthy();
  });

  it('keeps the crow count drawn at the sector entry (StrategicMap.cc SetCurrentWorldSector)', () => {
    const { campaign } = createTestCampaign(kit, { seed: 8, garrison: NO_GARRISON });
    expect(campaign.state.sectorFlow.crows).toEqual({ possible: 0, dontAddNew: false });
    landFirstSquad(campaign);
    const { possible, dontAddNew } = campaign.state.sectorFlow.crows;
    expect([possible >= MIN_CROWS_POSSIBLE && possible <= MAX_CROWS_POSSIBLE, dontAddNew]).toEqual([true, false]);
    expect(campaign.tactical?.state.crows).toBe(campaign.state.sectorFlow.crows);
  });

  it('keeps the first creature tension delay of 10 + Random(20) s drawn at the sector entry (StrategicMap.cc SetCurrentWorldSector)', () => {
    const { campaign } = createTestCampaign(kit, { seed: 8, garrison: NO_GARRISON });
    expect(campaign.state.sectorFlow.realtimeClock.creatureTenseQuoteDelaySeconds).toBe(0);
    landFirstSquad(campaign);
    const delay = campaign.state.sectorFlow.realtimeClock.creatureTenseQuoteDelaySeconds;
    expect(delay >= FIRST_TENSE_QUOTE_DELAY_MIN && delay <= FIRST_TENSE_QUOTE_DELAY_MAX).toBe(true);
    expect(campaign.tactical?.state.realtimeClock).toBe(campaign.state.sectorFlow.realtimeClock);
  });

  it('lands two crows on a rotting corpse of A9 by day as its corpses load (Tactical_Save.cc LoadRottingCorpsesFromTempCorpseFile)', () => {
    const { campaign } = createTestCampaign(kit, { seed: 8, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    const merc = ourSoldiers(campaign)[0];
    if (!merc) throw new Error('no merc');
    const corpseAt = merc.gridNo + 3;
    campaign.tactical?.state.corpses.push({ ...lyingCorpse(corpseAt), type: ROTTING_STAGE2 });
    walkSquadToEastEdge(campaign);
    campaign.dispatch({ type: 'exitSector', soldier: merc.id, direction: 'east', who: 'squad' });
    runTicks(campaign, 2000, () => campaign.state.worldSector?.x === 10);
    expect(worldHour(campaign.state.clock)).toBeGreaterThanOrEqual(NIGHT_ENDS_HOUR);
    runUntilIdle(campaign);
    walkWest(campaign);
    expect(campaign.dispatch({ type: 'exitSector', soldier: merc.id, direction: 'west', who: 'squad' }).ok).toBe(true);
    runTicks(campaign, 2000, () => campaign.state.worldSector?.x === 9);
    const back = campaign.tactical?.state;
    if (!back) throw new Error('no sector');
    const crows = teamMembers(back, Team.CIV).filter((s) => s.bodyType === Body.CROW);
    expect(crows.map((s) => s.id)).toEqual([TEAM_FIRST_ID[Team.CIV], (TEAM_FIRST_ID[Team.CIV] ?? 0) + 1]);
    for (const crow of crows) expect(Math.max(...spacesApart(crow.gridNo, corpseAt))).toBeLessThanOrEqual(CROW_LANDING_RADIUS);
  });

  it('saves a corpse with the crows feeding on it as the squad leaves, so it counts them on return with none of them there (SaveCurrentSectorsInformationToTempItemFile before TrashWorld)', () => {
    const { campaign } = createTestCampaign(kit, { seed: 8, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    const merc = ourSoldiers(campaign)[0];
    if (!merc) throw new Error('no merc');
    const corpseAt = merc.gridNo + 3;
    campaign.tactical?.state.corpses.push({ ...lyingCorpse(corpseAt), type: ROTTING_STAGE2 });
    walkSquadToEastEdge(campaign);
    const leaving = campaign.tactical?.state;
    if (!leaving) throw new Error('no sector');
    const feeding = teamMembers(leaving, Team.CIV).filter((s) => s.bodyType === Body.CROW && s.pendingActionData2 === corpseAt).length;
    expect(feeding).toBeGreaterThan(0);
    expect(leaving.corpses.map((c) => c.servicingCrows)).toEqual([feeding]);
    campaign.dispatch({ type: 'exitSector', soldier: merc.id, direction: 'east', who: 'squad' });
    runTicks(campaign, 2000, () => campaign.state.worldSector?.x === 10);
    expect(campaign.state.sectorDiffs.get(sectorKey(A9))?.corpses?.map((c) => c.servicingCrows)).toEqual([feeding]);
    runUntilIdle(campaign);
    walkWest(campaign);
    expect(campaign.dispatch({ type: 'exitSector', soldier: merc.id, direction: 'west', who: 'squad' }).ok).toBe(true);
    runTicks(campaign, 2000, () => campaign.state.worldSector?.x === 9);
    const back = campaign.tactical?.state;
    if (!back) throw new Error('no sector');
    const arrived = teamMembers(back, Team.CIV).filter((s) => s.bodyType === Body.CROW);
    expect(arrived.every((s) => s.pendingActionData1 === 0 && s.pendingActionData2 === corpseAt)).toBe(true);
    expect(back.corpses.map((c) => c.servicingCrows)).toEqual([feeding + arrived.length]);
  });

  it('keeps the blood and smell of A9 and draws its pools again at once (SaveLoadMap.cc SLM_BLOOD_SMELL)', () => {
    const { campaign } = createTestCampaign(kit, { seed: 8, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    const merc = ourSoldiers(campaign)[0];
    if (!merc) throw new Error('no merc');
    const t = campaign.tactical?.state;
    if (!t) throw new Error('no sector');
    const pool = merc.gridNo + POOL_ROWS_SOUTH * 160;
    const trail = pool + 1;
    internalDropBlood(t, pool, 0, BloodKind.HUMAN, MAX_BLOOD_QUANTITY, UNSEEN);
    dropSmell(t.smell, { level: 0, gridNo: trail, normalSmell: STRONG_SMELL, monsterSmell: 0 });
    expect(bloodViews(t).some((p) => p.gridNo === pool)).toBe(false);
    walkSquadToEastEdge(campaign);
    campaign.dispatch({ type: 'exitSector', soldier: merc.id, direction: 'east', who: 'squad' });
    runTicks(campaign, 2000, () => campaign.state.worldSector?.x === 10);
    expect(campaign.state.sectorDiffs.get(sectorKey(A9))?.bloodSmell?.map((r) => r.gridNo)).toEqual([pool, trail]);
    runUntilIdle(campaign);
    walkWest(campaign);
    expect(campaign.dispatch({ type: 'exitSector', soldier: merc.id, direction: 'west', who: 'squad' }).ok).toBe(true);
    runTicks(campaign, 2000, () => campaign.state.worldSector?.x === 9);
    const back = campaign.tactical?.state;
    if (!back) throw new Error('no sector');
    expect(bloodFloorStrength(back.smell.blood[pool] ?? 0)).toBeGreaterThan(0);
    expect(bloodViews(back).find((p) => p.gridNo === pool)?.strength ?? 0).toBeGreaterThan(0);
    expect(smellStrength(back.smell.smell[trail] ?? 0)).toBeGreaterThan(0);
  });
});

describe('a native save loaded into its sector', () => {
  it('sends crows to a rotting corpse by day once more, as loading the corpses file does (Tactical_Save.cc LoadRottingCorpsesFromTempCorpseFile from SaveLoadGame.cc LoadSavedGame)', () => {
    const { campaign } = createTestCampaign(kit, { seed: 8, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    warpMinutes(campaign, ((NOON_HOUR - worldHour(campaign.state.clock) + HOURS_PER_DAY) % HOURS_PER_DAY) * 60);
    const t = campaign.tactical?.state;
    const merc = ourSoldiers(campaign)[0];
    if (!t || !merc) throw new Error('no sector');
    const corpseAt = merc.gridNo + 3;
    addRottingCorpse(t, { ...lyingCorpse(corpseAt), type: ROTTING_STAGE2 }, { nowMinute: 0, loadingSave: true });
    flowOf(campaign).adoptLoadedSector([]);
    const crows = teamMembers(t, Team.CIV).filter((s) => s.bodyType === Body.CROW);
    expect(crows.map((s) => s.pendingActionData2)).toEqual([corpseAt, corpseAt]);
    expect(t.corpses.map((c) => c.servicingCrows)).toEqual([2]);
  });

  it('keeps a helicopter piece destroyed before the save off the map: the helicopter stands before the saved map changes apply (StrategicMap.cc:520 from SaveLoadGame.cc:743, the map changes at :1016)', () => {
    const { campaign } = createTestCampaign(kit, { seed: 9, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    const flow = flowOf(campaign);
    Object.assign(sectorInfo(campaign.state.map, B13), NO_GARRISON_COUNTS);
    for (const m of flow.setup.roster.all()) m.sector = { ...B13 };
    expect(flow.setCurrentWorldSector(B13)).toBe(true);
    const sim = campaign.tactical;
    if (!sim) throw new Error('no sector');
    const helicopterType = typeIndex(sim.world.tables, 'FIRSTOSTRUCT');
    setHelicopterOnMap(sim.state, { gridNo: DRASSEN_HELIPAD, heliTileType: helicopterType }, false);
    const destroyedTailBoom = {
      type: MapModificationType.REMOVE_STRUCT,
      gridNo: TAIL_BOOM_GRIDNO,
      imageType: helicopterType,
      subImageIndex: TAIL_BOOM_SUB_INDEX,
      extra: 0,
    };
    flow.adoptLoadedSector([], { ...NO_SAVED_SECTOR_CHANGES, mapModifications: [destroyedTailBoom] });
    const t = sim.state;
    const vehicles = (g: number) => t.world.structures.at(g).filter((x) => (x.flags & StructureFlags.VEHICLE) !== 0).length;
    expect([vehicles(DRASSEN_HELIPAD), vehicles(TAIL_BOOM_GRIDNO)]).toEqual([1, 0]);
    expect(tileChangeViews(t).filter((c) => c.kind === 'append' && c.gridNo === TAIL_BOOM_GRIDNO)).toHaveLength(1);
    expect(t.mapChanges.map((c) => [c.kind, c.gridNo])).toEqual([[MapChangeKind.REMOVE_STRUCT_TILE, TAIL_BOOM_GRIDNO]]);
  });

  it('tells whether the loaded sector wrote a record of its map modifications file back: a window hit does when it finds its window (SaveLoadMap.cc:217)', () => {
    const keptAfterAdopting = (hitAt: number): boolean => {
      const { campaign } = createTestCampaign(kit, { seed: 11, garrison: NO_GARRISON });
      landFirstSquad(campaign);
      const flow = flowOf(campaign);
      Object.assign(sectorInfo(campaign.state.map, B13), NO_GARRISON_COUNTS);
      for (const m of flow.setup.roster.all()) m.sector = { ...B13 };
      expect(flow.setCurrentWorldSector(B13)).toBe(true);
      const hit = { type: MapModificationType.WINDOW_HIT, gridNo: hitAt, imageType: 0, subImageIndex: 0, extra: 0 };
      return flow.adoptLoadedSector([], { ...NO_SAVED_SECTOR_CHANGES, mapModifications: [hit] });
    };
    expect([keptAfterAdopting(AIRFIELD_WINDOW), keptAfterAdopting(AIRFIELD_WINDOW + 1)]).toEqual([true, false]);
  });

  it("takes the door off the tile of a native save's door removal, whichever door graphic it names (SaveLoadMap.cc:156)", () => {
    const { campaign } = createTestCampaign(kit, { seed: 11, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    const flow = flowOf(campaign);
    Object.assign(sectorInfo(campaign.state.map, B13), NO_GARRISON_COUNTS);
    for (const m of flow.setup.roster.all()) m.sector = { ...B13 };
    expect(flow.setCurrentWorldSector(B13)).toBe(true);
    const sim = campaign.tactical;
    if (!sim) throw new Error('no sector');
    const t = sim.state;
    const tables = sim.world.tables;
    const [closedDoor = -1] = structLayerAt(t, HANGAR_DOOR);
    const doorType = tileTypeOf(tables, closedDoor);
    const openGraphic = closedDoor + 1;
    const removedOpenDoor = {
      type: MapModificationType.REMOVE_STRUCT,
      gridNo: HANGAR_DOOR,
      imageType: doorType,
      subImageIndex: openGraphic - (tables.types[doorType]?.start ?? 0) + 1,
      extra: 0,
    };
    flow.adoptLoadedSector([], { ...NO_SAVED_SECTOR_CHANGES, mapModifications: [removedOpenDoor] });
    const doors = t.world.structures.at(HANGAR_DOOR).filter((s) => has(s.flags, StructureFlags.ANYDOOR));
    expect([doors, structLayerAt(t, HANGAR_DOOR)]).toEqual([[], []]);
    expect(tileChangeViews(t).filter((c) => c.gridNo === HANGAR_DOOR)).toEqual([
      { kind: 'remove', gridNo: HANGAR_DOOR, level: GROUND_LEVEL, tile: closedDoor },
    ]);
  });

  it('bumps nobody when a native import stands the helicopter: the saved soldiers enter the map only after it and the map changes (UpdateMercsInSector, SaveLoadGame.cc:1036)', () => {
    const { campaign } = createTestCampaign(kit, { seed: 11, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    const flow = flowOf(campaign);
    Object.assign(sectorInfo(campaign.state.map, B13), NO_GARRISON_COUNTS);
    for (const m of flow.setup.roster.all()) m.sector = { ...B13 };
    expect(flow.setCurrentWorldSector(B13)).toBe(true);
    const sim = campaign.tactical;
    const merc = ourSoldiers(campaign)[0];
    if (!sim || !merc) throw new Error('no sector');
    const t = sim.state;
    setHelicopterOnMap(t, { gridNo: DRASSEN_HELIPAD, heliTileType: typeIndex(sim.world.tables, 'FIRSTOSTRUCT') }, false);
    setSoldierPosition(t, merc, BESIDE_HELIPAD);
    flow.adoptLoadedSector([]);
    expect(t.landedHelicopter?.gridNo).toBe(DRASSEN_HELIPAD);
    expect(merc.gridNo).toBe(BESIDE_HELIPAD);
    expect(whoIsThere(t, BESIDE_HELIPAD, 0)).toBe(merc);
    expect(t.world.structures.at(BESIDE_HELIPAD).some((x) => x === merc.structure)).toBe(true);
  });

  it('gives a door of a native import the structure the player perceives while the map draws the real one: the load updates the doors once (Keys.cc:1206), the import runs no second update', () => {
    const { campaign } = createTestCampaign(kit, { seed: 9, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    const flow = flowOf(campaign);
    Object.assign(sectorInfo(campaign.state.map, B13), NO_GARRISON_COUNTS);
    for (const m of flow.setup.roster.all()) m.sector = { ...B13 };
    expect(flow.setCurrentWorldSector(B13)).toBe(true);
    const sim = campaign.tactical;
    if (!sim) throw new Error('no sector');
    expect(isDoorOpenAt(sim.state, AIRFIELD_DOOR)).toBe(false);
    flow.adoptLoadedSector([], { ...NO_SAVED_SECTOR_CHANGES, doorStatus: [{ gridNo: AIRFIELD_DOOR, flags: DOOR_PERCEIVED_OPEN }] });
    const t = sim.state;
    expect([isDoorOpenAt(t, AIRFIELD_DOOR), t.doorStatus.get(AIRFIELD_DOOR)?.open, sim.openDoors()]).toEqual([
      true,
      false,
      [AIRFIELD_DOOR],
    ]);
  });

  it('gives the door back the structure of its real state at the end of a sector entry, still shown as the player perceives it (StrategicMap.cc:514)', () => {
    const { campaign } = createTestCampaign(kit, { seed: 9, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    const flow = flowOf(campaign);
    Object.assign(sectorInfo(campaign.state.map, B13), NO_GARRISON_COUNTS);
    for (const m of flow.setup.roster.all()) m.sector = { ...B13 };
    expect(flow.setCurrentWorldSector(B13)).toBe(true);
    const left = campaign.tactical?.state;
    if (!left) throw new Error('no sector');
    left.doorStatus.set(AIRFIELD_DOOR, {
      open: false,
      perceivedOpen: true,
      perceivedNotSet: false,
      busy: false,
      shownOpen: true,
      hasTinCan: false,
    });
    for (const m of flow.setup.roster.all()) m.sector = { ...A9 };
    expect(flow.setCurrentWorldSector(A9)).toBe(true);
    for (const m of flow.setup.roster.all()) m.sector = { ...B13 };
    expect(flow.setCurrentWorldSector(B13)).toBe(true);
    const sim = campaign.tactical;
    if (!sim) throw new Error('no sector');
    const t = sim.state;
    expect([isDoorOpenAt(t, AIRFIELD_DOOR), t.doorStatus.get(AIRFIELD_DOOR)?.open, sim.openDoors()]).toEqual([
      false,
      false,
      [AIRFIELD_DOOR],
    ]);
  });

  it('brings a helicopter piece destroyed in the sector back at the next entry, unlike a load: the entry stands the helicopter again after the map changes took the piece away (StrategicMap.cc:520 after EnterSector, :880)', () => {
    const { campaign } = createTestCampaign(kit, { seed: 10, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    const flow = flowOf(campaign);
    Object.assign(sectorInfo(campaign.state.map, B13), NO_GARRISON_COUNTS);
    for (const m of flow.setup.roster.all()) m.sector = { ...B13 };
    expect(flow.setCurrentWorldSector(B13)).toBe(true);
    const vehiclesAt = (g: number) =>
      campaign.tactical?.state.world.structures.at(g).filter((x) => has(x.flags, StructureFlags.VEHICLE)).length;
    const left = campaign.tactical?.state;
    const tailBoom = left?.world.structures.at(TAIL_BOOM_GRIDNO).find((x) => has(x.flags, StructureFlags.VEHICLE));
    if (!left || !tailBoom) throw new Error('no helicopter');
    recordStructureRemoved(left, tailBoom);
    left.world.structures.remove(tailBoom);
    for (const m of flow.setup.roster.all()) m.sector = { ...A9 };
    expect(flow.setCurrentWorldSector(A9)).toBe(true);
    for (const m of flow.setup.roster.all()) m.sector = { ...B13 };
    expect(flow.setCurrentWorldSector(B13)).toBe(true);
    expect(vehiclesAt(TAIL_BOOM_GRIDNO)).toBe(1);
    const t = campaign.tactical?.state;
    if (!t) throw new Error('no sector');
    expect(t.mapChanges.map((c) => [c.kind, c.gridNo])).toEqual([[MapChangeKind.REMOVE, TAIL_BOOM_GRIDNO]]);
    expect(tileChangeViews(t).filter((c) => c.kind === 'append' && c.gridNo === TAIL_BOOM_GRIDNO)).toHaveLength(2);
  });

  it('forgets at a sector entry every mine flag but the blue flags: enemies walk into their own map mines (SetBlueFlagFlags)', () => {
    const { campaign } = createTestCampaign(kit, { seed: 10, garrison: NO_GARRISON });
    const left = enterAirfieldAtNight(campaign);
    addBlueFlag(left, HANGAR_FLOOR - 2, GROUND_LEVEL);
    setMineFlag(left, HANGAR_FLOOR - 4, MineFlag.PLAYER);
    setMineFlag(left, HANGAR_FLOOR - 6, MineFlag.ENEMY);
    const t = reenterAirfield(campaign);
    expect(knownMineTiles(t)).toEqual([HANGAR_FLOOR - 2]);
    expect(t.mineFlags.some((flags) => flags & MineFlag.ENEMY)).toBe(false);
  });

  it('finds the panic triggers again at each entry, among the items the sector kept, and starts without a chosen one (StrategicMap.cc InitAI after EnterSector)', () => {
    const { campaign } = createTestCampaign(kit, { seed: 10, garrison: NO_GARRISON });
    const left = enterAirfieldAtNight(campaign);
    expect(left.panic.flags).toBe(0);
    const panicSwitch = createItem(left.content.items, itemId(left, 'SWITCH'), 100);
    setFrequency(panicSwitch, PANIC_FREQUENCY);
    addItemToPool(left, HANGAR_FLOOR, panicSwitch, Visibility.BURIED, GROUND_LEVEL, WorldItemFlags.ARMED_BOMB);
    const t = reenterAirfield(campaign);
    expect([t.panic.flags, t.panic.triggers[0]?.gridNo, t.panic.chosenOne]).toEqual([PanicFlags.TRIGGERS_HERE, HANGAR_FLOOR, null]);
  });

  it('refuses time compression while a timed bomb ticks and takes it off the map when the sector unloads (ActiveTimedBombExists, RemoveAllActiveTimedBombs)', () => {
    const { campaign } = createTestCampaign(kit, { seed: 10, garrison: NO_GARRISON });
    const left = enterAirfieldAtNight(campaign);
    const bomb = createItem(left.content.items, itemId(left, 'C4'), 100);
    setDetonator(bomb, Detonator.TIMED);
    setDelay(bomb, 3);
    addItemToPool(left, HANGAR_FLOOR, bomb, Visibility.VISIBLE, GROUND_LEVEL, WorldItemFlags.ARMED_BOMB);
    expect(campaign.compressionRefusalToken()).toBe('activeTimedBomb');
    const t = reenterAirfield(campaign);
    expect(t.worldItems.filter((i) => i.object.item === itemId(t, 'C4'))).toEqual([]);
    expect(campaign.compressionRefusalToken()).toBeNull();
  });

  it('keeps a door blown up open off the map, its closed graphic too, at the next entry that loads it closed: the removal of a door type takes any door off its tile (SaveLoadMap.cc:156)', () => {
    const { campaign } = createTestCampaign(kit, { seed: 10, garrison: NO_GARRISON });
    const left = enterAirfieldAtNight(campaign);
    const [closedDoor] = structLayerAt(left, HANGAR_DOOR);
    expect(handleDoorChangeFromGridNo(left, null, HANGAR_DOOR, { noAnimation: true })).toBe(true);
    expect(isDoorOpenAt(left, HANGAR_DOOR)).toBe(true);
    igniteExplosion(left, null, 0, HANGAR_DOOR, itemId(left, 'TNT'), 0);
    runExplosivesUntilIdle(campaign.tactical ?? never());
    const doorsAt = (t: TacticalState) => t.world.structures.at(HANGAR_DOOR).filter((s) => has(s.flags, StructureFlags.ANYDOOR));
    const removedDoorTile = [{ kind: 'remove', gridNo: HANGAR_DOOR, level: GROUND_LEVEL, tile: closedDoor }];
    const doorTileChanges = (t: TacticalState) => tileChangeViews(t).filter((c) => c.gridNo === HANGAR_DOOR);
    expect([doorsAt(left), structLayerAt(left, HANGAR_DOOR), doorTileChanges(left)]).toEqual([[], [], removedDoorTile]);
    const t = reenterAirfield(campaign);
    expect([doorsAt(t), structLayerAt(t, HANGAR_DOOR), doorTileChanges(t)]).toEqual([[], [], removedDoorTile]);
  });

  it('keeps the debris for the next entry but not a change made outside ApplyMapChangesToMapTempFile, as the wall decals an explosion takes off (Explosion_Control.cc:498)', () => {
    const { campaign } = createTestCampaign(kit, { seed: 10, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    const flow = flowOf(campaign);
    Object.assign(sectorInfo(campaign.state.map, B13), NO_GARRISON_COUNTS);
    for (const m of flow.setup.roster.all()) m.sector = { ...B13 };
    expect(flow.setCurrentWorldSector(B13)).toBe(true);
    const sim = campaign.tactical;
    if (!sim) throw new Error('no sector');
    const left = sim.state;
    const g = Array.from({ length: 25600 }, (_, k) => k).find((k) => structLayerAt(left, k).length > 0) ?? -1;
    const tile = structLayerAt(left, g)[0] ?? -1;
    const debris = tileIndex(sim.world.tables, 'FIRSTEXPLDEBRIS1');
    expect(removeStructTile(left, g, tile, true)).toBe(true);
    addObjectToHead(left, g, debris);
    for (const m of flow.setup.roster.all()) m.sector = { ...A9 };
    expect(flow.setCurrentWorldSector(A9)).toBe(true);
    for (const m of flow.setup.roster.all()) m.sector = { ...B13 };
    expect(flow.setCurrentWorldSector(B13)).toBe(true);
    const back = campaign.tactical?.state;
    if (!back) throw new Error('no sector');
    expect(structLayerAt(back, g)).toContain(tile);
    expect(objectLayerAt(back, g)[0]).toBe(debris);
  });
});

describe("the other sectors' temp files of a native save", () => {
  function nativeRecordsFor(campaign: ReturnType<typeof createTestCampaign>['campaign'], flag: number) {
    landFirstSquad(campaign);
    Object.assign(sectorInfo(campaign.state.map, B13), NO_GARRISON_COUNTS);
    setSectorFlag(campaign.state.map, B13, flag, worldDay(campaign.state.clock));
    return sectorDiffOf(campaign.state, B13);
  }

  function enterAirfield(campaign: ReturnType<typeof createTestCampaign>['campaign']): TacticalState {
    const flow = flowOf(campaign);
    for (const m of flow.setup.roster.all()) m.sector = { ...B13 };
    expect(flow.setCurrentWorldSector(B13)).toBe(true);
    const t = campaign.tactical?.state;
    if (!t) throw new Error('no sector');
    return t;
  }

  function hangarDoorRemoval(campaign: ReturnType<typeof createTestCampaign>['campaign']) {
    const world = kit.sectors.world('stubs/world/maps/airfield.dat');
    const [closedDoor = -1] = levelTilesAt(world.level.layers.structs, HANGAR_DOOR);
    const doorType = tileTypeOf(world.tables, closedDoor);
    const record = {
      type: MapModificationType.REMOVE_STRUCT,
      gridNo: HANGAR_DOOR,
      imageType: doorType,
      subImageIndex: closedDoor - (world.tables.types[doorType]?.start ?? 0) + 1,
      extra: 0,
    };
    expect(campaign.state.worldSector).not.toEqual(B13);
    return { closedDoor, record };
  }

  it('replays the map changes a native save left for a sector at its first entry before the changes made since, which come after them in the file (Tactical_Save.cc:458, SaveLoadMap.cc:67)', () => {
    const { campaign } = createTestCampaign(kit, { seed: 10, garrison: NO_GARRISON });
    const diff = nativeRecordsFor(campaign, SectorFlag.MAP_MODIFICATIONS_TEMP_FILE_EXISTS);
    const { closedDoor, record } = hangarDoorRemoval(campaign);
    diff.savedMapModifications = [record];
    addStructToUnloadedSector(campaign.state, HANGAR_DOOR, closedDoor, B13);
    reloadPoint(campaign);
    const t = enterAirfield(campaign);
    expect(structLayerAt(t, HANGAR_DOOR)).toEqual([closedDoor]);
    expect(getSectorFlagStatus(campaign.state.map, B13, SectorFlag.MAP_MODIFICATIONS_TEMP_FILE_EXISTS)).toBe(true);
    const doorsAt = (s: TacticalState) => s.world.structures.at(HANGAR_DOOR).filter((x) => has(x.flags, StructureFlags.ANYDOOR)).length;
    expect(doorsAt(t)).toBe(1);
    const back = reenterAirfield(campaign);
    expect(campaign.state.sectorDiffs.get(sectorKey(B13))?.savedMapModifications).toBeUndefined();
    expect([structLayerAt(back, HANGAR_DOOR), doorsAt(back)]).toEqual([[closedDoor], 1]);
  });

  it('keeps the map modifications flag of that entry only when a record is written back, as the loaded sector of a load does (SaveLoadMap.cc:236)', () => {
    const flagAfterEntry = (written: 'none' | 'native' | 'since') => {
      const { campaign } = createTestCampaign(kit, { seed: 10, garrison: NO_GARRISON });
      const diff = nativeRecordsFor(campaign, SectorFlag.MAP_MODIFICATIONS_TEMP_FILE_EXISTS);
      const { closedDoor, record } = hangarDoorRemoval(campaign);
      const blood = { type: MapModificationType.BLOOD_SMELL, gridNo: HANGAR_FLOOR, imageType: 1, subImageIndex: 0, extra: 0 };
      diff.savedMapModifications = written === 'native' ? [blood, record] : [blood];
      if (written === 'since') addStructToUnloadedSector(campaign.state, HANGAR_DOOR, closedDoor, B13);
      const t = enterAirfield(campaign);
      expect(t.smell.blood[HANGAR_FLOOR]).toBe(1);
      return getSectorFlagStatus(campaign.state.map, B13, SectorFlag.MAP_MODIFICATIONS_TEMP_FILE_EXISTS);
    };
    expect([flagAfterEntry('none'), flagAfterEntry('native'), flagAfterEntry('since')]).toEqual([false, true, true]);
  });

  it('reveals the tiles of the revealed file at the first entry, the rest hidden, and keeps them at the next in its own form (Tactical_Save.cc:468)', () => {
    const { campaign } = createTestCampaign(kit, { seed: 10, garrison: NO_GARRISON });
    const diff = nativeRecordsFor(campaign, SectorFlag.REVEALED_STATUS_TEMP_FILE_EXISTS);
    const revealed = new Uint8Array(WORLD_MAX / BITS_PER_BYTE);
    revealed[idiv(HANGAR_FLOOR, BITS_PER_BYTE)] = 1 << (HANGAR_FLOOR % BITS_PER_BYTE);
    diff.savedRevealed = revealed;
    reloadPoint(campaign);
    const groundRevealed = (s: TacticalState, g: number) => ((s.fog.revealed[g] ?? 0) & RevealedFlags.GROUND) !== 0;
    const t = enterAirfield(campaign);
    expect([groundRevealed(t, HANGAR_FLOOR), groundRevealed(t, HANGAR_FLOOR + 1)]).toEqual([true, false]);
    const back = reenterAirfield(campaign);
    expect(campaign.state.sectorDiffs.get(sectorKey(B13))?.savedRevealed).toBeUndefined();
    expect(groundRevealed(back, HANGAR_FLOOR)).toBe(true);
  });
});

describe('the lights of a sector entry', () => {
  it('draws the lights once the map changes are back: the light passes where a wall was destroyed before the squad left (InitLoadedWorld from Tactical_Save.cc:509)', () => {
    const { campaign } = createTestCampaign(kit, { seed: 10, garrison: NO_GARRISON });
    const left = enterAirfieldAtNight(campaign);
    const shaded = lightTrueLevel(left, HANGAR_FLOOR, GROUND_LEVEL);
    const wall = left.world.structures.at(HANGAR_WALL).find((s) => has(s.flags, StructureFlags.WALL));
    if (!wall) throw new Error('no hangar wall');
    recordStructureRemoved(left, wall);
    left.world.structures.remove(wall);
    const t = reenterAirfield(campaign);
    const entered = lightTrueLevel(t, HANGAR_FLOOR, GROUND_LEVEL);
    expect(entered).toBeLessThan(shaded);
    expect(entered).toBe(redrawnLightLevel(t, HANGAR_FLOOR));
  });

  it('draws the lights once the door status is back: the light passes a door the player saw open before leaving (Tactical_Save.cc:509 after the door status at :486)', () => {
    const { campaign } = createTestCampaign(kit, { seed: 10, garrison: NO_GARRISON });
    const left = enterAirfieldAtNight(campaign);
    const shaded = lightTrueLevel(left, HANGAR_FLOOR, GROUND_LEVEL);
    expect(handleDoorChangeFromGridNo(left, null, HANGAR_DOOR, { noAnimation: true })).toBe(true);
    const status = left.doorStatus.get(HANGAR_DOOR);
    if (!status) throw new Error('no door status');
    perceiveDoor(status, true);
    const t = reenterAirfield(campaign);
    const entered = lightTrueLevel(t, HANGAR_FLOOR, GROUND_LEVEL);
    expect(entered).toBeLessThan(shaded);
    expect(entered).toBe(redrawnLightLevel(t, HANGAR_FLOOR));
  });
});

function enterAirfieldAtNight(campaign: ReturnType<typeof createTestCampaign>['campaign']): TacticalState {
  landFirstSquad(campaign);
  warpMinutes(campaign, ((NIGHT_LIGHTS_HOUR - worldHour(campaign.state.clock) + HOURS_PER_DAY) % HOURS_PER_DAY) * 60);
  const flow = flowOf(campaign);
  Object.assign(sectorInfo(campaign.state.map, B13), NO_GARRISON_COUNTS);
  for (const m of flow.setup.roster.all()) m.sector = { ...B13 };
  expect(flow.setCurrentWorldSector(B13)).toBe(true);
  const t = campaign.tactical?.state;
  if (!t) throw new Error('no sector');
  return t;
}

function reenterAirfield(campaign: ReturnType<typeof createTestCampaign>['campaign']): TacticalState {
  const flow = flowOf(campaign);
  for (const m of flow.setup.roster.all()) m.sector = { ...A9 };
  expect(flow.setCurrentWorldSector(A9)).toBe(true);
  for (const m of flow.setup.roster.all()) m.sector = { ...B13 };
  expect(flow.setCurrentWorldSector(B13)).toBe(true);
  const t = campaign.tactical?.state;
  if (!t) throw new Error('no sector');
  return t;
}

function redrawnLightLevel(t: TacticalState, gridNo: number): number {
  lightSpriteRenderAll(t);
  return lightTrueLevel(t, gridNo, GROUND_LEVEL);
}

function spacesApart(a: number, b: number): [number, number] {
  return [Math.abs((a % 160) - (b % 160)), Math.abs(Math.trunc(a / 160) - Math.trunc(b / 160))];
}

function lyingCorpse(gridNo: number) {
  return {
    gridNo,
    level: 0,
    heightAdjustment: 0,
    bodyType: 0,
    direction: 0,
    state: 0,
    profile: 200,
    type: 1,
    timeOfDeath: 0,
    headTaken: false,
    servicingCrows: 0,
  };
}

function walkWest(campaign: ReturnType<typeof createTestCampaign>['campaign']): void {
  for (const s of ourSoldiers(campaign)) {
    const row = 85 + s.id;
    campaign.dispatch({ type: 'move', soldier: s.id, to: row * 160 + (row - 75), mode: 'run' });
  }
  runUntilIdle(campaign);
}

describe('the exit menu', () => {
  it('refuses mercs far from the edge and offers no load for long traversals', () => {
    const { campaign } = createTestCampaign(kit, { seed: 9, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    expect(campaign.dispatch({ type: 'exitSector', soldier: 0, direction: 'east', who: 'squad' })).toMatchObject({
      ok: false,
      reason: 'no merc of the squad stands at that exit',
      data: { refusal: 'tooFar' },
    });
  });

  it('lets the squad leave over a traversal too long to load, where the dialog sends no load', () => {
    const { campaign } = createTestCampaign(kit, { seed: 12, mercs: 1, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    const t = campaign.tactical?.state;
    const merc = ourSoldiers(campaign)[0];
    if (!t || !merc) throw new Error('no merc');
    const edge = pickGridNoNearestEdge(t, merc, Direction.SOUTH);
    expect(campaign.dispatch({ type: 'move', soldier: merc.id, to: edge, mode: 'run' })).toMatchObject({ ok: true });
    runUntilIdle(campaign);
    const exit = { type: 'exitSector', soldier: merc.id, direction: 'south', who: 'squad' } as const;
    expect(campaign.dispatch({ ...exit, load: true })).toMatchObject({ ok: false, data: { refusal: 'loadDisabled' } });
    const r = campaign.dispatch({ ...exit, load: false });
    expect(r).toMatchObject({ ok: true, data: { who: 'squad', load: false, target: 'B9' } });
    expect(r.ok && Number((r.data as { minutes: number }).minutes)).toBeGreaterThan(QUICK_TRAVERSAL_MINUTES);
  });

  it('lets a lone merc leave without loading while his squad stays', () => {
    const { campaign, roster } = createTestCampaign(kit, { seed: 10, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    const leaver = ourSoldiers(campaign)[0];
    if (!leaver) throw new Error('no merc');
    campaign.dispatch({ type: 'move', soldier: leaver.id, to: 75 * 160 + 150, mode: 'run' });
    runUntilIdle(campaign);
    const r = campaign.dispatch({ type: 'exitSector', soldier: leaver.id, direction: 'east', who: 'merc', load: false });
    expect(r).toMatchObject({ ok: true, data: { who: 'merc', load: false } });
    runTicks(campaign, 1500, () => !roster.get(leaver.id)?.soldier.placed && !campaign.tactical?.state.mercsWaiting);
    runUntilIdle(campaign);
    const merc = roster.get(leaver.id);
    expect(merc?.betweenSectors).toBe(true);
    const group = merc ? getGroup(campaign.strategic ?? never(), merc.groupId) : undefined;
    expect(group?.next).toMatchObject({ x: 10, y: 1 });
    expect(campaign.state.worldSector).toEqual(A9);
    expect(ourSoldiers(campaign)).toHaveLength(3);
    expect(merc?.insertionCode).toBe(InsertionCode.PRIMARY_EDGEINDEX);
  });
});

function never(): never {
  throw new Error('missing strategic layer');
}

function flowOf(campaign: ReturnType<typeof createTestCampaign>['campaign']) {
  const flow = campaign.sectors;
  if (!flow) throw new Error('no sector flow');
  return flow;
}

const AFTER_DEFAULT_SCHEDULE_ENTRY_MINUTES = 120;

function warpMinutes(campaign: ReturnType<typeof createTestCampaign>['campaign'], minutes: number): void {
  warpGameTime(campaign.clockContext, minutes * 60, Warp.NO_PROCESSING);
}

function leaveStrategically(campaign: ReturnType<typeof createTestCampaign>['campaign']): void {
  const flow = flowOf(campaign);
  for (const m of flow.setup.roster.all()) m.betweenSectors = true;
  expect(flow.checkAndHandleUnloadingOfCurrentWorld()).toBe(true);
  expect(campaign.tactical).toBeNull();
}

function returnTo(campaign: ReturnType<typeof createTestCampaign>['campaign'], sector: { x: number; y: number; z: number }): void {
  const flow = flowOf(campaign);
  for (const m of flow.setup.roster.all()) {
    m.betweenSectors = false;
    m.sector = { ...sector };
  }
  expect(campaign.dispatch({ type: 'enterSector', sector: { ...sector } })).toMatchObject({ ok: true });
}

describe('preserved soldiers', () => {
  it('restores the enemies left behind within 300 minutes and re-places them after that or on a count change', () => {
    const { campaign } = createTestCampaign(kit, { seed: 11, garrison: { admins: 0, troops: 3, elites: 0 } });
    landFirstSquad(campaign);
    const t = campaign.tactical?.state;
    if (!t) throw new Error('no sector');
    const enemies = teamMembers(t, Team.ENEMY).sort((a, b) => a.id - b.id);
    expect(enemies).toHaveLength(3);
    const wounded = enemies[0];
    if (!wounded) throw new Error('no enemy');
    wounded.life = 23;
    const starts = new Map(t.initList.filter((n) => n.hasSoldier).map((n) => [n.soldierId, n.basic.startingGridNo]));
    const positions = new Map(enemies.map((s) => [s.id, s.gridNo]));
    leaveStrategically(campaign);
    const diff = campaign.state.sectorDiffs.get(sectorKey(A9));
    expect(diff?.enemies?.records).toHaveLength(3);
    expect(getSectorFlagStatus(campaign.state.map, A9, SectorFlag.ENEMY_PRESERVED_TEMP_FILE_EXISTS)).toBe(true);
    warpMinutes(campaign, 60);
    returnTo(campaign, A9);
    const back = campaign.tactical?.state;
    if (!back) throw new Error('no sector');
    const restored = teamMembers(back, Team.ENEMY);
    expect(restored).toHaveLength(3);
    expect(restored.map((s) => s.life).sort((a, b) => a - b)[0]).toBe(23);
    const allowed = new Set([...positions.values(), ...starts.values()]);
    for (const s of restored) expect(allowed.has(s.insertionGridNo)).toBe(true);
    leaveStrategically(campaign);
    warpMinutes(campaign, 301);
    returnTo(campaign, A9);
    const aged = campaign.tactical?.state;
    if (!aged) throw new Error('no sector');
    expect(teamMembers(aged, Team.ENEMY).every((s) => s.life === s.lifeMax)).toBe(true);
    expect(campaign.state.sectorDiffs.get(sectorKey(A9))?.enemies).toBeNull();
    leaveStrategically(campaign);
    sectorInfo(campaign.state.map, A9).numTroops = 2;
    returnTo(campaign, A9);
    expect(teamMembers(campaign.tactical?.state ?? never(), Team.ENEMY)).toHaveLength(2);
  });

  it('heals the civilians left behind by one point per 15 minutes away (civilian bodies other than the four merc bodies reroll their life)', () => {
    const { campaign } = createTestCampaign(kit, { seed: 12, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    warpMinutes(campaign, AFTER_DEFAULT_SCHEDULE_ENTRY_MINUTES);
    const flow = flowOf(campaign);
    expect(flow.setCurrentWorldSector(A10)).toBe(true);
    const t = campaign.tactical?.state;
    if (!t) throw new Error('no sector');
    const civilians = teamMembers(t, Team.CIV).filter((s) => s.profile === NO_PROFILE);
    expect(civilians).toHaveLength(2);
    const hurt = civilians[0];
    if (!hurt) throw new Error('no civilian');
    hurt.bodyType = Body.REGMALE;
    hurt.life = hurt.lifeMax - 20;
    leaveStrategically(campaign);
    warpMinutes(campaign, 150);
    returnTo(campaign, A10);
    const back = campaign.tactical?.state;
    if (!back) throw new Error('no sector');
    const lives = teamMembers(back, Team.CIV)
      .filter((s) => s.profile === NO_PROFILE)
      .map((s) => s.lifeMax - s.life);
    expect(lives.sort((a, b) => b - a)[0]).toBe(10);
  });
});

describe('militia and reinforcements', () => {
  it('places the sector militia on the enemy placements with militia classes', () => {
    const { campaign } = createTestCampaign(kit, { seed: 13, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    const a10 = sectorInfo(campaign.state.map, A10);
    a10.numAdmins = 0;
    a10.numTroops = 0;
    a10.numElites = 0;
    a10.militia = [2, 1, 1];
    expect(flowOf(campaign).setCurrentWorldSector(A10)).toBe(true);
    const militia = teamMembers(campaign.tactical?.state ?? never(), Team.MILITIA);
    expect(militia).toHaveLength(3);
    const wanted = [SoldierClass.GREEN_MILITIA, SoldierClass.GREEN_MILITIA, SoldierClass.REG_MILITIA, SoldierClass.ELITE_MILITIA];
    for (const s of militia) {
      const k = wanted.indexOf(s.soldierClass as (typeof wanted)[number]);
      expect(k).toBeGreaterThanOrEqual(0);
      wanted.splice(k, 1);
    }
    expect(militia.every((s) => s.visible === 1)).toBe(true);
  });

  it('keeps militia the player attacked on our side and in the sector: Stracciatella turns no militia and the unload asks the militia team, so nobody defects', () => {
    const { campaign } = createTestCampaign(kit, { seed: 16, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    const a10 = sectorInfo(campaign.state.map, A10);
    Object.assign(a10, NO_GARRISON_COUNTS);
    a10.militia = [6, 0, 0];
    const flow = flowOf(campaign);
    expect(flow.setCurrentWorldSector(A10)).toBe(true);
    const t = campaign.tactical?.state ?? never();
    militiaChangesSides(t);
    expect(teamMembers(t, Team.MILITIA).every((s) => s.side === Side.FRIENDLY)).toBe(true);
    flow.handleDefiniteUnloadingOfWorld(UnloadCode.ABOUT_TO_TRASH_WORLD);
    expect(sectorInfo(campaign.state.map, A10).militia).toEqual([6, 0, 0]);
    expect(campaign.economy?.events.some((e) => e.type === 'militiaDefected')).toBe(false);
  });

  it('puts ambushed mercs in the centre and calls every computer team to it', () => {
    const { campaign } = createTestCampaign(kit, { seed: 15, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    const a10 = sectorInfo(campaign.state.map, A10);
    a10.numAdmins = 0;
    a10.numTroops = 2;
    a10.numElites = 0;
    a10.militia = [1, 0, 0];
    campaign.state.encounter.code = EncounterCode.ENEMY_AMBUSH;
    const flow = flowOf(campaign);
    for (const m of flow.setup.roster.all()) m.sector = { ...A10 };
    expect(flow.setCurrentWorldSector(A10, { battleLocatorShown: true })).toBe(true);
    const t = campaign.tactical?.state ?? never();
    const center = t.world.map?.info.centerGridNo ?? never();
    for (const merc of ourSoldiers(campaign)) expect(Math.abs((merc.gridNo % 160) - (center % 160))).toBeLessThan(8);
    for (const team of [Team.ENEMY, Team.MILITIA]) {
      expect(t.perception.publicNoiseGridNo[team]).toBe(center);
      expect(t.perception.publicNoiseVolume[team]).toBe(12);
      expect(teamMembers(t, team).every((s) => s.ai.newSituation !== Situation.NOT_NEW)).toBe(true);
    }
    expect(t.perception.publicNoiseGridNo[Team.CIV]).not.toBe(center);
  });

  it('brings pending enemies of an arriving group in through the edgepoints at the next turn end', () => {
    const { campaign } = createTestCampaign(kit, { seed: 14, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    const ctx = campaign.strategic ?? never();
    const t = campaign.tactical?.state ?? never();
    const g = createNewEnemyGroupDepartingFromSector(ctx, sectorId({ x: 10, y: 1 }), 0, 2, 1);
    g.sector = { ...A9 };
    g.prev = { ...A10 };
    campaign.state.encounter.pendingEnemies = true;
    t.sectorHooks.addPendingEnemies(t);
    const arrived = teamMembers(t, Team.ENEMY);
    expect(arrived).toHaveLength(3);
    expect(arrived.every((s) => s.groupId === g.id)).toBe(true);
    const east = new Set(t.edgepoints?.primary[1]?.gridNos ?? []);
    expect(arrived.filter((s) => east.has(s.insertionGridNo))).toHaveLength(3);
    expect(campaign.state.encounter.pendingEnemies).toBe(false);
  });
});

describe('structure damage in a SAM sector', () => {
  function atFirstSamSite() {
    const { campaign, roster } = createTestCampaign(kit, { seed: 5, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    const flow = flowOf(campaign);
    const { content, state } = flow.ctx;
    const sam = content.samSites[0] ?? never();
    const site = sectorFromId(sam.sector);
    const info = sectorInfo(state.map, site);
    Object.assign(info, NO_GARRISON_COUNTS);
    for (const m of roster.all()) m.sector = { ...site };
    for (const g of campaign.state.forces.groups) if (g.player) g.sector = { ...site };
    expect(flow.setCurrentWorldSector(site)).toBe(true);
    const element = (s: Sector) => state.map.elements[strategicIndex(s)] ?? never();
    const covered = sectorFromId(content.samAirControl.indexOf(0));
    const t = campaign.tactical?.state ?? never();
    return { campaign, t, sam, other: content.samSites[1] ?? never(), site: element(site), covered: element(covered) };
  }

  it('wears down the SAM by the damage dealt to one of its two tiles and gives up its air below 80 (UpdateAndDamageSAMIfFound)', () => {
    const { t, sam, other, site, covered } = atFirstSamSite();
    const hit = (gridNo: number, damage: number) => t.sectorHooks.structureDamaged(t, gridNo, damage);
    expect([site.enemyControlled, site.samCondition, covered.enemyAirControlled]).toEqual([true, 100, true]);
    hit(sam.gridNos[0] ?? never(), 15);
    hit((sam.gridNos[0] ?? never()) + 2, 90);
    hit(other.gridNos[0] ?? never(), 90);
    expect([site.samCondition, covered.enemyAirControlled]).toEqual([85, true]);
    hit(sam.gridNos[1] ?? never(), 6);
    expect([site.samCondition, covered.enemyAirControlled]).toEqual([79, false]);
    hit(sam.gridNos[1] ?? never(), 255);
    expect(site.samCondition).toBe(0);
  });

  it('takes the damage from an explosion on the SAM tile', () => {
    const { campaign, t, sam, site, covered } = atFirstSamSite();
    const g = sam.gridNos[0] ?? never();
    t.world.structures.add(g, 0, syntheticStructure(StructureFlags.GENERIC));
    igniteExplosion(t, null, 0, g, itemId(t, 'TNT'), 0);
    runExplosivesUntilIdle(campaign.tactical ?? never());
    expect(site.samCondition).toBeLessThan(80);
    expect(covered.enemyAirControlled).toBe(false);
  });
});

describe('the time of day in a loaded sector', () => {
  it("reaches an underground sector from the world's light value, while the map keeps its own ambient light", () => {
    const basement = { ...A10, z: 1 };
    const { campaign, roster } = createTestCampaign(kit, { seed: 15, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    for (const m of roster.all()) m.sector = { ...basement };
    expect(flowOf(campaign).setCurrentWorldSector(basement)).toBe(true);
    reloadPoint(campaign);
    const t = campaign.tactical?.state ?? never();
    expect(t.lighting.underground).toBe(true);
    for (const light of [NORMAL_LIGHTLEVEL_NIGHT, NORMAL_LIGHTLEVEL_DAY]) {
      campaign.state.env.lightValue = light;
      expect(timeOfDayAmbientLevel(t)).toBe(light);
    }
    expect(t.lighting.ambient).toBe(t.world.map?.ambient?.lightLevel);
  });
});

describe('the map loaded last', () => {
  it("keeps a trashed basement's visible area for random tiles in unloaded sectors until the next map loads", () => {
    const basement = { ...A10, z: 1 };
    const { campaign, roster } = createTestCampaign(kit, { seed: 15, garrison: NO_GARRISON });
    const lastMap = () => lastMapRestrictedScroll(campaign.state, campaign.tactical?.state ?? null);
    const load = (sector: typeof A10) => {
      for (const m of roster.all()) m.sector = { ...sector };
      expect(flowOf(campaign).setCurrentWorldSector(sector)).toBe(true);
    };
    landFirstSquad(campaign);
    expect(lastMap()).toBe(RestrictedScroll.NONE);
    load(basement);
    expect(lastMap()).toBe(RestrictedScroll.BASEMENT);
    flowOf(campaign).trashWorld();
    reloadPoint(campaign);
    expect(campaign.tactical).toBeNull();
    expect(lastMap()).toBe(RestrictedScroll.BASEMENT);
    load(A10);
    expect(lastMap()).toBe(RestrictedScroll.NONE);
    flowOf(campaign).trashWorld();
    expect(lastMap()).toBe(RestrictedScroll.NONE);
  });

  it("keeps the trashed map's rooms under a merc's tile for the move and fact checks until the next map loads (GetRoom after TrashWorld)", () => {
    const NO_ROOM = 0;
    const { campaign, roster } = createTestCampaign(kit, { seed: 15, garrison: NO_GARRISON });
    const factRoom = (gridNo: number) => campaign.narrative.factContext().world.room(gridNo);
    expect([roster.roomOf(0), factRoom(0)]).toEqual([NO_ROOM, NO_ROOM]);
    landFirstSquad(campaign);
    const loaded = campaign.tactical?.state;
    if (!loaded) throw new Error('no loaded sector');
    const rooms = sectorMapOf(loaded).rooms.slice();
    const roomTile = rooms.findIndex((room) => room !== NO_ROOM);
    const merc = roster.get(0);
    if (!merc) throw new Error('no merc');
    merc.soldier.gridNo = roomTile;
    flowOf(campaign).trashWorld();
    reloadPoint(campaign);
    expect(campaign.tactical).toBeNull();
    expect([roster.roomOf(0), factRoom(roomTile)]).toEqual([rooms[roomTile], rooms[roomTile]]);
    expect(rooms[roomTile]).not.toBe(NO_ROOM);
    for (const m of roster.all()) m.sector = { ...A10, z: 1 };
    expect(flowOf(campaign).setCurrentWorldSector({ ...A10, z: 1 })).toBe(true);
    const basement = campaign.tactical?.state;
    if (!basement) throw new Error('no basement');
    expect(campaign.state.sectorFlow.trashedMapRooms).toBeNull();
    expect(roster.roomOf(0)).toBe(sectorMapOf(basement).rooms[roster.get(0)?.soldier.gridNo ?? 0] ?? NO_ROOM);
  });
});

describe('exit grids', () => {
  it('takes the squad down the A10 stairs into the basement and back up', () => {
    const { campaign, roster } = createTestCampaign(kit, { seed: 15, garrison: NO_GARRISON });
    landFirstSquad(campaign);
    const flow = flowOf(campaign);
    const a10 = sectorInfo(campaign.state.map, A10);
    a10.numAdmins = 0;
    a10.numTroops = 0;
    a10.numElites = 0;
    for (const m of roster.all()) {
      m.sector = { ...A10 };
      m.insertionCode = InsertionCode.CENTER;
    }
    for (const g of campaign.state.forces.groups) if (g.player) g.sector = { ...A10 };
    expect(flow.setCurrentWorldSector(A10)).toBe(true);
    const stairs = 71 * 160 + 72;
    const r = campaign.dispatch({ type: 'exitSector', soldier: 0, exitGrid: stairs, who: 'squad' });
    expect(r).toMatchObject({ ok: true, data: { minutes: 0, load: true, target: 'A10' } });
    runTicks(campaign, 4000, () => campaign.state.worldSector?.z === 1);
    expect(campaign.state.worldSector).toEqual({ x: 10, y: 1, z: 1 });
    const below = campaign.tactical?.state ?? never();
    expect(below.world.map?.info.restrictedScrollId).toBe(1);
    expect(ourSoldiers(campaign)).toHaveLength(4);
    expect(roster.all().every((m) => m.sector.z === 1 && !m.betweenSectors)).toBe(true);
    runUntilIdle(campaign);
    const up = 72 * 160 + 80;
    expect(campaign.dispatch({ type: 'exitSector', soldier: 0, exitGrid: up, who: 'squad' }).ok).toBe(true);
    runTicks(campaign, 4000, () => campaign.state.worldSector?.z === 0);
    expect(campaign.state.worldSector).toEqual(A10);
  });

  it('prepares the rebel basement in A10 before any exit grid leads there: going down to the hideout loads it at once', () => {
    const withoutStairs: SectorWorlds = {
      exists: (path) => kit.sectors.worlds.exists(path),
      world: (path) => {
        const world = kit.sectors.worlds.world(path);
        if (!world || !path.endsWith(STUB_A10_MAP)) return world;
        return { ...world, map: { ...world.map, exitGrids: [] }, exitGrids: new Set() };
      },
    };
    const { campaign } = createTestCampaign(
      { ...kit, sectors: { ...kit.sectors, worlds: withoutStairs } },
      { seed: 16, garrison: NO_GARRISON },
    );
    landFirstSquad(campaign);
    const flow = flowOf(campaign);
    Object.assign(sectorInfo(campaign.state.map, A10), NO_GARRISON_COUNTS);
    for (const m of flow.setup.roster.all()) m.sector = { ...A10 };
    expect(flow.setCurrentWorldSector(A10)).toBe(true);
    expect(campaign.tactical?.state.world.exitGrids.size).toBe(0);
    expect(flow.mapsNeededSoon()).toContain(flow.mapPathOf({ ...A10, z: 1 }));
  });
});
