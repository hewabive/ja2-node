import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { replaceStubPack, type StubPackInputs, stubInputsDigest, stubPackMatches } from './ensure.ts';

const SOURCES: Readonly<Record<string, string>> = {
  'gen/build.ts': "import { b } from './a.ts';\nexport async function load() {\n  return import('../lib/c.ts');\n}\n",
  'gen/a.ts': "export {\n  b,\n} from '../lib/b.ts';\n",
  'gen/unused.ts': 'export const unused = 1;\n',
  'lib/b.ts': 'export const b = 1;\n',
  'lib/c.ts': 'export const c = 1;\n',
  'lib/other.ts': 'export const other = 1;\n',
  'data/table.json': '{}\n',
  'data/table.test.ts': 'export {};\n',
  'pnpm-lock.yaml': 'lock\n',
};

describe('stub pack inputs', () => {
  let root: string;
  let inputs: StubPackInputs;

  const edit = (file: string) => writeFile(join(root, file), `${SOURCES[file]}// edited\n`);

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ja2-stub-inputs-'));
    for (const [file, text] of Object.entries(SOURCES)) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), text);
    }
    inputs = {
      root,
      entry: join(root, 'gen/build.ts'),
      trees: [join(root, 'data')],
      files: [join(root, 'pnpm-lock.yaml')],
      runtime: 'v24',
    };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('is stable while nothing changes', () => {
    expect(stubInputsDigest(inputs)).toBe(stubInputsDigest(inputs));
  });

  it.each(['gen/build.ts', 'lib/b.ts', 'lib/c.ts', 'data/table.json', 'pnpm-lock.yaml'])('changes when %s changes', async (file) => {
    const before = stubInputsDigest(inputs);
    await edit(file);
    expect(stubInputsDigest(inputs)).not.toBe(before);
  });

  it.each(['gen/unused.ts', 'lib/other.ts', 'data/table.test.ts'])('ignores %s', async (file) => {
    const before = stubInputsDigest(inputs);
    await edit(file);
    expect(stubInputsDigest(inputs)).toBe(before);
  });

  it('changes with the runtime', () => {
    expect(stubInputsDigest({ ...inputs, runtime: 'v25' })).not.toBe(stubInputsDigest(inputs));
  });
});

describe('stub pack replacement', () => {
  let parent: string;
  let pack: string;

  const writePack = (marker: string) => async (dir: string) => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'marker.txt'), marker);
    return ['marker.txt'];
  };

  beforeEach(async () => {
    parent = await mkdtemp(join(tmpdir(), 'ja2-stub-replace-'));
    pack = join(parent, 'stubs');
  });

  afterEach(async () => {
    await rm(parent, { recursive: true, force: true });
  });

  it('builds a missing pack and records its inputs', async () => {
    expect(stubPackMatches(pack, 'one')).toBe(false);
    expect(await replaceStubPack(pack, writePack('first'), 'one')).toEqual(['marker.txt']);
    expect(await readFile(join(pack, 'marker.txt'), 'utf8')).toBe('first');
    expect(stubPackMatches(pack, 'one')).toBe(true);
    expect(stubPackMatches(pack, 'two')).toBe(false);
  });

  it('swaps the whole directory and leaves no temporary siblings', async () => {
    await replaceStubPack(pack, writePack('first'), 'one');
    await writeFile(join(pack, 'stale.txt'), 'left over');
    await replaceStubPack(pack, writePack('second'), 'two');
    expect(await readdir(pack)).toEqual(['marker.txt']);
    expect(await readFile(join(pack, 'marker.txt'), 'utf8')).toBe('second');
    expect(stubPackMatches(pack, 'two')).toBe(true);
    expect((await readdir(parent)).sort()).toEqual(['stubs', 'stubs.inputs']);
  });

  it('keeps the previous pack when the build fails', async () => {
    await replaceStubPack(pack, writePack('first'), 'one');
    const failing = async (dir: string): Promise<string[]> => {
      await writePack('broken')(dir);
      throw new Error('build failed');
    };
    await expect(replaceStubPack(pack, failing, 'two')).rejects.toThrow('build failed');
    expect(await readFile(join(pack, 'marker.txt'), 'utf8')).toBe('first');
    expect(stubPackMatches(pack, 'one')).toBe(true);
    expect((await readdir(parent)).sort()).toEqual(['stubs', 'stubs.inputs']);
  });

  it('does not trust a recorded digest without the pack', async () => {
    await replaceStubPack(pack, writePack('first'), 'one');
    await rm(pack, { recursive: true });
    expect(stubPackMatches(pack, 'one')).toBe(false);
  });
});
