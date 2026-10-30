import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../tests/support/original-data.ts';
import { parseSaveGame } from '../content/formats/savegame.ts';
import { parseSaveEncryptionTable, parseSaveHeader, SAVE_ENCRYPTION_PATH, SAVE_HEADER_BYTES } from '../content/formats/savegame-header.ts';
import { layoutOffsets } from '../content/formats/savegame-layout.ts';
import { TACTICAL_STATUS_LAYOUT } from '../content/formats/savegame-tactical.ts';
import { withGraphicFacts } from '../content/rules/graphic-facts.ts';
import { vfsFileReader } from '../content/vfs/vfs.ts';
import { StructureFlags } from '../content/world/structures.ts';
import { type DataVfs, openDataVfs } from '../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../node/repo.ts';
import { musicMode } from '../protocol/music.ts';
import { MusicMode, musicModeOfNativeByte } from '../protocol/music-modes.ts';
import { advance } from '../sim/advance.ts';
import { importNativeGameOptions, SAVE_MODES } from '../sim/options.ts';
import { LightSpriteFlags, lightTimeAt } from '../sim/tactical/lighting/lighting.ts';
import { inLoadedSector } from '../sim/tactical/save-import.ts';
import { Team } from '../sim/tactical/soldier.ts';
import { whoIsThere } from '../sim/tactical/state.ts';
import { createSaveSession } from './save-session.ts';

const DOOR_OPEN = 0x01;
const ENEMY_TURN_BUDGET = 40_000;
const AIM_MERC_KIND = 1;
const MINUTES_PER_DAY = 1440;
const MINUTES_PER_HOUR = 60;
const WINDOWS_WORLD_LOADED_OFFSET = 301;
const dataDir = ORIGINAL_DATA_DIR;
const gameRoot = basename(dataDir).toLowerCase() === 'data' ? dirname(dataDir) : dataDir;
const savesDir = join(gameRoot, 'SavedGames');
const saveFiles = dataDir && existsSync(savesDir) ? readdirSync(savesDir).filter((f) => f.toLowerCase().endsWith('.sav')) : [];

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

  it.skipIf(saveFiles.length === 0)(
    'continues a save made with no sector loaded on the map screen without reading a map, and a squad sent on loads its sector',
    async () => {
      const file = [...saveFiles].sort()[0] ?? '';
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
      const enter = { type: 'enterSector', sector: target };
      await session.prepare(enter);
      expect(session.dispatch(enter)).toMatchObject({ ok: true, data: { sector: target } });
      expect(c.state.flow).toBe('tactical');
      expect(walker.soldier.placed).toBe(true);
      expect(advance(session, { ticks: 200 * 10 }, 200 * 10).reason).not.toBe('budget');
    },
  );

  it.skipIf(saveFiles.length === 0)(
    'starts the first arrival from a save made before it, as a new game does, when time first runs',
    async () => {
      const bytes = withoutWorld([...saveFiles].sort()[0] ?? '', true);
      const { session } = await createSaveSession(read, bytes, undefined, (p) => data.vfs.stat(p) !== undefined);
      const c = session.campaign;
      expect([c.state.didGameJustStart, c.state.flow, c.tactical]).toEqual([true, 'strategic', null]);
      const compress = { type: 'compressTime', mode: 4 };
      await session.prepare(compress);
      expect(session.dispatch(compress)).toEqual({ ok: true });
      expect([c.state.didGameJustStart, c.state.flow, c.state.worldSector]).toEqual([false, 'tactical', { x: 9, y: 1, z: 0 }]);
      expect(session.drainEvents().find((e) => e.type === 'sectorLoaded')).toMatchObject({ sector: 'A9', firstArrival: true });
    },
  );

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
      expect(session.campaign.tactical?.state.options).toBe(options);
      expect(report.droppedOptions).toEqual(saved.turnTimeLimit ? ['turnTimeLimit'] : []);
      expect(session.initialMusic).toEqual({ mode: musicModeOfNativeByte(save.generalInfo.musicMode), previous: MusicMode.MAIN_MENU });
      expect(session.initialMusic.mode).not.toBe(MusicMode.RESTORE);
      expect(musicMode(session.initialMusic, session.drainEvents(), session.musicFacts()).mode).toBe(session.initialMusic.mode);
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

  for (const file of saveFiles) {
    it(`imports the doors, key rings, key table and civilian groups of ${file}`, async () => {
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
    });
  }

  for (const file of saveFiles) {
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
        if (door) expect((door.flags & StructureFlags.OPEN) !== 0).toBe((d.flags & DOOR_OPEN) !== 0);
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
});
