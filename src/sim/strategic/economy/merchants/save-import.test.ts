import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadMerchantTestContent, type MerchantTestContent, merchantFixture } from '../../../../../tests/support/merchants.ts';
import { parseSaveGame } from '../../../../content/formats/savegame.ts';
import { parseSaveEncryptionTable } from '../../../../content/formats/savegame-header.ts';
import { readSavedMerchants, SAVED_ARMS_DEALERS } from '../../../../content/formats/savegame-merchants.ts';
import { DealerType } from '../../../../content/strategic/merchant-content.ts';
import { importMerchants } from './save-import.ts';
import { activeSpecials } from './state.ts';

const dataDir = process.env.JA2_DATA_DIR ?? '';
const savesDir = join(dirname(dataDir), 'SavedGames');
const saveFiles = dataDir && existsSync(savesDir) ? readdirSync(savesDir).filter((f) => f.toLowerCase().endsWith('.sav')) : [];
const TONY = 0;
const MAX_TONY_AMMO_TYPES = 8;

let t: MerchantTestContent;

beforeAll(async () => {
  t = await loadMerchantTestContent();
});

describe.skipIf(!process.env.JA2_DATA_DIR)('arms dealers imported from the native saves (section 23)', () => {
  const encryption = parseSaveEncryptionTable(
    JSON.parse(readFileSync(join(import.meta.dirname, '../../../../../data/tables/save-encryption.json'), 'utf8')),
  );

  it.each(saveFiles)('%s', (file) => {
    const bytes = new Uint8Array(readFileSync(join(savesDir, file)));
    const save = parseSaveGame(bytes, encryption);
    const saved = readSavedMerchants(bytes, save.sections);
    expect(saved).toHaveLength(SAVED_ARMS_DEALERS);
    const { ctx } = merchantFixture(t);
    importMerchants(ctx.state, saved);
    for (const d of t.content.dealers) {
      const state = ctx.state.dealers[d.id];
      if (!state) throw new Error(`no dealer ${d.id}`);
      for (const h of state.headers) expect(h.total).toBe(h.perfect + activeSpecials(h));
      if (d.type === DealerType.REPAIRS) {
        for (const h of state.headers) {
          expect(h.perfect).toBe(0);
          expect(h.specials.filter((s) => s.active).every((s) => s.info.condition < 0)).toBe(true);
        }
      }
    }
    const tonyAmmo = ctx.state.dealers[TONY]?.headers.filter((h, item) => h.total > 0 && t.items.byIndex.get(item)?.magazine);
    expect(tonyAmmo?.length).toBeLessThanOrEqual(MAX_TONY_AMMO_TYPES);
  });
});
