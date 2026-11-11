import { describe, expect, it } from 'vitest';
import { gamePageUrl, openPageUrl, reachablePage } from './open-page.ts';

describe('developer hub pages', () => {
  it('opens the game page with the chosen debug flags', () => {
    expect(gamePageUrl('sandbox-3', [])).toBe('/play?session=sandbox-3');
    expect(
      gamePageUrl('a b', [
        ['shadowHints', '1'],
        ['drive', 'manual'],
      ]),
    ).toBe('/play?session=a%20b&shadowHints=1&drive=manual');
    expect(openPageUrl('play', 'x', [['pinClock', '1']])).toBe('/play?session=x&pinClock=1');
  });

  it('opens the strategic and tactical developer pages without the flags', () => {
    expect(openPageUrl('strategic', 'sandbox-3', [['shadowHints', '1']])).toBe('/src/devtools/strategic/?session=sandbox-3');
    expect(openPageUrl('tactical', 'a b', [])).toBe('/src/devtools/tactical/?session=a%20b');
  });

  it('falls back to the page the session has: strategic before landing, tactical in a sandbox', () => {
    const campaignInFlight = { strategic: true, tactical: false };
    const sandbox = { strategic: false, tactical: true };
    expect(reachablePage('tactical', campaignInFlight)).toBe('strategic');
    expect(reachablePage('strategic', sandbox)).toBe('tactical');
    expect(reachablePage('play', campaignInFlight)).toBe('play');
    expect(reachablePage('tactical', { strategic: true, tactical: true })).toBe('tactical');
  });
});
