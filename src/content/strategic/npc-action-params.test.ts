import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import { parseJsonc } from './jsonc.ts';
import { NPC_ACTION_PARAMS_PATH, parseNpcActionParams } from './npc-action-params.ts';

describe('NPC action parameters', () => {
  it('reads the gridnos and amounts of the externalized table by action code', () => {
    const table = parseNpcActionParams(parseJsonc(readFileSync(join(PROJECT_DATA_DIR, NPC_ACTION_PARAMS_PATH), 'utf8')));
    expect(table.get(100)).toEqual({ gridNo: 7887 });
    expect(table.get(123)).toEqual({ gridNo: 14952, amount: 10000 });
    expect(table.get(157)).toEqual({ amount: 10000 });
    expect(table.get(158)).toBeUndefined();
  });
});
