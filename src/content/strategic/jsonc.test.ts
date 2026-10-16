import { describe, expect, it } from 'vitest';
import { parseJsonc } from './jsonc.ts';

describe('JSON with comments', () => {
  it('drops line and block comments outside strings', () => {
    expect(parseJsonc('/* head */ { "a": 1, // one\n "b": "x // not a comment /* nor this */" }')).toEqual({
      a: 1,
      b: 'x // not a comment /* nor this */',
    });
  });

  it('keeps escaped quotes inside strings', () => {
    expect(parseJsonc('["a\\"/*b*/"]')).toEqual(['a"/*b*/']);
  });
});
