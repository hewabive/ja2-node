import { describe, expect, it } from 'vitest';
import { gamePageUrl } from './play-flags.ts';

describe('developer hub game links', () => {
  it('opens the game page on the session with the chosen debug flags', () => {
    expect(gamePageUrl('sandbox-3', [])).toBe('/play?session=sandbox-3');
    expect(
      gamePageUrl('a b', [
        ['shadowHints', '1'],
        ['drive', 'manual'],
      ]),
    ).toBe('/play?session=a%20b&shadowHints=1&drive=manual');
  });
});
