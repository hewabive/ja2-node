import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseSaveGame } from '../content/formats/savegame.ts';
import { parseSaveEncryptionTable, SAVE_ENCRYPTION_PATH } from '../content/formats/savegame-header.ts';
import { StructureFlags } from '../content/world/structures.ts';
import { type DataVfs, openDataVfs } from '../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../node/repo.ts';
import { advance } from '../sim/advance.ts';
import { LightSpriteFlags, lightTimeAt } from '../sim/tactical/lighting/lighting.ts';
import { inLoadedSector } from '../sim/tactical/save-import.ts';
import { Team } from '../sim/tactical/soldier.ts';
import { whoIsThere } from '../sim/tactical/state.ts';
import { createSaveSession } from './save-session.ts';

const DOOR_OPEN = 0x01;
const ENEMY_TURN_BUDGET = 40_000;
const dataDir = process.env.JA2_DATA_DIR ?? '';
const gameRoot = basename(dataDir).toLowerCase() === 'data' ? dirname(dataDir) : dataDir;
const savesDir = join(gameRoot, 'SavedGames');
const saveFiles = dataDir && existsSync(savesDir) ? readdirSync(savesDir).filter((f) => f.toLowerCase().endsWith('.sav')) : [];

describe.skipIf(!process.env.JA2_DATA_DIR)('native savegames imported into the tactical simulation', () => {
  let data: DataVfs;
  const read = async (p: string) => (data.vfs.stat(p) ? data.vfs.read(p) : null);

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir });
  });
  afterAll(async () => {
    await data.close();
  });

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
      if (t.inCombat && t.turn.currentTeam === Team.OUR) {
        expect(session.sim.dispatch({ type: 'endTurn' }).ok).toBe(true);
        expect(advance(session, { idle: true }, ENEMY_TURN_BUDGET).reason).not.toBe('budget');
        expect(t.turn.currentTeam).toBe(Team.OUR);
      }
    });
  }
});
