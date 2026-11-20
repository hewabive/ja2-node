import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import { MessageText } from './message-text.ts';

describe('the Message string ids', () => {
  it('are the ids of the transcribed Text.h table', async () => {
    const table = JSON.parse(await readFile(join(PROJECT_DATA_DIR, 'tables/ui-constants/Text.json'), 'utf8')) as {
      constants: Record<string, unknown>;
    };
    const transcribed = Object.fromEntries(Object.keys(MessageText).map((name) => [name, table.constants[name]]));
    expect(transcribed).toEqual(MessageText);
  });
});
