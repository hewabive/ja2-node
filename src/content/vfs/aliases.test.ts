import { describe, expect, it } from 'vitest';
import { encodeVfsAliases, parseVfsAliases, VFS_ALIASES_FORMAT } from './aliases.ts';

describe('VFS alias manifests', () => {
  it('round-trips sorted, normalized aliases', () => {
    const text = encodeVfsAliases(
      new Map([
        ['Sounds/Door Open 02.wav', 'synth/sfx/door-open.wav'],
        ['sounds/door open 01.wav', 'synth/sfx/door-open.wav'],
      ]),
    );
    expect(text.indexOf('door open 01')).toBeLessThan(text.indexOf('door open 02'));
    expect([...parseVfsAliases(JSON.parse(text))]).toEqual([
      ['sounds/door open 01.wav', 'synth/sfx/door-open.wav'],
      ['sounds/door open 02.wav', 'synth/sfx/door-open.wav'],
    ]);
  });

  it('rejects other formats, self references and chains', () => {
    expect(() => parseVfsAliases({ format: 'x', aliases: {} })).toThrow(/format/);
    expect(() => parseVfsAliases({ format: VFS_ALIASES_FORMAT, aliases: { a: 'A' } })).toThrow(/itself/);
    expect(() => parseVfsAliases({ format: VFS_ALIASES_FORMAT, aliases: { a: 'b', b: 'c' } })).toThrow(/another alias/);
  });
});
