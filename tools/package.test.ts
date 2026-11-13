import { describe, expect, it } from 'vitest';
import { packageProblems, relocationProblems } from './package.ts';

const REQUIRED = [
  'bin/ja2-node.js',
  'dist/server/player.js',
  'dist/server/session-worker.js',
  'dist/server/engine.json',
  'dist/client/index.html',
  'dist/stubs/LICENSE.txt',
  'dist/stubs/NOTICE.txt',
  'LICENSE',
];

describe('the checks of a packed tarball', () => {
  const tracked = new Set(['data/tables/items.json']);

  it('accept the files the package ships', () => {
    expect(packageProblems([...REQUIRED, 'package.json', 'README.md', 'data/tables/items.json'], tracked)).toEqual([]);
  });

  it('refuse other files, data files git does not track, and missing entry points', () => {
    const entries = [...REQUIRED.filter((f) => f !== 'dist/server/engine.json'), '.ja2/token', 'data/extracted/maps.json'];
    expect(packageProblems(entries, tracked)).toEqual([
      '.ja2/token: not a file the package ships',
      'data/extracted/maps.json: not tracked by git',
      'dist/server/engine.json: missing',
    ]);
  });

  it('refuse a server bundle that finds its files through import.meta', () => {
    const bundles = [
      { path: 'dist/server/player.js', text: 'export const a = 1;' },
      { path: 'dist/server/chunks/x.js', text: "const dir = new URL('.', import.meta.url);" },
    ];
    expect(relocationProblems(bundles)).toEqual([
      'dist/server/chunks/x.js: uses import.meta, so the server would depend on where its files lie',
    ]);
  });
});
