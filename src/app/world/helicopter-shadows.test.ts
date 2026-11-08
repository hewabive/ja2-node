import { describe, expect, it } from 'vitest';
import type { HelicopterDropView, HelicopterShadowView } from '../../protocol/view.ts';
import { cameraOnGridNo } from '../../render/world/camera.ts';
import { flyingAniTileOnScreen } from '../../render/world/dynamic-scene.ts';
import type { Viewport } from '../../render/world/geometry.ts';
import { HELI_SCRIPT_STEP_MS, MOVELARGERY_STEP } from '../../sim/tactical/helicopter-drop.ts';
import { cellCentre } from '../../sim/tactical/soldier.ts';
import { TEAMPANEL_HEIGHT } from '../../ui/layout/frames.ts';
import { HelicopterShadows, type ShadowOnScreen } from './helicopter-shadows.ts';

const FRAMES = 4;
const DELAY = 90;
const STEP = HELI_SCRIPT_STEP_MS;
const SHADOW = { gridNo: 1680, x: 795, y: 5, z: 0 };
const LEFT_BEHIND = { gridNo: 1680, x: 795, y: 121, z: -29 };
const NEXT_RUN = { gridNo: 1680, x: 785, y: 5, z: 0 };
const EVERYWHERE: ShadowOnScreen = () => true;
const SWEET_SPOT = 12880;
const HELI_OFFSET_X = 20;
const HELI_OFFSET_Y = 100;
const MOVETO_STEPS = 28;
const MOVEY_STEP = 4;
const MOVEAWAY_STEPS = 29;
const STEPS_FROM_THE_EXIT_TO_THE_END = 56;
const STEPS_ACROSS_A_WIDE_SCREEN = 49;
const STUB_SHADOW_SPRITE = { layer: 0, x: 0, y: 0, width: 96, height: 56, offsetX: -48, offsetY: -28 };
const REFERENCE_SCREEN: Viewport = { width: 640, height: 480 - TEAMPANEL_HEIGHT };
const WIDE_SCREEN: Viewport = { width: 1920, height: 1080 - TEAMPANEL_HEIGHT };

function running(...shadows: HelicopterShadowView[]): HelicopterDropView {
  return { running: true, engineVolume: 127, shadows };
}

function ended(...shadows: HelicopterShadowView[]): HelicopterDropView {
  return { running: false, engineVolume: 0, shadows };
}

function frameAt(clockMs: number): number {
  return Math.floor(clockMs / DELAY) % FRAMES;
}

function droppedAtTheExit(): HelicopterShadows {
  const shadows = new HelicopterShadows();
  shadows.update(running(SHADOW), 0, FRAMES, EVERYWHERE);
  expect(shadows.update(running(), 0, FRAMES, EVERYWHERE)).toHaveLength(1);
  return shadows;
}

function onTheScreen(viewport: Viewport): ShadowOnScreen {
  const screen = { viewport, camera: cameraOnGridNo(SWEET_SPOT), renderHeight: 0 };
  return (s) => flyingAniTileOnScreen(screen, 0, s, STUB_SHADOW_SPRITE);
}

function shadowAtTheExit(): HelicopterShadowView {
  const centre = cellCentre(SWEET_SPOT);
  const y = centre.y - HELI_OFFSET_Y + MOVETO_STEPS * MOVEY_STEP + MOVEAWAY_STEPS * MOVELARGERY_STEP;
  return { gridNo: SWEET_SPOT, x: centre.x - HELI_OFFSET_X, y, z: 0 };
}

function stepsDrawnAfterTheExit(viewport: Viewport): number {
  const shadows = new HelicopterShadows();
  shadows.update(running(shadowAtTheExit()), 0, FRAMES, onTheScreen(viewport));
  let drawn = 0;
  for (let step = 0; step < STEPS_FROM_THE_EXIT_TO_THE_END; step++)
    if (shadows.update(running(), step * STEP, FRAMES, onTheScreen(viewport)).length > 0) drawn = step + 1;
  return drawn;
}

describe('the helicopter shadow (HELI_SHOW_HELI, UpdateAniTiles)', () => {
  it('starts at the first frame where the view shows it and loops forward every 90 ms wherever the view moves it', () => {
    const shadows = new HelicopterShadows();
    expect(shadows.update(running(SHADOW), 1000, FRAMES, EVERYWHERE)).toEqual([{ ...SHADOW, frame: 0 }]);
    expect(shadows.update(running(SHADOW), 1000 + DELAY - 1, FRAMES, EVERYWHERE).map((s) => s.frame)).toEqual([0]);
    const moved = { ...SHADOW, y: 9, z: -1 };
    expect(shadows.update(running(moved), 1000 + DELAY, FRAMES, EVERYWHERE)).toEqual([{ ...moved, frame: 1 }]);
    expect(shadows.update(running(moved), 1000 + FRAMES * DELAY, FRAMES, EVERYWHERE).map((s) => s.frame)).toEqual([0]);
  });

  it('starts a shadow the view shows anew at its first frame, beside the one a skip left behind', () => {
    const shadows = new HelicopterShadows();
    shadows.update(ended(LEFT_BEHIND), 0, FRAMES, EVERYWHERE);
    expect(shadows.update(ended(LEFT_BEHIND, SHADOW), 2 * DELAY, FRAMES, EVERYWHERE).map((s) => s.frame)).toEqual([2, 0]);
    expect(shadows.update(ended(LEFT_BEHIND), 3 * DELAY, FRAMES, EVERYWHERE).map((s) => s.frame)).toEqual([3]);
    expect(shadows.update(ended(LEFT_BEHIND, SHADOW), 3 * DELAY, FRAMES, EVERYWHERE).map((s) => s.frame)).toEqual([3, 0]);
  });

  it('draws nothing until its sheet is loaded', () => {
    expect(new HelicopterShadows().update(running(SHADOW), 0, null, EVERYWHERE)).toEqual([]);
  });
});

describe('the helicopter shadow past HELI_GOTO_EXIT (REPEAT_HELI_MOVEAWAY on a wide screen)', () => {
  it('flies the shadow the run drops at the exit on south, one MOVELARGERY step a script step from the exit step itself, in its own frames', () => {
    const shadows = new HelicopterShadows();
    shadows.update(running(SHADOW), 0, FRAMES, EVERYWHERE);
    const dropAt = 2 * DELAY;
    expect(shadows.update(running(), dropAt, FRAMES, EVERYWHERE)).toEqual([{ ...SHADOW, y: SHADOW.y + MOVELARGERY_STEP, frame: 2 }]);
    expect(shadows.update(running(), dropAt + STEP - 1, FRAMES, EVERYWHERE).map((s) => s.y)).toEqual([SHADOW.y + MOVELARGERY_STEP]);
    const later = dropAt + 2 * STEP;
    expect(shadows.update(running(), later, FRAMES, EVERYWHERE)).toEqual([
      { ...SHADOW, y: SHADOW.y + 3 * MOVELARGERY_STEP, frame: frameAt(later) },
    ]);
  });

  it('is gone for good once its sprite has left the view, even when the view grows again', () => {
    let lowestOnScreen = SHADOW.y + 2 * MOVELARGERY_STEP;
    const onScreen: ShadowOnScreen = (s) => s.y <= lowestOnScreen;
    const shadows = new HelicopterShadows();
    shadows.update(running(SHADOW), 0, FRAMES, onScreen);
    expect(shadows.update(running(), 0, FRAMES, onScreen).map((s) => s.y)).toEqual([SHADOW.y + MOVELARGERY_STEP]);
    expect(shadows.update(running(), STEP, FRAMES, onScreen).map((s) => s.y)).toEqual([SHADOW.y + 2 * MOVELARGERY_STEP]);
    expect(shadows.update(running(), 2 * STEP, FRAMES, onScreen)).toEqual([]);
    lowestOnScreen = Number.POSITIVE_INFINITY;
    expect(shadows.update(running(), 3 * STEP, FRAMES, onScreen)).toEqual([]);
  });

  it('is gone at once when the run ends or the Esc skip lands the rest, and stays gone in a later run', () => {
    for (const end of [null, ended(), ended(LEFT_BEHIND)]) {
      const shadows = droppedAtTheExit();
      expect(shadows.update(end, STEP, FRAMES, EVERYWHERE).map((s) => s.y)).toEqual(end?.shadows.map((s) => s.y) ?? []);
      expect(shadows.update(running(), 2 * STEP, FRAMES, EVERYWHERE)).toEqual([]);
    }
  });

  it('is gone at once when the effects reset (a welcome, the screen shown anew), and a view seen before the reset drops nothing', () => {
    const shadows = droppedAtTheExit();
    shadows.reset();
    expect(shadows.update(running(), STEP, FRAMES, EVERYWHERE)).toEqual([]);
    shadows.update(running(SHADOW), 2 * STEP, FRAMES, EVERYWHERE);
    shadows.reset();
    expect(shadows.update(running(), 3 * STEP, FRAMES, EVERYWHERE)).toEqual([]);
  });

  it('flies on only the shadow of the run under way, never the one the end of a run in MOVETO or a skip left behind', () => {
    const shadows = new HelicopterShadows();
    shadows.update(running(SHADOW), 0, FRAMES, EVERYWHERE);
    expect(shadows.update(ended(SHADOW), STEP, FRAMES, EVERYWHERE).map((s) => s.y)).toEqual([SHADOW.y]);
    expect(shadows.update(running(SHADOW), 2 * STEP, FRAMES, EVERYWHERE).map((s) => s.y)).toEqual([SHADOW.y]);
    shadows.update(running(SHADOW, NEXT_RUN), 3 * STEP, FRAMES, EVERYWHERE);
    expect(shadows.update(running(SHADOW), 4 * STEP, FRAMES, EVERYWHERE).map((s) => [s.x, s.y])).toEqual([
      [SHADOW.x, SHADOW.y],
      [NEXT_RUN.x, NEXT_RUN.y + MOVELARGERY_STEP],
    ]);
  });

  it('adds nothing on the 640x480 screen, off which the shadow is at the exit, and flies it across a wide one until it leaves', () => {
    expect(stepsDrawnAfterTheExit(REFERENCE_SCREEN)).toBe(0);
    expect(stepsDrawnAfterTheExit(WIDE_SCREEN)).toBe(STEPS_ACROSS_A_WIDE_SCREEN);
  });
});
