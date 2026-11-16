import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../tests/support/original-data.ts';
import { type LogicTimeline, SlotKind, slotArgument, slotKind, timelineSlot } from '../content/anim/timelines.ts';
import { parseSaveGame } from '../content/formats/savegame.ts';
import {
  decryptSaveRecord,
  encryptSaveRecord,
  parseSaveEncryptionTable,
  parseSaveHeader,
  SAVE_ENCRYPTION_PATH,
  SAVE_HEADER_BYTES,
} from '../content/formats/savegame-header.ts';
import { layoutBytes, layoutOffsets } from '../content/formats/savegame-layout.ts';
import { profileRecordBytes } from '../content/formats/savegame-profile.ts';
import { MAP_ELEMENT_LAYOUT, SECTOR_INFO_LAYOUT } from '../content/formats/savegame-strategic.ts';
import { GENERAL_INFO_LAYOUT, TACTICAL_STATUS_LAYOUT } from '../content/formats/savegame-tactical.ts';
import { MapModificationType } from '../content/formats/savegame-temp-files.ts';
import { withGraphicFacts } from '../content/rules/graphic-facts.ts';
import { MAP_WORLD_CELLS, SECTOR_COUNT, sectorId, strategicIndex } from '../content/strategic/sector-ids.ts';
import { vfsFileReader } from '../content/vfs/vfs.ts';
import { Direction } from '../content/world/grid.ts';
import { TravelCost } from '../content/world/movement-costs.ts';
import { StructureFlags } from '../content/world/structures.ts';
import { type DataVfs, openDataVfs } from '../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../node/repo.ts';
import { musicMode } from '../protocol/music.ts';
import { MusicMode, musicModeOfNativeByte } from '../protocol/music-modes.ts';
import { advance } from '../sim/advance.ts';
import { importNativeGameOptions, SAVE_MODES } from '../sim/options.ts';
import { queenProgress } from '../sim/strategic/ai/difficulty.ts';
import { SectorFlag } from '../sim/strategic/forces/constants.ts';
import { REFUEL_SITES, RefuelSiteId } from '../sim/strategic/forces/helicopter-state.ts';
import { getSectorFlagStatus } from '../sim/strategic/map/sectors.ts';
import { Fact } from '../sim/strategic/narrative/fact-ids.ts';
import { MAX_QUESTS } from '../sim/strategic/narrative/facts.ts';
import { CompressMode } from '../sim/strategic/time/constants.ts';
import { anim } from '../sim/tactical/anim-states.ts';
import { LightSpriteFlags, lightTimeAt } from '../sim/tactical/lighting/lighting.ts';
import { type AroundAnimationRestart, inLoadedSector } from '../sim/tactical/save-import.ts';
import { Team } from '../sim/tactical/soldier.ts';
import { whoIsThere } from '../sim/tactical/state.ts';
import { createSaveSession } from './save-session.ts';

const DOOR_OPEN = 0x01;
const DOOR_PERCEIVED_OPEN = 0x02;
const ENEMY_TURN_BUDGET = 40_000;
const AIM_MERC_KIND = 1;
const MINUTES_PER_DAY = 1440;
const MINUTES_PER_HOUR = 60;
const WINDOWS_WORLD_LOADED_OFFSET = 301;
const CLOCK_GAME_PAUSED_OFFSET = 5;
const CLOCK_PAUSE_DUE_TO_PLAYER_OFFSET = 31;
const ENEMY_ENCOUNTER_CODE = 2;
const ENEMY_AMBUSH_CODE = 3;
const NO_CENTER_GRIDNO = -1;
const MAX_MISC_NOISE_DURATION = 12;
const NATIVE_MAP_SCREEN = 9;
const MAP_SCREEN_TICKS = 200 * 60;
const dataDir = ORIGINAL_DATA_DIR;
const gameRoot = basename(dataDir).toLowerCase() === 'data' ? dirname(dataDir) : dataDir;
const savesDir = join(gameRoot, 'SavedGames');
const saveFiles = dataDir && existsSync(savesDir) ? readdirSync(savesDir).filter((f) => f.toLowerCase().endsWith('.sav')) : [];
const savedWithWorld = (file: string) => parseSaveHeader(new Uint8Array(readFileSync(join(savesDir, file)))).header.worldLoaded;
const worldSaves = saveFiles.filter(savedWithWorld);
const noWorldSaves = saveFiles.filter((file) => !savedWithWorld(file));
const encryption = parseSaveEncryptionTable(JSON.parse(readFileSync(join(PROJECT_DATA_DIR, SAVE_ENCRYPTION_PATH), 'utf8')));
const savedInCombat = (file: string) => parseSaveGame(new Uint8Array(readFileSync(join(savesDir, file))), encryption).tactical.inCombat;
const battleSave = [...worldSaves].sort().find(savedInCombat);
const TRAVEL_STEPS = 20_000;
const IDLE_DICE = 100;
const IDLE_ROLLERS_OF_THE_NATIVE_LOAD: Readonly<Record<string, readonly number[]>> = { 'SaveGame01.sav': [121], 'SaveGame07.sav': [0] };
const DRASSEN_AIRPORT = { x: 13, y: 2, z: 0 };
const SAVE_VERSION_OFFSET = 0;
const LAST_VERSION_WITHOUT_SPECK_PAYMENTS = 90;
const PROFILE_TOTAL_COST_TO_DATE_OFFSET = 708;
const PAST_MERC_COST = 1234;
const HELIDROP_LANDED = 467;
const WRECKED_SAM_CONDITION = 0;
const START_SECTOR = { x: 9, y: 1 };
const FREE_AIRSPACE_NEXT_TO_THE_START = { x: 10, y: 1 };
const NUM_MINES = 6;
const MINE_STATUS_BYTES = 44;
const MINE_SPOKE_TO_HEAD_MINER_OFFSET = 22;
const NUM_TOWNS = 13;
const TOWN_LOYALTY_BYTES = 26;
const FULL_LOYALTY = 100;
const PRIORITY_PHASE_PERCENT = 10;

function codeOfOpcode(timeline: LogicTimeline, state: number, opcode: number): number {
  for (let pc = 0; ; pc++) {
    const slot = timelineSlot(state, pc);
    if (slotKind(timeline, slot) === SlotKind.OP && slotArgument(timeline, slot) === opcode) return pc;
    if (slotKind(timeline, slot) === SlotKind.EMPTY) throw new Error(`no code ${opcode} in state ${state}`);
  }
}
const DRASSEN_HELIPAD = 9001;
const WRITTEN_BACK_ON_LOAD: ReadonlySet<number> = new Set([
  MapModificationType.OBJECT,
  MapModificationType.STRUCT,
  MapModificationType.REMOVE_STRUCT,
  MapModificationType.EXIT_GRIDS,
]);

describe.skipIf(!ORIGINAL_DATA_DIR)('native savegames imported into a campaign', () => {
  let data: DataVfs;
  const read = withGraphicFacts((path) => vfsFileReader(data.vfs)(path));

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir });
  });
  afterAll(async () => {
    await data.close();
  });

  function withoutWorld(file: string, justStarted = false): Uint8Array {
    const bytes = new Uint8Array(readFileSync(join(savesDir, file)));
    expect(parseSaveHeader(bytes).stracLinuxFormat).toBe(false);
    bytes[WINDOWS_WORLD_LOADED_OFFSET] = 0;
    if (justStarted) bytes[SAVE_HEADER_BYTES + (layoutOffsets(TACTICAL_STATUS_LAYOUT, false).get('fDidGameJustStart') ?? 0)] = 1;
    expect(parseSaveHeader(bytes).header.worldLoaded).toBe(false);
    return bytes;
  }

  function sectorName(sector: { readonly x: number; readonly y: number }): string {
    return `${String.fromCharCode(64 + sector.y)}${sector.x}`;
  }

  function withEncounterCode(file: string, code: number): Uint8Array {
    const bytes = new Uint8Array(readFileSync(join(savesDir, file)));
    const info = parseSaveGame(bytes, encryption).sections.find((s) => s.name === 'general info');
    if (!info) throw new Error(`${file} has no general info section`);
    bytes[info.offset + (layoutOffsets(GENERAL_INFO_LAYOUT, false).get('gubEnemyEncounterCode') ?? 0)] = code;
    return bytes;
  }

  function withMercCostToDate(file: string, profile: number, cost: number, version: number): Uint8Array {
    const bytes = new Uint8Array(readFileSync(join(savesDir, file)));
    const save = parseSaveGame(bytes, encryption);
    const key = encryption.sets[save.encryptionSet];
    const profiles = save.sections.find((s) => s.name === 'merc profiles');
    if (!key || !profiles) throw new Error(`${file} has no merc profiles to patch`);
    const size = profileRecordBytes(false);
    const at = profiles.offset + profile * size;
    const plain = decryptSaveRecord(bytes.subarray(at, at + size), key);
    new DataView(plain.buffer).setUint32(PROFILE_TOTAL_COST_TO_DATE_OFFSET, cost, true);
    bytes.set(encryptSaveRecord(plain, key), at);
    new DataView(bytes.buffer).setUint32(SAVE_VERSION_OFFSET, version, true);
    return bytes;
  }

  function sectionOf(bytes: Uint8Array, name: string) {
    const section = parseSaveGame(bytes, encryption).sections.find((s) => s.name === name);
    if (!section) throw new Error(`the save has no ${name} section`);
    return section;
  }

  function withEstoniOpenToTheHelicopter(file: string, refuellingFact: boolean): Uint8Array {
    const bytes = new Uint8Array(readFileSync(join(savesDir, file)));
    const map = sectionOf(bytes, 'strategic info').offset;
    const element = layoutBytes(MAP_ELEMENT_LAYOUT, false);
    const fields = layoutOffsets(MAP_ELEMENT_LAYOUT, false);
    for (let i = 0; i < MAP_WORLD_CELLS; i++) bytes[map + i * element + (fields.get('bSAMCondition') ?? 0)] = WRECKED_SAM_CONDITION;
    const estoni = REFUEL_SITES[RefuelSiteId.ESTONI]?.sector ?? START_SECTOR;
    bytes[map + strategicIndex(estoni) * element + (fields.get('fEnemyControlled') ?? 0)] = 0;
    bytes[sectionOf(bytes, 'quests').offset + MAX_QUESTS + Fact.ESTONI_REFUELLING_POSSIBLE] = refuellingFact ? 1 : 0;
    return bytes;
  }

  function withEveryMineProducingForThePlayer(file: string): Uint8Array {
    const bytes = new Uint8Array(readFileSync(join(savesDir, file)));
    const map = sectionOf(bytes, 'strategic info').offset;
    const element = layoutBytes(MAP_ELEMENT_LAYOUT, false);
    const enemyControlled = layoutOffsets(MAP_ELEMENT_LAYOUT, false).get('fEnemyControlled') ?? 0;
    for (let i = 0; i < MAP_WORLD_CELLS; i++) bytes[map + i * element + enemyControlled] = 0;
    const sectors = map + MAP_WORLD_CELLS * element;
    const sector = layoutBytes(SECTOR_INFO_LAYOUT, false);
    const garrison = ['ubNumTroops', 'ubNumElites', 'ubNumAdmins'].map((name) => layoutOffsets(SECTOR_INFO_LAYOUT, false).get(name) ?? 0);
    for (let i = 0; i < SECTOR_COUNT; i++) for (const at of garrison) bytes[sectors + i * sector + at] = 0;
    const mines = sectionOf(bytes, 'mine status').offset;
    for (let mine = 0; mine < NUM_MINES; mine++) bytes[mines + mine * MINE_STATUS_BYTES + MINE_SPOKE_TO_HEAD_MINER_OFFSET] = 1;
    const towns = sectionOf(bytes, 'town loyalty').offset;
    for (let town = 0; town < NUM_TOWNS; town++) bytes[towns + town * TOWN_LOYALTY_BYTES] = FULL_LOYALTY;
    return bytes;
  }

  function withLandingZone(file: string, zone: { readonly x: number; readonly y: number }): Uint8Array {
    const bytes = new Uint8Array(readFileSync(join(savesDir, file)));
    const info = sectionOf(bytes, 'general info').offset;
    const fields = layoutOffsets(GENERAL_INFO_LAYOUT, false);
    const view = new DataView(bytes.buffer);
    view.setInt16(info + (fields.get('g_merc_arrive_sector_x') ?? 0), zone.x, true);
    view.setInt16(info + (fields.get('g_merc_arrive_sector_y') ?? 0), zone.y, true);
    return bytes;
  }

  function pausedByThePlayer(file: string): Uint8Array {
    const bytes = new Uint8Array(readFileSync(join(savesDir, file)));
    const clock = parseSaveGame(bytes, encryption).sections.find((s) => s.name === 'game clock');
    if (!clock) throw new Error(`${file} has no game clock section`);
    bytes[clock.offset + CLOCK_GAME_PAUSED_OFFSET] = 1;
    bytes[clock.offset + CLOCK_PAUSE_DUE_TO_PLAYER_OFFSET] = 1;
    return bytes;
  }

  it.skipIf(worldSaves.length === 0)(
    'continues a save made with no sector loaded on the map screen without reading a map, and a squad sent on loads its sector',
    async () => {
      const file = [...worldSaves].sort()[0] ?? '';
      const bytes = withoutWorld(file);
      const table = parseSaveEncryptionTable(JSON.parse(new TextDecoder().decode((await read(SAVE_ENCRYPTION_PATH)) ?? new Uint8Array())));
      const save = parseSaveGame(bytes, table);
      const asked: string[] = [];
      const watched = (path: string) => {
        asked.push(path);
        return read(path);
      };
      const { session, report } = await createSaveSession(watched, bytes, undefined, (p) => data.vfs.stat(p) !== undefined);
      expect(asked.filter((p) => p.startsWith('maps/'))).toEqual([]);
      expect(report).toMatchObject({ mapPath: null, soldiers: 0, worldItems: 0, corpses: 0 });
      const c = session.campaign;
      expect([c.tactical, c.state.flow, c.state.worldSector]).toEqual([null, 'strategic', null]);
      expect(c.state.pre.state()).toEqual({ ring: save.preRandom.numbers, index: save.preRandom.index });
      expect(c.state.keyTable).toEqual(save.keyTable.map((k) => ({ ...k })));
      expect(c.state.civGroups.hostility).toEqual([...save.tactical.civGroupHostile]);
      const mercs = session.roster?.all() ?? [];
      const saved = save.soldiers.filter((e) => e.soldier.team === Team.OUR && e.soldier.active !== 0);
      expect(mercs.map((m) => m.id)).toEqual(saved.map((e) => e.soldier.id).sort((a, b) => a - b));
      expect(mercs.some((m) => m.soldier.placed)).toBe(false);
      const clock = c.state.clock;
      const before = clock.seconds;
      expect(session.dispatch({ type: 'compressTime', mode: 4 })).toEqual({ ok: true });
      for (let i = 0; i < 2000 && clock.seconds < before + 3600; i++) session.step();
      expect(clock.seconds).toBeGreaterThanOrEqual(before + 3600);
      const walker = mercs.find((m) => m.life >= 15 && m.assignment < 20 && !m.betweenSectors);
      if (!walker) throw new Error(`${file} has no merc on a squad`);
      const neighbours = [-1, 1].flatMap((dx) => [
        { x: walker.sector.x + dx, y: walker.sector.y },
        { x: walker.sector.x, y: walker.sector.y + dx },
      ]);
      const target = neighbours.map(sectorName).find((to) => session.dispatch({ type: 'route', soldier: walker.id, to }).ok);
      if (!target) throw new Error(`${file}: no neighbouring sector to send the squad to`);
      expect(session.dispatch({ type: 'compressTime', mode: 3 })).toEqual({ ok: true });
      for (let i = 0; i < 20_000 && (walker.betweenSectors || sectorName(walker.sector) !== target); i++) session.step();
      expect(sectorName(walker.sector)).toBe(target);
      advance(session, { idle: true });
      const enter = { type: 'enterSector', sector: target };
      await session.prepare(enter);
      expect(session.dispatch(enter)).toMatchObject({ ok: true, data: { sector: target } });
      expect(c.state.flow).toBe('tactical');
      expect(walker.soldier.placed).toBe(true);
      expect(advance(session, { ticks: 200 * 10 }, 200 * 10).reason).not.toBe('budget');
    },
  );

  it.skipIf(saveFiles.length === 0)(
    'continues a save made under the player\'s pause with the clock running and no player pause left, which nothing would clear (deviation "Pause state after an import")',
    async () => {
      const bytes = pausedByThePlayer([...saveFiles].sort()[0] ?? '');
      expect(parseSaveGame(bytes, encryption).clock).toMatchObject({ gamePaused: true, pauseDueToPlayerGamePause: true });
      const { session } = await createSaveSession(read, bytes, undefined, (p) => data.vfs.stat(p) !== undefined);
      const clock = session.campaign.state.clock;
      expect([clock.paused, clock.pauseLocked, clock.playerPause]).toEqual([false, false, false]);
      expect(session.view().clock).toMatchObject({ paused: false, playerPaused: false });
    },
  );

  it.skipIf(!battleSave)(
    'calls the enemies of a battle saved as an ambush to the map centre at the end of the import (SaveLoadGame.cc:1195)',
    async () => {
      const bytes = withEncounterCode(battleSave ?? '', ENEMY_AMBUSH_CODE);
      const { session } = await createSaveSession(read, bytes, undefined, (p) => data.vfs.stat(p) !== undefined);
      const t = session.campaign.tactical?.state;
      if (!t) throw new Error(`${battleSave} has no loaded sector`);
      const center = t.world.map?.info.centerGridNo;
      expect(center).not.toBe(NO_CENTER_GRIDNO);
      expect([t.perception.publicNoiseGridNo[Team.ENEMY], t.perception.publicNoiseVolume[Team.ENEMY]]).toEqual([
        center,
        MAX_MISC_NOISE_DURATION,
      ]);
    },
  );

  it.skipIf(saveFiles.length === 0)(
    "adds the M.E.R.C. mercs' costs to date to Speck's total for a save patched below version 91, and keeps the total of the save as made (SaveLoadGame.cc:1159)",
    async () => {
      const file = [...saveFiles].sort()[0] ?? '';
      const savedVersion = parseSaveHeader(new Uint8Array(readFileSync(join(savesDir, file)))).header.version;
      const imported = async (bytes: Uint8Array) =>
        (await createSaveSession(read, bytes, undefined, (p) => data.vfs.stat(p) !== undefined)).session.campaign;
      const asMade = await imported(new Uint8Array(readFileSync(join(savesDir, file))));
      const listed = asMade.laptop?.content.mercListings[0]?.profile;
      if (listed === undefined) throw new Error('no M.E.R.C. listing');
      const paidAsSaved = asMade.state.laptop.merc.totalMoneyPaidToSpeck;
      const kept = await imported(withMercCostToDate(file, listed, PAST_MERC_COST, savedVersion));
      const fixed = await imported(withMercCostToDate(file, listed, PAST_MERC_COST, LAST_VERSION_WITHOUT_SPECK_PAYMENTS));
      expect(kept.state.finances.profileCostToDate.get(listed)).toBe(PAST_MERC_COST);
      expect([kept.state.laptop.merc.totalMoneyPaidToSpeck, fixed.state.laptop.merc.totalMoneyPaidToSpeck]).toEqual([
        paidAsSaved,
        paidAsSaved + PAST_MERC_COST,
      ]);
    },
  );

  it.skipIf(saveFiles.length === 0)(
    "recomputes the refuel sites on import with the save's facts: Estoni, its sector and airspace free, opens to the helicopter only when the save has its refuelling fact (Strategic_AI.cc:2463, SaveLoadGame.cc:810)",
    async () => {
      const file = [...saveFiles].sort()[0] ?? '';
      const refuelSites = async (refuellingFact: boolean) => {
        const bytes = withEstoniOpenToTheHelicopter(file, refuellingFact);
        const { session } = await createSaveSession(read, bytes, undefined, (p) => data.vfs.stat(p) !== undefined);
        return session.campaign.state.forces.helicopter.refuelSiteAvailable;
      };
      expect(await refuelSites(true)).toEqual([true, true]);
      expect(await refuelSites(false)).toEqual([true, false]);
    },
  );

  it.skipIf(saveFiles.length === 0)(
    "checks the saved landing zone against the airspace on import: one under the enemy's moves to the start sector, as the load's airspace update does after the general info (SaveLoadGame.cc:838, StrategicMap.cc:2295)",
    async () => {
      const file = [...saveFiles].sort()[0] ?? '';
      const imported = async (zone: { readonly x: number; readonly y: number }) =>
        (await createSaveSession(read, withLandingZone(file, zone), undefined, (p) => data.vfs.stat(p) !== undefined)).session;
      const underTheEnemy = await imported(DRASSEN_AIRPORT);
      expect(underTheEnemy.campaign.state.map.elements[strategicIndex(DRASSEN_AIRPORT)]?.enemyAirControlled).toBe(true);
      expect(underTheEnemy.campaign.state.laptop.mercArriveSector).toBe(sectorId(START_SECTOR));
      expect(underTheEnemy.drainEvents()).toContainEqual(expect.objectContaining({ type: 'landingZoneReset', from: 'B13', to: 'A9' }));
      const free = await imported(FREE_AIRSPACE_NEXT_TO_THE_START);
      expect(free.campaign.state.laptop.mercArriveSector).toBe(sectorId(FREE_AIRSPACE_NEXT_TO_THE_START));
    },
  );

  it.skipIf(saveFiles.length === 0)(
    "evolves the Queen's priority phase on import from the save's mines and town loyalty, which the load reads before the strategic AI (SaveLoadGame.cc:841-846, Strategic_AI.cc:2465)",
    async () => {
      const file = [...saveFiles].sort()[0] ?? '';
      const bytes = withEveryMineProducingForThePlayer(file);
      const { session } = await createSaveSession(read, bytes, undefined, (p) => data.vfs.stat(p) !== undefined);
      const q = session.campaign.queen;
      if (!q) throw new Error('the imported campaign has no strategic AI');
      expect(q.mines.predictIncomeFromPlayerMines()).toBeGreaterThan(0);
      expect(q.state.queen.priorityPhase).toBe(Math.trunc(queenProgress(q) / PRIORITY_PHASE_PERCENT));
    },
  );

  it.skipIf(!battleSave)(
    "lets a battle saved as the enemy's encounter be autoresolved, which the sector's counts alone would take for the player's attack",
    async () => {
      const bytes = withEncounterCode(battleSave ?? '', ENEMY_ENCOUNTER_CODE);
      const { session } = await createSaveSession(read, bytes, undefined, (p) => data.vfs.stat(p) !== undefined);
      expect(session.campaign.state.flow).toBe('tactical');
      expect(session.dispatch({ type: 'autoresolveBattle' })).toEqual({ ok: true });
    },
  );

  it.skipIf(worldSaves.length === 0)(
    'starts the first arrival from a save made before it, as a new game does, when time first runs',
    async () => {
      const bytes = withoutWorld([...worldSaves].sort()[0] ?? '', true);
      const { session } = await createSaveSession(read, bytes, undefined, (p) => data.vfs.stat(p) !== undefined);
      const c = session.campaign;
      expect([c.state.didGameJustStart, c.state.flow, c.tactical]).toEqual([true, 'strategic', null]);
      const compress = { type: 'compressTime', mode: 4 };
      await session.prepare(compress);
      expect(session.dispatch(compress)).toEqual({ ok: true });
      expect([c.state.didGameJustStart, c.state.flow, c.state.worldSector]).toEqual([false, 'tactical', { x: 9, y: 1, z: 0 }]);
      expect(session.drainEvents().find((e) => e.type === 'sectorLoaded')).toMatchObject({ sector: 'A9' });
      expect(c.state.sectorFlow.helicopterDrop.firstHeliRun).toBe(true);
    },
  );

  it.skipIf(worldSaves.length === 0)(
    'refuses a save whose animation restart reaches a campaign hook, naming the soldier, his animation and code and the hook: a merc of the loaded sector put right before the end of a helicopter drop says his arrival lines (deviation "Animations on load reaching the campaign")',
    async () => {
      const bytes = new Uint8Array(readFileSync(join(savesDir, [...worldSaves].sort()[0] ?? '')));
      const landing: AroundAnimationRestart = (t, restart) => {
        const merc = t.soldiers.find((s) => s?.team === Team.OUR);
        if (!merc) throw new Error('no merc of ours in the loaded sector');
        merc.state = anim(t.content, 'HELIDROP');
        merc.pc = codeOfOpcode(t.content.timeline, merc.state, HELIDROP_LANDED);
        restart();
      };
      await expect(createSaveSession(read, bytes, undefined, null, undefined, undefined, landing)).rejects.toThrow(
        /^cannot continue this save: the restart of soldier \d+ \(.+\), saved in HELIDROP at code \d+, reaches the campaign through sectorHooks\.mercArrivesQuotes$/,
      );
    },
  );

  for (const file of worldSaves) {
    it(`restarts the animations of ${file} with the idle checks the native load rolls: one in SaveGame01 and SaveGame07, by the soldier its draw trace shows, none in the others (CreateSoldierCommon, Soldier_Control.cc:615)`, async () => {
      const bytes = new Uint8Array(readFileSync(join(savesDir, file)));
      const table = parseSaveEncryptionTable(JSON.parse(new TextDecoder().decode((await read(SAVE_ENCRYPTION_PATH)) ?? new Uint8Array())));
      const save = parseSaveGame(bytes, table);
      const draws: number[] = [];
      const counted: AroundAnimationRestart = (t, restart) => {
        const rng = t.rng as unknown as { int(n: number): number };
        const own = rng.int.bind(rng);
        rng.int = (n) => {
          draws.push(n);
          return own(n);
        };
        try {
          restart();
        } finally {
          delete (rng as { int?: unknown }).int;
        }
      };
      const { session } = await createSaveSession(read, bytes, undefined, null, undefined, undefined, counted);
      const t = session.campaign.tactical?.state;
      const rolled = save.soldiers
        .map((e) => e.soldier)
        .filter((r) => r.motion.timeOfLastRandomAction > 0 && t?.soldiers[r.id]?.timeOfLastRandomAction === 0)
        .map((r) => r.id);
      const rollers = IDLE_ROLLERS_OF_THE_NATIVE_LOAD[file] ?? [];
      expect([draws, rolled]).toEqual([rollers.map(() => IDLE_DICE), rollers]);
    });
  }

  for (const file of saveFiles) {
    it(`imports the game options and the music mode of ${file}`, async () => {
      const bytes = new Uint8Array(readFileSync(join(savesDir, file)));
      const table = parseSaveEncryptionTable(JSON.parse(new TextDecoder().decode((await read(SAVE_ENCRYPTION_PATH)) ?? new Uint8Array())));
      const save = parseSaveGame(bytes, table);
      const { session, report } = await createSaveSession(read, bytes, undefined, (p) => data.vfs.stat(p) !== undefined);
      const saved = save.generalInfo.gameOptions;
      const options = session.campaign.state.options;
      expect(options).toEqual({ ...importNativeGameOptions(saved).options });
      expect(options.saveMode).toBe(SAVE_MODES[saved.saveMode]);
      if (session.campaign.tactical) expect(session.campaign.tactical.state.options).toBe(options);
      expect(report.droppedOptions).toEqual(saved.turnTimeLimit ? ['turnTimeLimit'] : []);
      expect(session.initialMusic).toEqual({ mode: musicModeOfNativeByte(save.generalInfo.musicMode), previous: MusicMode.MAIN_MENU });
      expect(session.initialMusic.mode).not.toBe(MusicMode.RESTORE);
      expect(musicMode(session.initialMusic, session.drainEvents(), session.musicFacts()).mode).toBe(session.initialMusic.mode);
    });

    it(`keeps the pre-battle state of ${file}, its battle locator on the map while it blinks (SaveLoadGame.cc:2084-2091)`, async () => {
      const bytes = new Uint8Array(readFileSync(join(savesDir, file)));
      const saved = parseSaveGame(bytes, encryption).generalInfo.preBattle;
      const { session } = await createSaveSession(read, bytes, undefined, (p) => data.vfs.stat(p) !== undefined);
      const { battle, encounter } = session.campaign.state;
      expect({
        persistent: battle.persistent,
        encounterCode: encounter.code,
        explicitEncounterCode: encounter.explicitCode,
        battleSectorLocator: battle.locator,
        sector: battle.sector ?? { x: 0, y: 0, z: 0 },
        cantRetreat: encounter.cantRetreatInPBI,
      }).toEqual(saved);
      const locator = session.view().strategic?.battleLocator;
      expect(locator).toBe(saved.battleSectorLocator ? sectorName(saved.sector) : undefined);
    });

    it(`shows the contracts of ${file} at hour precision`, async () => {
      const bytes = new Uint8Array(readFileSync(join(savesDir, file)));
      const table = parseSaveEncryptionTable(JSON.parse(new TextDecoder().decode((await read(SAVE_ENCRYPTION_PATH)) ?? new Uint8Array())));
      const save = parseSaveGame(bytes, table);
      const { session } = await createSaveSession(read, bytes, undefined, (p) => data.vfs.stat(p) !== undefined);
      const mercs = save.soldiers.map((e) => e.soldier).filter((s) => s.team === Team.OUR && s.whatKindOfMercAmI === AIM_MERC_KIND);
      const views = session.view().strategic?.mercs ?? [];
      for (const saved of mercs) {
        const end = saved.contract.contractEnd;
        expect(views.find((m) => m.id === saved.id)?.contract).toMatchObject({
          type: 'aim',
          totalDays: saved.contract.totalContractLength,
          endsAt: { day: Math.trunc(end / MINUTES_PER_DAY), hour: Math.trunc((end % MINUTES_PER_DAY) / MINUTES_PER_HOUR) },
        });
      }
      expect(session.view().contractPrompt ?? null).toBeNull();
    });
  }

  for (const file of worldSaves) {
    it(`resumes ${file} with its sector loaded on the screen it was saved on: the map screen with time stopped, or tactical`, async () => {
      const bytes = new Uint8Array(readFileSync(join(savesDir, file)));
      const table = parseSaveEncryptionTable(JSON.parse(new TextDecoder().decode((await read(SAVE_ENCRYPTION_PATH)) ?? new Uint8Array())));
      const save = parseSaveGame(bytes, table);
      const { session } = await createSaveSession(read, bytes, undefined, (p) => data.vfs.stat(p) !== undefined);
      const c = session.campaign;
      const sector = save.tactical.worldSector;
      expect(c.state.worldSector).toEqual({ x: sector.x, y: sector.y, z: sector.z });
      const mercsHere = save.soldiers.filter((e) => inLoadedSector(save, e.soldier) && e.soldier.team === Team.OUR);
      expect(mercsHere.every((e) => c.tactical?.state.soldiers[e.soldier.id]?.placed)).toBe(true);
      if (save.generalInfo.screenAfterLoading !== NATIVE_MAP_SCREEN) {
        expect(session.view().strategic?.flow).toBe('tactical');
        const selected = c.tactical?.state.turn.selected ?? -1;
        expect(selected).toBe(save.generalInfo.selectedSoldier);
        expect(c.state.forces.currentSquad).toBe(session.roster?.get(selected)?.assignment);
        return;
      }
      expect(session.view().strategic?.flow).toBe('strategic');
      expect([c.state.clock.mode, c.state.clock.compressionOn]).toEqual([CompressMode.X0, false]);
      const before = c.state.clock.seconds;
      advance(session, { ticks: MAP_SCREEN_TICKS }, MAP_SCREEN_TICKS);
      expect(c.state.clock.seconds).toBe(before);
      expect(session.dispatch({ type: 'tacticalScreen' })).toEqual({ ok: true });
      expect(session.view().strategic?.flow).toBe('tactical');
      advance(session, { ticks: MAP_SCREEN_TICKS }, MAP_SCREEN_TICKS);
      expect(c.state.clock.seconds - before).toBe(60);
    });

    it(`imports the doors, key rings, key table, civilian groups and map modifications flag of ${file}`, async () => {
      const bytes = new Uint8Array(readFileSync(join(savesDir, file)));
      const table = parseSaveEncryptionTable(JSON.parse(new TextDecoder().decode((await read(SAVE_ENCRYPTION_PATH)) ?? new Uint8Array())));
      const save = parseSaveGame(bytes, table);
      const { session } = await createSaveSession(read, bytes, undefined, (p) => data.vfs.stat(p) !== undefined);
      const t = session.sim.state;
      expect(save.keyTable).toHaveLength(64);
      expect(t.keyTable).toEqual(save.keyTable.map((k) => ({ ...k })));
      expect(t.civGroups.hostility).toEqual([...save.tactical.civGroupHostile]);
      expect([...t.world.mapDoors.values()].map((d) => [d.gridNo, d.lockId, d.perceivedLocked])).toEqual(
        (save.currentSector.doors ?? []).map((d) => [d.gridNo, d.lockId, d.perceivedLocked]),
      );
      for (const entry of save.soldiers.filter((e) => inLoadedSector(save, e.soldier) && e.soldier.team === Team.OUR)) {
        const ring = t.soldiers[entry.soldier.id]?.keyRing ?? null;
        expect(ring?.filter((k) => k.count > 0) ?? null).toEqual(entry.keyRing?.filter((k) => k.count > 0) ?? null);
      }
      const records = save.currentSector.mapModifications ?? [];
      expect(records.some((m) => m.type === MapModificationType.WINDOW_HIT)).toBe(false);
      const writtenBack = records.some((m) => WRITTEN_BACK_ON_LOAD.has(m.type));
      const world = session.campaign.state.worldSector;
      const flagged = world ? getSectorFlagStatus(session.campaign.state.map, world, SectorFlag.MAP_MODIFICATIONS_TEMP_FILE_EXISTS) : null;
      expect(flagged).toBe(world ? writtenBack : null);
    });
  }

  for (const file of noWorldSaves) {
    it(`continues ${file}, saved with no sector loaded, on the map screen without reading a map, its squads travelling on`, async () => {
      const bytes = new Uint8Array(readFileSync(join(savesDir, file)));
      const table = parseSaveEncryptionTable(JSON.parse(new TextDecoder().decode((await read(SAVE_ENCRYPTION_PATH)) ?? new Uint8Array())));
      const save = parseSaveGame(bytes, table);
      const asked: string[] = [];
      const watched = (path: string) => {
        asked.push(path);
        return read(path);
      };
      const { session, report } = await createSaveSession(watched, bytes, undefined, (p) => data.vfs.stat(p) !== undefined);
      expect(asked.filter((p) => p.startsWith('maps/'))).toEqual([]);
      expect(report).toMatchObject({ mapPath: null, soldiers: 0, worldItems: 0, corpses: 0 });
      const c = session.campaign;
      expect([c.tactical, c.state.flow, c.state.worldSector]).toEqual([null, 'strategic', null]);
      expect(c.state.pre.state()).toEqual({ ring: save.preRandom.numbers, index: save.preRandom.index });
      expect(c.state.forces.groups.length).toBe(save.groups.length);
      const mercs = session.roster?.all() ?? [];
      const saved = save.soldiers.filter((e) => e.soldier.team === Team.OUR && e.soldier.active !== 0);
      expect(mercs.map((m) => m.id)).toEqual(saved.map((e) => e.soldier.id).sort((a, b) => a - b));
      expect(mercs.some((m) => m.soldier.placed)).toBe(false);
      const travelling = mercs.find((m) => m.life > 0 && m.betweenSectors);
      if (!travelling) return;
      const from = sectorName(travelling.sector);
      expect(session.dispatch({ type: 'compressTime', mode: 3 })).toEqual({ ok: true });
      for (let i = 0; i < TRAVEL_STEPS && sectorName(travelling.sector) === from; i++) session.step();
      expect(sectorName(travelling.sector)).not.toBe(from);
    });
  }

  for (const file of worldSaves) {
    it(`rebuilds ${file} and keeps playing from it`, async () => {
      const bytes = new Uint8Array(readFileSync(join(savesDir, file)));
      const table = parseSaveEncryptionTable(JSON.parse(new TextDecoder().decode((await read(SAVE_ENCRYPTION_PATH)) ?? new Uint8Array())));
      const save = parseSaveGame(bytes, table);
      const { session, report } = await createSaveSession(read, bytes);
      const t = session.sim.state;
      const records = save.soldiers.map((e) => e.soldier).filter((s) => inLoadedSector(save, s));
      expect(report.soldiers).toBe(records.length);
      for (const r of records) {
        const s = t.soldiers[r.id];
        expect(s?.placed).toBe(true);
        expect([s?.gridNo, s?.level, s?.state, s?.actionPoints, s?.life]).toEqual([
          r.gridNo,
          r.level,
          r.animState,
          r.actionPoints,
          r.stats.life,
        ]);
        expect(whoIsThere(t, r.gridNo, r.level)).toBe(s);
      }
      for (const d of save.currentSector.doorStatus ?? []) {
        const door = t.world.structures.find(d.gridNo, StructureFlags.ANYDOOR);
        if (!door) continue;
        const open = (d.flags & DOOR_OPEN) !== 0;
        expect(t.doorStatus.get(d.gridNo)?.open).toBe(open);
        if (((d.flags & DOOR_PERCEIVED_OPEN) !== 0) === open) expect((door.flags & StructureFlags.OPEN) !== 0).toBe(open);
      }
      expect(t.pre.state()).toEqual({ ring: save.preRandom.numbers, index: save.preRandom.index });
      const lightTime = lightTimeAt(save.worldTime.hour);
      for (const l of t.lighting.sprites) {
        if (!l) continue;
        const scheduled = l.flags & (LightSpriteFlags.PRIMETIME | LightSpriteFlags.NIGHTTIME);
        expect((l.flags & LightSpriteFlags.ON) !== 0).toBe(scheduled === 0 || (scheduled & lightTime) !== 0);
      }
      expect(t.inCombat).toBe(save.tactical.inCombat);
      expect(t.realtimeClock).toBe(session.campaign.state.sectorFlow.realtimeClock);
      expect(t.realtimeClock.lastOpplistDecaySeconds).toBe(save.tactical.timeSinceLastOpplistDecay);
      const roster = session.roster;
      const mercs = save.soldiers.filter((e) => e.soldier.team === Team.OUR && e.soldier.active !== 0);
      expect(roster?.all().map((m) => m.id)).toEqual(mercs.map((e) => e.soldier.id).sort((a, b) => a - b));
      const here =
        roster
          ?.inSector(save.tactical.worldSector)
          .filter((m) => m.life > 0)
          .map((m) => m.id) ?? [];
      expect(here.every((id) => t.soldiers[id]?.placed)).toBe(true);
      expect(session.campaign.state.forces.groups.length).toBe(save.groups.length);
      const strategic = session.view().strategic;
      expect(strategic?.mercs.length).toBe(mercs.length);
      expect(strategic?.worldSector).toBe(`${String.fromCharCode(64 + save.tactical.worldSector.y)}${save.tactical.worldSector.x}`);
      expect(strategic?.sectors.some((v) => v.sector === strategic.worldSector && v.visited)).toBe(true);
      if (session.campaign.state.flow === 'strategic') expect(session.dispatch({ type: 'tacticalScreen' })).toEqual({ ok: true });
      const clock = session.campaign.state.clock;
      const before = clock.seconds;
      if (!t.inCombat) {
        advance(session, { ticks: 200 * 60 }, 200 * 60);
        expect(clock.seconds - before).toBe(60);
        expect(session.view().clock?.day).toBe(save.header.day);
        expect(session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
        if (t.turn.enemyInSector) {
          expect(session.dispatch({ type: 'compressTime', mode: 4 })).toEqual({
            ok: false,
            reason: 'enemies are present in the loaded sector',
            data: { refusal: 'enemiesPresent' },
          });
        } else {
          expect(session.dispatch({ type: 'compressTime', mode: 4 })).toEqual({ ok: true });
          const target = clock.seconds + 3 * 3600;
          for (let i = 0; i < 2000 && clock.seconds < target; i++) session.step();
          expect(clock.seconds).toBeGreaterThanOrEqual(target);
        }
        expect(session.dispatch({ type: 'tacticalScreen' })).toEqual({ ok: true });
      }
      if (t.inCombat && t.turn.currentTeam === Team.OUR) {
        expect(session.sim.dispatch({ type: 'endTurn' }).ok).toBe(true);
        expect(advance(session, { idle: true }, ENEMY_TURN_BUDGET).reason).not.toBe('budget');
        expect(t.turn.currentTeam).toBe(Team.OUR);
      }
      const walker = roster?.all().find((m) => m.life >= 15 && m.assignment < 20 && !m.betweenSectors);
      if (walker) {
        const west = `${String.fromCharCode(64 + walker.sector.y)}${walker.sector.x - 1}`;
        const routed = session.dispatch({ type: 'route', soldier: walker.id, to: west });
        if (routed.ok) expect((routed.data as { etaMinutes: number }).etaMinutes).toBeGreaterThan(0);
        expect(session.dispatch({ type: 'cancelRoute', soldier: walker.id }).ok).toBe(true);
      }
    });
  }

  const drassenAirportSaves = worldSaves.filter((file) => {
    const { sector } = parseSaveHeader(new Uint8Array(readFileSync(join(savesDir, file)))).header;
    return sector.x === DRASSEN_AIRPORT.x && sector.y === DRASSEN_AIRPORT.y && sector.z === 0;
  });

  it.skipIf(drassenAirportSaves.length === 0)(
    'stands the helicopter on the Drassen helipad of a save made at the airport before Skyrider is met, its fuselage blocking the path',
    async () => {
      const bytes = new Uint8Array(readFileSync(join(savesDir, drassenAirportSaves[0] ?? '')));
      const { session } = await createSaveSession(read, bytes, undefined, (p) => data.vfs.stat(p) !== undefined);
      expect(session.campaign.state.forces.helicopter.setUp).toBe(false);
      const t = session.sim.state;
      expect(t.landedHelicopter?.gridNo).toBe(DRASSEN_HELIPAD);
      const pieces = (session.view().tileChanges ?? []).filter((c) => c.kind === 'append');
      expect(pieces.map((c) => c.gridNo)).toEqual([
        DRASSEN_HELIPAD,
        DRASSEN_HELIPAD,
        DRASSEN_HELIPAD - 800,
        DRASSEN_HELIPAD,
        DRASSEN_HELIPAD,
        DRASSEN_HELIPAD - 800,
      ]);
      const vehicles = (g: number) => t.world.structures.at(g).filter((s) => (s.flags & StructureFlags.VEHICLE) !== 0).length;
      expect([vehicles(DRASSEN_HELIPAD), vehicles(DRASSEN_HELIPAD - 800)]).toEqual([2, 1]);
      expect(t.world.costs.get(DRASSEN_HELIPAD, Direction.NORTH, 0)).toBe(TravelCost.OBSTACLE);
    },
  );
});
