import { describe, expect, it } from 'vitest';
import type { SoldierView } from '../../../protocol/view.ts';
import { StaticImageCatalog } from '../../assets.ts';
import { DrawList } from '../../draw-list.ts';
import type { BitmapFont } from '../../text/bitmap-font.ts';
import { drawFace, FaceAnimator, type FaceRecord, FaceShade, shadeOf } from './faces.ts';

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
});
