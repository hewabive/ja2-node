import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../../../tests/support/original-data.ts';
import { decodeSti } from '../../../content/formats/sti.ts';
import { DEFAULT_VANILLA_VERSION } from '../../../content/text/data-version.ts';
import { type DataVfs, openDataVfs } from '../../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../../node/repo.ts';
import { LayoutLoader } from '../../layout/loader.ts';
import { ORIGINAL_SKIN } from '../../layout/types.ts';
import { BattleLayout } from './environment.ts';

const FRAMES_DRAWN: readonly (readonly [BattleLayout, string, number])[] = [
  [BattleLayout.PRE_BATTLE, 'panel', 5],
  [BattleLayout.PRE_BATTLE, 'button', 2],
  [BattleLayout.AUTORESOLVE, 'panel', 14],
  [BattleLayout.AUTORESOLVE, 'buttons', 18],
  [BattleLayout.AUTORESOLVE, 'faces', 16],
  [BattleLayout.AUTORESOLVE, 'indent', 1],
];

describe.skipIf(!ORIGINAL_DATA_DIR)('the battle art on the original data', () => {
  let data: DataVfs;

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
  });

  afterAll(async () => {
    await data.close();
  });

  it('holds every frame the pre-battle and autoresolve renderers draw', async () => {
    const loader = new LayoutLoader(async (path) => readFile(join(PROJECT_DATA_DIR, path), 'utf8'), DEFAULT_VANILLA_VERSION);
    for (const [layout, name, frames] of FRAMES_DRAWN) {
      const asset = (await loader.load(ORIGINAL_SKIN, layout)).asset(name);
      const sti = decodeSti(await data.vfs.read(asset.path), false);
      const count = sti.kind === 'rgb' ? 1 : sti.subImages.length;
      expect(count, `${layout} ${name} (${asset.path})`).toBeGreaterThanOrEqual(frames);
    }
  });
});
