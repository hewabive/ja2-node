import { keyDownEvents, keyUpEvent, MouseButton, modifierMask, type RawKey, type UiInputEvent } from '../../ui/input/events.ts';
import { type Resolution, toLogical } from '../../ui/resolution.ts';

export type InputSink = (event: UiInputEvent) => void;

const SUPPRESSED_BUTTONS: ReadonlySet<number> = new Set([MouseButton.MIDDLE, MouseButton.BACK, MouseButton.FORWARD]);
const NUM_LOCK = 'NumLock';

function rawKey(event: KeyboardEvent): RawKey {
  return {
    key: event.key,
    code: event.code,
    repeat: event.repeat,
    shift: event.shiftKey,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    numLock: event.getModifierState(NUM_LOCK),
  };
}

function wheelStep(deltaY: number): number {
  return Math.sign(deltaY);
}

export function installDomInput(canvas: HTMLCanvasElement, sink: InputSink, resolution: () => Resolution): () => void {
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const logical = (event: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const deviceX = ((event.clientX - rect.left) * canvas.width) / Math.max(1, rect.width);
    const deviceY = ((event.clientY - rect.top) * canvas.height) / Math.max(1, rect.height);
    return toLogical(resolution(), deviceX, deviceY);
  };
  const pointer = (kind: 'pointerDown' | 'pointerUp' | 'pointerMove', event: PointerEvent) => {
    const { x, y } = logical(event);
    sink({ kind, x, y, button: event.button, buttons: event.buttons, wheel: 0, modifiers: modifierMask(eventModifiers(event)) });
  };
  canvas.addEventListener(
    'pointerdown',
    (event) => {
      canvas.setPointerCapture(event.pointerId);
      if (SUPPRESSED_BUTTONS.has(event.button)) event.preventDefault();
      pointer('pointerDown', event);
    },
    options,
  );
  canvas.addEventListener(
    'pointerup',
    (event) => {
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (SUPPRESSED_BUTTONS.has(event.button)) event.preventDefault();
      pointer('pointerUp', event);
    },
    options,
  );
  canvas.addEventListener('pointermove', (event) => pointer('pointerMove', event), options);
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const { x, y } = logical(event);
      sink({
        kind: 'wheel',
        x,
        y,
        button: -1,
        buttons: event.buttons,
        wheel: wheelStep(event.deltaY),
        modifiers: modifierMask(eventModifiers(event)),
      });
    },
    { ...options, passive: false },
  );
  canvas.addEventListener('contextmenu', (event) => event.preventDefault(), options);
  for (const type of ['mousedown', 'mouseup', 'auxclick'] as const) {
    canvas.addEventListener(
      type,
      (event) => {
        if (SUPPRESSED_BUTTONS.has(event.button)) event.preventDefault();
      },
      options,
    );
  }
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.metaKey) return;
      event.preventDefault();
      for (const e of keyDownEvents(rawKey(event))) sink(e);
    },
    options,
  );
  window.addEventListener(
    'keyup',
    (event) => {
      if (event.metaKey) return;
      event.preventDefault();
      sink(keyUpEvent(rawKey(event)));
    },
    options,
  );
  return () => controller.abort();
}

function eventModifiers(event: MouseEvent): Pick<RawKey, 'shift' | 'ctrl' | 'alt'> {
  return { shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey };
}
