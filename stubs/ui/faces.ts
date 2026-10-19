import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { asArray, asInt, asObject } from '../../src/content/strategic/json-fields.ts';
import { PROJECT_DATA_DIR } from '../../src/node/repo.ts';
import { portraitPath } from '../../src/ui/widgets/portrait.ts';
import { encodeStubAsset } from './skin.ts';

const STUB_PROFILES_FILE = 'profiles.json';
const AIM_MEMBERS_TABLE = 'tables/ui-constants/AIMMembers.json';
const SMALL_FACE = { width: 48, height: 43 };

async function stubFaceIndices(): Promise<number[]> {
  const json = asObject(JSON.parse(await readFile(join(import.meta.dirname, '..', STUB_PROFILES_FILE), 'utf8')), 'stub profiles');
  return asArray(json.profiles, 'stub profiles').map((p, i) => {
    const o = asObject(p, `stub profiles[${i}]`);
    const face = o.face === undefined ? null : asObject(o.face, `stub profiles[${i}].face`);
    return face?.index === undefined ? asInt(o.id, `stub profiles[${i}].id`) : asInt(face.index, `stub profiles[${i}].face.index`);
  });
}

async function bigFaceSize(): Promise<{ width: number; height: number }> {
  const constants = asObject(
    asObject(JSON.parse(await readFile(join(PROJECT_DATA_DIR, AIM_MEMBERS_TABLE), 'utf8')), 'AIMMembers').constants,
    'constants',
  );
  return { width: asInt(constants.FACE_WIDTH, 'FACE_WIDTH'), height: asInt(constants.FACE_HEIGHT, 'FACE_HEIGHT') };
}

export async function buildStubFaces(out: string, exists: (path: string) => boolean): Promise<string[]> {
  const big = await bigFaceSize();
  const written: string[] = [];
  for (const face of [...new Set(await stubFaceIndices())].sort((a, b) => a - b)) {
    for (const [size, metrics] of [
      ['small', SMALL_FACE],
      ['big', big],
    ] as const) {
      const path = portraitPath(face, size);
      if (exists(path)) continue;
      const bytes = await encodeStubAsset({
        path,
        kind: 'sti',
        frames: [{ width: metrics.width, height: metrics.height, state: 'plain', hollow: false }],
        animated: 0,
        layouts: [],
      });
      await mkdir(dirname(join(out, path)), { recursive: true });
      await writeFile(join(out, path), bytes);
      written.push(path);
    }
  }
  return written;
}
