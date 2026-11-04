import { describe, expect, it } from 'vitest';
import { readDataJson } from '../../../tests/support/tactical.ts';
import { surfaceId } from './surface-choice.ts';
import { ANIM_CONTROL_PATH, ANIM_SURFACES_PATH, parseAnimationTables } from './tables.ts';
import { zStripSourceFrame } from './zstrip-frames.ts';

const tables = parseAnimationTables(readDataJson(ANIM_CONTROL_PATH), readDataJson(ANIM_SURFACES_PATH));
const STRUCTURES = 8;
const PRONE_FRAMES = 232;
const PRONE_FRAMES_PER_DIRECTION = 29;
const EAST_STRUCTURE = 3;

function frames(surfaceName: string, frameCount: number): (number | null)[] {
  const surface = surfaceId(tables, surfaceName);
  return Array.from({ length: STRUCTURES }, (_, structure) => zStripSourceFrame(tables, surface, frameCount, STRUCTURES, structure));
}

describe('the frame each animation structure takes its z strips from', () => {
  it("is frame 5 of each facing for the regular male's prone sheet, frame 0 for the big man's and the woman's", () => {
    const facing = (structure: number) => structure * PRONE_FRAMES_PER_DIRECTION;
    expect(frames('RGMPRONE', PRONE_FRAMES)[EAST_STRUCTURE]).toBe(facing(EAST_STRUCTURE) + 5);
    expect(frames('BGMPRONE', PRONE_FRAMES)[EAST_STRUCTURE]).toBe(facing(EAST_STRUCTURE));
    expect(frames('RGFPRONE', PRONE_FRAMES)[EAST_STRUCTURE]).toBe(facing(EAST_STRUCTURE));
  });

  it("steps by the frame count over the structure count: every fourth frame of a vehicle's 32 facings", () => {
    expect(frames('HUMVEE_BASIC', 32)).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
    expect(frames('HUMVEE_DIE', 18)).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
  });

  it("gives the queen's sheets one strip, from their first frame, for the one structure she uses", () => {
    expect(frames('QUEENMONSTERSTANDING', 31)).toEqual([0, null, null, null, null, null, null, null]);
    expect(frames('QUEENMONSTERSWIPE', 17)).toEqual([0, null, null, null, null, null, null, null]);
  });

  it('has no strip past the last frame or the last structure', () => {
    const prone = surfaceId(tables, 'RGMPRONE');
    expect(zStripSourceFrame(tables, prone, 4, STRUCTURES, 0)).toBeNull();
    expect(zStripSourceFrame(tables, prone, PRONE_FRAMES, STRUCTURES, STRUCTURES)).toBeNull();
  });
});
