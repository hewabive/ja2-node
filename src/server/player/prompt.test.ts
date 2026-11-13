import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import { completePath, expandHome } from './prompt.ts';

const tree: Readonly<Record<string, readonly string[]>> = {
  '/home/p/': ['Games', 'GOG Games', '.steam', 'Music'],
  '/home/p/Games/': ['Jagged Alliance 2 Gold'],
};
const list = (dir: string): string[] => [...(tree[dir] ?? [])];

describe('typing a folder in the setup', () => {
  it('expands the home folder', () => {
    expect(expandHome('~', '/home/p', posix)).toBe('/home/p');
    expect(expandHome('~/Games', '/home/p', posix)).toBe('/home/p/Games');
    expect(expandHome('/opt/~x', '/home/p', posix)).toBe('/opt/~x');
  });

  it('completes folder names after what was typed and keeps the typed home mark', () => {
    expect(completePath('/home/p/G', '/home/p', posix, list)).toEqual([['/home/p/GOG Games/', '/home/p/Games/'], '/home/p/G']);
    expect(completePath('~/Games/J', '/home/p', posix, list)).toEqual([['~/Games/Jagged Alliance 2 Gold/'], '~/Games/J']);
  });

  it('shows hidden folders only when their dot is typed', () => {
    expect(completePath('/home/p/', '/home/p', posix, list)[0]).not.toContain('/home/p/.steam/');
    expect(completePath('/home/p/.', '/home/p', posix, list)[0]).toEqual(['/home/p/.steam/']);
  });
});
