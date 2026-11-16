import { describe, expect, it } from 'vitest';
import { resolveResolution, toDevice, toLogical } from '../../ui/resolution.ts';
import { type GrabDocument, MouseGrab } from './mouse-grab.ts';

const RESOLUTION = resolveResolution(1280, 960);

function grab(locked: boolean) {
  const stage = {} as HTMLElement;
  const doc = {
    addEventListener: () => undefined,
    exitPointerLock: () => undefined,
    pointerLockElement: locked ? stage : null,
    fullscreenElement: null,
  } as unknown as GrabDocument;
  return new MouseGrab(stage, () => RESOLUTION, new AbortController().signal, doc);
}

function moved(movementX: number, movementY: number): MouseEvent {
  return { movementX, movementY, clientX: 0, clientY: 0 } as MouseEvent;
}

describe('the mouse grab', () => {
  it('puts the game cursor where the game moves the pointer, and later movements go on from there', () => {
    const g = grab(true);
    const warped = g.warpTo(toDevice(RESOLUTION, 100, 50));
    expect(warped && toLogical(RESOLUTION, warped.x, warped.y)).toEqual({ x: 100, y: 50 });
    const next = g.movedTo(moved(3, -2));
    expect(toLogical(RESOLUTION, next.x, next.y)).toEqual({ x: 102, y: 49 });
  });

  it('keeps a warp on the screen', () => {
    const warped = grab(true).warpTo(toDevice(RESOLUTION, 5000, -20));
    expect(warped && toLogical(RESOLUTION, warped.x, warped.y)).toEqual({ x: RESOLUTION.logicalWidth - 1, y: 0 });
  });

  it('moves nothing without the grab, where the browser keeps the pointer', () => {
    expect(grab(false).warpTo(toDevice(RESOLUTION, 100, 50))).toBeNull();
  });
});
