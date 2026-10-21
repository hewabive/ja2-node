import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { asInt, asObject } from '../../src/content/strategic/json-fields.ts';
import { PROJECT_DATA_DIR } from '../../src/node/repo.ts';
import { smallFace33Path } from '../../src/ui/screens/shop/shop-tile.ts';
import { stubFaceProfiles } from './faces.ts';
import { encodeStubAsset } from './skin.ts';

const SHOP_TABLE = 'tables/ui-constants/ShopKeeper_Interface.json';

async function ownerFaceSize(): Promise<{ width: number; height: number }> {
  const table = asObject(JSON.parse(await readFile(join(PROJECT_DATA_DIR, SHOP_TABLE), 'utf8')), 'ShopKeeper_Interface');
  const constants = asObject(table.constants, 'constants');
  return {
    width: asInt(constants.SKI_SMALL_FACE_WIDTH, 'SKI_SMALL_FACE_WIDTH'),
    height: asInt(constants.SKI_SMALL_FACE_HEIGHT, 'SKI_SMALL_FACE_HEIGHT'),
  };
}

export async function buildStubOwnerFaces(out: string, exists: (path: string) => boolean): Promise<string[]> {
  const size = await ownerFaceSize();
  const written: string[] = [];
  const faces = [...new Set((await stubFaceProfiles()).map((p) => p.faceIndex))].sort((a, b) => a - b);
  for (const face of faces) {
    const path = smallFace33Path(face);
    if (exists(path)) continue;
    const bytes = await encodeStubAsset({
      path,
      kind: 'sti',
      frames: [{ width: size.width, height: size.height, state: 'plain', hollow: false }],
      animated: 0,
      layouts: [],
      style: 'solid',
    });
    await mkdir(dirname(join(out, path)), { recursive: true });
    await writeFile(join(out, path), bytes);
    written.push(path);
  }
  return written;
}
