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
    const art = { hatch: 'interface/hatch.sti', dead: 'interface/dead.sti', icons: 'interface/icons.sti' };
    drawFace({ list, images, art, fonts: { tiny: {} as BitmapFont }, inCombat: true }, soldier, face, 0, 0, NO_OVERLAYS);
    const faceFrames = list.items.filter((i) => i.kind === 'image' && i.asset === FACE);
    expect(faceFrames.map((i) => (i.kind === 'image' ? i.frame : -1))).toEqual([0, face.eyeFrame]);
    for (const item of faceFrames) expect(item.kind === 'image' && item.shade).toEqual(shadeOf(FaceShade.LITESHADE));
  });
});
