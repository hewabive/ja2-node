import { describe, expect, it } from 'vitest';
import { buildStubAnimationScripts } from '../../../stubs/anim-scripts.ts';
import { ORIGINAL_DATA_DIR } from '../../../tests/support/original-data.ts';
import { openDataVfs } from '../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import { type AnimationScripts, MAX_ANIMATIONS, MAX_FRAMES_PER_ANIM, parseAnimationScripts, scriptCode } from '../formats/ja2bin.ts';
import { vfsFileReader } from '../vfs/vfs.ts';
import { classifyCode, framesUntilStateChange } from './script.ts';
import {
  type AnimationTimelines,
  frameSlotOfSpriteFrame,
  isSimulationOpcode,
  loadAnimationTimelines,
  NO_FRAME_SLOT,
  OUTSIDE_SCRIPT_SLOT,
  readAnimationScripts,
  SlotKind,
  slotArgument,
  slotKind,
  splitAnimationScripts,
  spriteFrameAt,
  timelineLoops,
  timelineSlot,
  whiteFlashAt,
} from './timelines.ts';

const WALK = 0;
const STAND = 1;
const FIRE = 2;
const END_OF_ANIMATION = 499;
const STATE_JUMP_BASE = 600;

function scripts(map: Readonly<Record<number, readonly number[]>>): AnimationScripts {
  const codes = new Uint16Array(MAX_ANIMATIONS * MAX_FRAMES_PER_ANIM);
  for (const [state, list] of Object.entries(map)) codes.set(list, Number(state) * MAX_FRAMES_PER_ANIM);
  return { codes };
}

function framesThroughTimelines(timelines: AnimationTimelines, state: number): number[] {
  const frames: number[] = [];
  const seen = new Set<number>();
  let pc = 0;
  for (let guard = 0; guard < MAX_FRAMES_PER_ANIM * 4 && frames.length < MAX_FRAMES_PER_ANIM; guard++) {
    const slot = timelineSlot(state, pc);
    const kind = slotKind(timelines.logic, slot);
    if (kind === SlotKind.FRAME || kind === SlotKind.EMPTY) {
      if (seen.has(pc + 1)) break;
      seen.add(pc + 1);
      frames.push(spriteFrameAt(timelines.presentation, slot < 0 ? OUTSIDE_SCRIPT_SLOT : slot));
      pc++;
    } else if (kind === SlotKind.JUMP) pc = slotArgument(timelines.logic, slot);
    else if (kind === SlotKind.STATE) break;
    else pc++;
  }
  return frames;
}

function expectFaithfulSplit(source: AnimationScripts): void {
  const timelines = splitAnimationScripts(source);
  for (let state = 0; state < MAX_ANIMATIONS; state++) {
    for (let pc = 0; pc < MAX_FRAMES_PER_ANIM; pc++) {
      const raw = scriptCode(source, state, pc);
      const code = classifyCode(raw);
      const slot = timelineSlot(state, pc);
      const kind = slotKind(timelines.logic, slot);
      const arg = slotArgument(timelines.logic, slot);
      if (code.kind === 'frame') {
        expect(kind).toBe(raw === 0 ? SlotKind.EMPTY : SlotKind.FRAME);
        expect(spriteFrameAt(timelines.presentation, slot)).toBe(code.frame);
      } else if (code.kind === 'jump') expect([kind, arg]).toEqual([SlotKind.JUMP, code.pc]);
      else if (code.kind === 'state') expect([kind, arg]).toEqual([SlotKind.STATE, code.state]);
      else expect([kind, arg]).toEqual(isSimulationOpcode(raw) ? [SlotKind.OP, raw] : [SlotKind.NOP, 0]);
      expect(timelines.presentation.sounds[slot]).toBe(raw >= 700 && raw <= 799 ? raw : 0);
    }
    expect(framesThroughTimelines(timelines, state)).toEqual(framesUntilStateChange(source, state));
  }
}

describe('the white flash of a hit (Soldier_Ani.cc 438, 439; RenderWorld.cc RenderTiles)', () => {
  const STATE = 7;
  const FRAME = 3;
  const codes = (script: readonly number[]) => {
    const all = new Uint16Array(MAX_ANIMATIONS * MAX_FRAMES_PER_ANIM);
    all.set(script, timelineSlot(STATE, 0));
    return splitAnimationScripts({ codes: all }).presentation;
  };

  it('covers exactly the frames between the start and the end of the hold', () => {
    const shown = codes([FRAME, 431, 438, FRAME, FRAME, 439, FRAME, 499]);
    const flashes = [0, 3, 4, 6].map((pc) => whiteFlashAt(shown, timelineSlot(STATE, pc)));
    expect(flashes).toEqual([false, true, true, false]);
  });

  it('never covers a frame without the hold, nor the slots outside any script', () => {
    const shown = codes([431, FRAME, 499]);
    expect(whiteFlashAt(shown, timelineSlot(STATE, 1))).toBe(false);
    expect(whiteFlashAt(shown, NO_FRAME_SLOT)).toBe(false);
    expect(whiteFlashAt(shown, OUTSIDE_SCRIPT_SLOT)).toBe(false);
  });

  it('ends with the animation, which clears fForceShade', () => {
    const all = new Uint16Array(MAX_ANIMATIONS * MAX_FRAMES_PER_ANIM);
    all.set([438, FRAME], timelineSlot(STATE, 0));
    all.set([FRAME], timelineSlot(STATE + 1, 0));
    const { presentation } = splitAnimationScripts({ codes: all });
    expect(whiteFlashAt(presentation, timelineSlot(STATE + 1, 0))).toBe(false);
  });
});

describe('animation timelines', () => {
  const sample = scripts({
    [WALK]: [1, 750, 703, 2, 3, 757, 4, 501],
    [STAND]: [1, 2, 3, END_OF_ANIMATION],
    [FIRE]: [753, 1, 2, 3, STATE_JUMP_BASE + STAND],
  });

  it('keep every jump, transition and gameplay opcode in the logic part and every frame in the presentation part', () => {
    expectFaithfulSplit(sample);
    const { logic, presentation } = splitAnimationScripts(sample);
    expect(slotKind(logic, timelineSlot(WALK, 2))).toBe(SlotKind.NOP);
    expect(presentation.sounds[timelineSlot(WALK, 2)]).toBe(703);
    expect([slotKind(logic, timelineSlot(WALK, 5)), slotArgument(logic, timelineSlot(WALK, 5))]).toEqual([SlotKind.OP, 757]);
    expect(timelineLoops(logic, WALK)).toBe(true);
    expect(timelineLoops(logic, STAND)).toBe(false);
    expect(timelineLoops(logic, FIRE)).toBe(false);
  });

  it('give the slot outside a script and the slot before a first frame the sprite frames the scripts gave', () => {
    const { presentation } = splitAnimationScripts(sample);
    expect(timelineSlot(WALK, MAX_FRAMES_PER_ANIM)).toBe(OUTSIDE_SCRIPT_SLOT);
    expect(timelineSlot(-1, 0)).toBe(OUTSIDE_SCRIPT_SLOT);
    expect(spriteFrameAt(presentation, OUTSIDE_SCRIPT_SLOT)).toBe(-1);
    expect(spriteFrameAt(presentation, NO_FRAME_SLOT)).toBe(0);
  });

  it('map a saved sprite frame and code back to the slot that shows it', () => {
    const { presentation } = splitAnimationScripts(sample);
    expect(frameSlotOfSpriteFrame(presentation, WALK, 5, 2)).toBe(timelineSlot(WALK, 4));
    expect(frameSlotOfSpriteFrame(presentation, WALK, 6, 2)).toBe(timelineSlot(WALK, 4));
    expect(frameSlotOfSpriteFrame(presentation, WALK, 1, 0)).toBe(timelineSlot(WALK, 0));
    expect(frameSlotOfSpriteFrame(presentation, FIRE, 0, 0)).toBe(NO_FRAME_SLOT);
    expect(frameSlotOfSpriteFrame(presentation, WALK, 0, 1)).toBe(timelineSlot(WALK, 3));
    expect(frameSlotOfSpriteFrame(presentation, STAND, 4, 40)).toBe(NO_FRAME_SLOT);
    expect(frameSlotOfSpriteFrame(presentation, STAND, 4, -1)).toBe(timelineSlot(STAND, 4));
    for (const [state, pc, frame] of [
      [WALK, 5, 2],
      [WALK, 0, 1],
      [FIRE, 0, 0],
      [STAND, 4, -1],
    ] as const)
      expect(spriteFrameAt(presentation, frameSlotOfSpriteFrame(presentation, state, pc, frame))).toBe(frame);
  });

  it('split the stub scripts faithfully', async () => {
    expectFaithfulSplit(parseAnimationScripts(await buildStubAnimationScripts()));
  });

  it('are loaded once per reader, from the stub scripts when the original ones are missing', async () => {
    const stub = await buildStubAnimationScripts();
    const reads: string[] = [];
    const read = async (path: string) => {
      reads.push(path);
      return path === 'stubs/binarydata/ja2bin.dat' ? stub : null;
    };
    const first = await loadAnimationTimelines(read);
    expect(await loadAnimationTimelines(read)).toBe(first);
    expect(reads).toEqual(['binarydata/ja2bin.dat', 'stubs/binarydata/ja2bin.dat']);
    expect(await loadAnimationTimelines(async () => null)).toBeNull();
  });
});

describe.skipIf(!ORIGINAL_DATA_DIR)('animation timelines of the original scripts', () => {
  it('split the original scripts faithfully', async () => {
    const data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: ORIGINAL_DATA_DIR });
    try {
      const bytes = await readAnimationScripts(vfsFileReader(data.vfs));
      if (!bytes) throw new Error('no animation scripts');
      expectFaithfulSplit(parseAnimationScripts(bytes));
    } finally {
      await data.close();
    }
  });
});
