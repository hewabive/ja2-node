import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../../../tests/support/original-data.ts';
import { loadArmyTestContent, queenTestContext } from '../../../../tests/support/queen.ts';
import { loadStrategicTestContent } from '../../../../tests/support/strategic.ts';
import { parseSaveGame } from '../../../content/formats/savegame.ts';
import { parseSaveEncryptionTable } from '../../../content/formats/savegame-header.ts';
import { readStrategicAiSections } from '../../../content/formats/savegame-strategic-ai.ts';
import type { ArmyContent } from '../../../content/strategic/army.ts';
import { sectorFromId } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import { getGroup } from '../forces/groups.ts';
import { importStrategicMap } from '../map/save-import.ts';
import { sectorInfo } from '../map/sectors.ts';
import { createStrategicState } from '../state.ts';
import { importStrategicTime } from '../time/save-import.ts';
import { importStrategicAi } from './save-import.ts';

let content: StrategicContent;
let army: ArmyContent;

beforeAll(async () => {
  content = await loadStrategicTestContent();
  army = await loadArmyTestContent();
});

const dataDir = ORIGINAL_DATA_DIR;
const savesDir = join(dirname(dataDir), 'SavedGames');
const saveFiles = dataDir && existsSync(savesDir) ? readdirSync(savesDir).filter((f) => f.toLowerCase().endsWith('.sav')) : [];

describe.skipIf(!ORIGINAL_DATA_DIR)('importStrategicAi on the native saves', () => {
  const encryption = parseSaveEncryptionTable(
    JSON.parse(readFileSync(join(import.meta.dirname, '../../../../data/tables/save-encryption.json'), 'utf8')),
  );

  for (const file of saveFiles) {
    it(`imports ${file} with the load-time recomputation`, () => {
      const bytes = new Uint8Array(readFileSync(join(savesDir, file)));
      const save = parseSaveGame(bytes, encryption);
      const sections = readStrategicAiSections(bytes, save);
      const state = createStrategicState();
      importStrategicTime(state, save);
      const q = queenTestContext({ content, army, state });
      importStrategicMap(q, save);
      importStrategicAi(q, sections, { runLoadHooks: true });
      const queen = q.state.queen;
      expect(queen.awake).toBe(sections.ai.awake);
      expect(queen.compositions).toHaveLength(27);
      expect(q.state.status.playerKills).toBe(sections.status.playerKills);
      queen.garrisons.forEach((g, gi) => {
        expect(sectorInfo(q.state.map, sectorFromId(g.sector)).garrisonId).toBe(gi);
        if (g.pendingGroup) expect(getGroup(q, g.pendingGroup)?.player).toBe(false);
      });
      for (const p of queen.patrols) if (p.group) expect(getGroup(q, p.group)?.player).toBe(false);
      const positive =
        queen.garrisons.reduce((n, g) => n + Math.max(0, g.weight), 0) + queen.patrols.reduce((n, p) => n + Math.max(0, p.weight), 0);
      const negative = queen.garrisons.reduce((n, g) => n - Math.min(0, g.weight), 0);
      expect(queen.requestPoints).toBe(positive);
      expect(queen.reinforcementPoints).toBe(negative);
    });
  }
});
