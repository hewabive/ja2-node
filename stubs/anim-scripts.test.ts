import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANIM_CONTROL_PATH, ANIM_SURFACES_PATH, parseAnimationTables, stateId } from '../src/content/anim/tables.ts';
import { MAX_FRAMES_PER_ANIM, parseAnimationScripts } from '../src/content/formats/ja2bin.ts';
import { PROJECT_DATA_DIR } from '../src/node/repo.ts';
import { buildStubAnimationScripts } from './anim-scripts.ts';

const NONINTERRUPTIBLE_DONE = 442;
const RESUME_FIRE = 476;
const UNJAM_STATES = [
  'STANDING_SHOOT_UNJAM',
  'CROUCH_SHOOT_UNJAM',
  'PRONE_SHOOT_UNJAM',
  'STANDING_SHOOT_DWEL_UNJAM',
  'CROUCH_SHOOT_DWEL_UNJAM',
  'PRONE_SHOOT_DWEL_UNJAM',
  'STANDING_SHOOT_LOW_UNJAM',
];

describe('stub animation scripts', () => {
  it('end every unjam animation by resuming the interrupted shot, as the original scripts do', async () => {
    const read = async (path: string) => JSON.parse(await readFile(join(PROJECT_DATA_DIR, path), 'utf8'));
    const tables = parseAnimationTables(await read(ANIM_CONTROL_PATH), await read(ANIM_SURFACES_PATH));
    const { codes } = parseAnimationScripts(await buildStubAnimationScripts());
    for (const name of UNJAM_STATES) {
      const start = stateId(tables, name) * MAX_FRAMES_PER_ANIM;
      const script = Array.from(codes.slice(start, start + MAX_FRAMES_PER_ANIM));
      const end = script.indexOf(0);
      expect(script.slice(end - 2, end), name).toEqual([NONINTERRUPTIBLE_DONE, RESUME_FIRE]);
    }
  });
});
