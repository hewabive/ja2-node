import { describe, expect, it } from 'vitest';
import { parsePlayerArgs, UsageError } from './main.ts';

describe('the ja2-node command line', () => {
  it('starts and opens the browser by default', () => {
    expect(parsePlayerArgs([])).toEqual({ kind: 'start', flags: {}, open: true });
    expect(parsePlayerArgs(['start', '--no-open'])).toEqual({ kind: 'start', flags: {}, open: false });
  });

  it('takes the settings of one run as options', () => {
    expect(parsePlayerArgs(['--data', '/games/ja2', '--host', '0.0.0.0', '--port', '7500'])).toEqual({
      kind: 'start',
      flags: { dataDir: '/games/ja2', host: '0.0.0.0', port: 7500 },
      open: true,
    });
    expect(parsePlayerArgs(['config', '--no-data'])).toEqual({ kind: 'config', flags: { dataDir: null }, open: true });
  });

  it('knows setup, help and version', () => {
    expect(parsePlayerArgs(['setup'])).toEqual({ kind: 'setup' });
    expect(parsePlayerArgs(['-h'])).toEqual({ kind: 'help' });
    expect(parsePlayerArgs(['config', '--version'])).toEqual({ kind: 'version' });
  });

  it('refuses what it does not know', () => {
    for (const argv of [['play'], ['start', 'now'], ['--port', '0'], ['--data', 'x', '--no-data'], ['--fast']])
      expect(() => parsePlayerArgs(argv), argv.join(' ')).toThrow(UsageError);
  });
});
