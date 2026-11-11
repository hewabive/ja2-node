import { describe, expect, it } from 'vitest';
import { clientPagePath } from './client-pages.ts';

describe('client page aliases', () => {
  it('serves /play from the game page and keeps the query', () => {
    expect(clientPagePath('/play')).toBe('/src/app/game/index.html');
    expect(clientPagePath('/play/')).toBe('/src/app/game/index.html');
    expect(clientPagePath('/play?session=abc&scale=2')).toBe('/src/app/game/index.html?session=abc&scale=2');
  });

  it('serves /dev from the developer hub', () => {
    expect(clientPagePath('/dev')).toBe('/src/devtools/hub/index.html');
    expect(clientPagePath('/dev?session=abc')).toBe('/src/devtools/hub/index.html?session=abc');
  });

  it('leaves every other path alone', () => {
    expect(clientPagePath('/')).toBe('/');
    expect(clientPagePath('/player')).toBe('/player');
    expect(clientPagePath('/developer')).toBe('/developer');
    expect(clientPagePath('/src/devtools/tactical/?session=x')).toBe('/src/devtools/tactical/?session=x');
  });
});
