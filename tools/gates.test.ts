import { describe, expect, it } from 'vitest';
import { GATES, gatesFor } from './gates.ts';

const gates = (...paths: string[]) => [...gatesFor(paths).keys()];

describe('the gates a change selects', () => {
  it('runs nothing for documentation alone', () => {
    expect(gates('docs/28-player-ui.md', 'CLAUDE.md', '.github/workflows/ci.yml')).toEqual([]);
  });

  it('runs the simulation gates for the simulation and its content', () => {
    expect(gates('src/sim/tactical/perception/los.ts')).toEqual(['check', 'data', 'reload', 'oracle', 'e2e', 'e2e:data']);
    expect(gates('data/tables/items.json')).toEqual(['check', 'data', 'reload', 'oracle', 'e2e', 'e2e:data']);
  });

  it('leaves the reload and oracle runs out for the client', () => {
    expect(gates('src/render/world/dirty-rects.ts', 'src/ui/screens/map/map-screen.ts')).toEqual(['check', 'data', 'e2e', 'e2e:data']);
  });

  it('adds the three browsers for the canvas presentation', () => {
    expect(gates('src/app/game/game-page.ts')).toEqual(['check', 'data', 'e2e', 'e2e:data', 'e2e:browsers']);
    expect(gates('src/ui/resolution.ts')).toContain('e2e:browsers');
  });

  it('runs a test suite for its own specs', () => {
    expect(gates('tests/e2e/talk-panel.spec.ts')).toEqual(['check', 'e2e']);
    expect(gates('tests/e2e-data/tour.spec.ts')).toEqual(['check', 'e2e:data']);
    expect(gates('tools/oracle/compare.ts')).toEqual(['check', 'oracle']);
  });

  it('runs the unit gates alone for a unit test', () => {
    expect(gates('src/ui/screens/map/map-screen.test.ts')).toEqual(['check', 'data', 'reload']);
    expect(gates('src/sim/tactical/perception/los.test.ts')).toEqual(['check', 'data', 'reload']);
  });

  it('runs every gate for dependencies and for a path no area knows', () => {
    expect(gates('pnpm-lock.yaml')).toEqual([...GATES]);
    expect(gates('somewhere/new.txt')).toEqual([...GATES]);
  });

  it('names the first changed file that selected each gate', () => {
    expect(Object.fromEntries(gatesFor(['src/ui/a.ts', 'src/sim/b.ts']))).toEqual({
      check: 'src/ui/a.ts',
      data: 'src/ui/a.ts',
      reload: 'src/sim/b.ts',
      oracle: 'src/sim/b.ts',
      e2e: 'src/ui/a.ts',
      'e2e:data': 'src/ui/a.ts',
    });
  });
});
