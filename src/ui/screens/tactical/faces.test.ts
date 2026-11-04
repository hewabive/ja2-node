import { describe, expect, it } from 'vitest';
import type { SoldierView } from '../../../protocol/view.ts';
import { StaticImageCatalog } from '../../assets.ts';
import { DrawList } from '../../draw-list.ts';
import type { BitmapFont } from '../../text/bitmap-font.ts';
import {
  drawFace,
  FaceAnimator,
  type FaceRecord,
  FaceShade,
  faceHighlight,
  MOVING_HILIGHT,
  NO_HILIGHT,
  STEALTH_MOVING_HILIGHT,
  shadeOf,
  WHITE_HILIGHT,
} from './faces.ts';

const FACE = 'faces/33.sti';
const ANIMATED_FACE_FRAMES = 8;
const BLINK_MS = 3000;
const RECORD: FaceRecord = { path: FACE, eyes: [10, 12], mouth: [10, 24], blinkFrequency: BLINK_MS, expressionFrequency: 2000 };
const NO_OVERLAYS = { highlight: null, compatible: false, hatched: true, deadPanelRunning: false, textOver: null };
const ART = { hatch: 'interface/hatch.sti', dead: 'interface/dead.sti', icons: 'interface/icons.sti' };
const DIGIT_GLYPHS = 10;
const DIGIT_ZERO = 0x30;
const TINY_FONT: BitmapFont = {
  id: 'tinyfont1',
  table: new Map(Array.from({ length: DIGIT_GLYPHS }, (_, k) => [DIGIT_ZERO + k, k] as const)),
  glyphs: Array.from({ length: DIGIT_GLYPHS }, () => ({ width: 4, height: 7, offsetX: 0, offsetY: 0 })),
};

function catalog(): StaticImageCatalog {
  const images = new StaticImageCatalog();
  const frame = { width: 48, height: 43, offsetX: 0, offsetY: 0 };
  images.set(FACE, { kind: 'indexed', frames: Array.from({ length: ANIMATED_FACE_FRAMES }, () => frame), animatedFrames: 0 });
  return images;
}

describe('the face in the team panel', () => {
  it('shades the blinking eyes like the face of a merc out of action points in combat', () => {
    const images = catalog();
    const face = new FaceAnimator(RECORD, 0, () => 0);
    const soldier = { id: 2, life: 60, ap: 0 } as SoldierView;
    face.update(BLINK_MS + 1, soldier, null, images);
    face.update(BLINK_MS + 200, soldier, null, images);
    expect(face.eyeFrame).toBeGreaterThan(0);
    const list = new DrawList();
    drawFace({ list, images, art: ART, fonts: { tiny: {} as BitmapFont }, inCombat: true }, soldier, face, 0, 0, NO_OVERLAYS);
    const faceFrames = list.items.filter((i) => i.kind === 'image' && i.asset === FACE);
    expect(faceFrames.map((i) => (i.kind === 'image' ? i.frame : -1))).toEqual([0, face.eyeFrame]);
    for (const item of faceFrames) expect(item.kind === 'image' && item.shade).toEqual(shadeOf(FaceShade.LITESHADE));
  });

  it('prints the opponent count, not the neutrals the merc also sees', () => {
    const images = catalog();
    const face = new FaceAnimator(RECORD, 0, () => 0);
    const seen: readonly number[] = [20, 116];
    const soldier = { id: 2, life: 60, sees: seen, opponents: 1 } as SoldierView;
    const list = new DrawList();
    drawFace({ list, images, art: ART, fonts: { tiny: TINY_FONT }, inCombat: false }, soldier, face, 0, 0, NO_OVERLAYS);
    const digits = list.items.flatMap((i) => (i.kind === 'glyphs' ? i.glyphs.map((g) => g.index) : []));
    expect(digits).toEqual([1]);
  });

  it('places each right icon at its own width times its place, so the adrenaline and drink icons overlap a wider blinded one', () => {
    const images = catalog();
    const iconFrame = (width: number, height: number) => ({ width, height, offsetX: 0, offsetY: 0 });
    images.set(ART.icons, {
      kind: 'indexed',
      frames: [...Array.from({ length: 6 }, () => iconFrame(12, 12)), iconFrame(15, 14), iconFrame(9, 15), iconFrame(10, 16)],
      animatedFrames: 0,
    });
    const face = new FaceAnimator(RECORD, 0, () => 0);
    const icons = (soldier: Partial<SoldierView>) => {
      const list = new DrawList();
      drawFace(
        { list, images, art: ART, fonts: { tiny: {} as BitmapFont }, inCombat: false },
        { id: 2, life: 60, ...soldier } as SoldierView,
        face,
        0,
        0,
        NO_OVERLAYS,
      );
      return list.items.flatMap((i) => (i.kind === 'image' && i.asset === ART.icons ? [[i.frame, i.x, i.y]] : []));
    };
    expect(icons({ blinded: true, adrenaline: 'active', drunk: 'feelingGood' })).toEqual([
      [6, 1, 28],
      [7, 10, 27],
      [8, 21, 26],
    ]);
    expect(icons({ adrenaline: 'crash', drunk: 'hungover' })).toEqual([[8, 1, 26]]);
    expect(icons({ adrenaline: 'active' })).toEqual([[7, 1, 27]]);
    expect(icons({})).toEqual([]);
  });
});

describe('the portrait flash of a merc being hit (HandleAutoFaces)', () => {
  const FLASH_STEP_MS = 150;

  it('flashes once as the hit starts and holds through a long hit, showing his normal shade, until the hit is over', () => {
    const images = catalog();
    const face = new FaceAnimator(RECORD, 0, () => 0);
    const hit = { id: 2, life: 60, ap: 5, gettingHit: true } as SoldierView;
    const over = { ...hit, gettingHit: false };
    const shades: FaceShade[] = [];
    for (const [at, soldier] of [
      [0, hit],
      [FLASH_STEP_MS, hit],
      [2 * FLASH_STEP_MS, hit],
      [10 * FLASH_STEP_MS, hit],
      [11 * FLASH_STEP_MS, over],
      [12 * FLASH_STEP_MS, hit],
    ] as const) {
      face.update(at, soldier, null, images);
      shades.push(face.shade(soldier, true));
    }
    expect(shades).toEqual([
      FaceShade.STARTSHADE,
      FaceShade.ENDSHADE,
      FaceShade.NOSHADE,
      FaceShade.NOSHADE,
      FaceShade.NOSHADE,
      FaceShade.STARTSHADE,
    ]);
  });
});

describe('the portrait flash at bleeding, gas and electric damage (Soldier_Control.cc FlashSoldierPortrait)', () => {
  const FLASH_STEP_MS = 150;

  it('starts the flash again from its first shade, even mid-flash, and stops it with no hit to hold it', () => {
    const images = catalog();
    const face = new FaceAnimator(RECORD, 0, () => 0);
    const merc = { id: 2, life: 60, ap: 5 } as SoldierView;
    face.flash(0);
    face.update(FLASH_STEP_MS, merc, null, images);
    expect(face.shade(merc, true)).toBe(FaceShade.ENDSHADE);
    face.flash(FLASH_STEP_MS);
    expect(face.shade(merc, true)).toBe(FaceShade.STARTSHADE);
    face.update(3 * FLASH_STEP_MS, merc, null, images);
    expect(face.shade(merc, true)).toBe(FaceShade.NOSHADE);
  });
});

describe('the face highlight', () => {
  const at = 1000;
  const merc = { id: 2, life: 60, gridNo: at, destination: at } as SoldierView;

  it('is white under the pointer, else blue while the merc has a destination to reach, yellow sneaking', () => {
    expect(faceHighlight(merc, true)).toBe(WHITE_HILIGHT);
    expect(faceHighlight(merc, false)).toBe(NO_HILIGHT);
    expect(faceHighlight({ ...merc, destination: at + 1 }, false)).toBe(MOVING_HILIGHT);
    expect(faceHighlight({ ...merc, destination: at + 1, stealth: true }, false)).toBe(STEALTH_MOVING_HILIGHT);
  });

  it('draws nothing for a merc below OKLIFE with a destination, not even the black box that clears it', () => {
    expect(faceHighlight({ ...merc, life: 10, destination: at + 1 }, false)).toBeNull();
  });
});
