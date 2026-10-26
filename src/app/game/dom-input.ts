import { keyDownEvents, keyUpEvent, MouseButton, modifierMask, type RawKey, type UiInputEvent } from '../../ui/input/events.ts';
import { type Resolution, toLogical } from '../../ui/resolution.ts';

export type InputSink = (event: UiInputEvent) => void;

export interface DomInputOptions {
  readonly pointerLeft?: () => void;
}

const SUPPRESSED_BUTTONS: ReadonlySet<number> = new Set([MouseButton.MIDDLE, MouseButton.BACK, MouseButton.FORWARD]);
const NUM_LOCK = 'NumLock';
const FULLSCREEN_KEY = 'Enter';

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

interface KeyboardLock {
  lock(keys?: string[]): Promise<void>;
}

const LOCKED_KEYS = ['Escape'];

function keyboardLock(): KeyboardLock | undefined {
  return (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
}

function toggleFullscreen(stage: HTMLElement): void {
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined);
    return;
  }
  void stage
    .requestFullscreen()
    .then(() => keyboardLock()?.lock(LOCKED_KEYS))
    .catch(() => undefined);
}

export function installDomInput(
  stage: HTMLElement,
  sink: InputSink,
  resolution: () => Resolution,
  domOptions: DomInputOptions = {},
): () => void {
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const logical = (event: MouseEvent) => {
    const rect = stage.getBoundingClientRect();
    const ratio = globalThis.devicePixelRatio || 1;
    return toLogical(resolution(), (event.clientX - rect.left) * ratio, (event.clientY - rect.top) * ratio);
  };
  const pointer = (kind: 'pointerDown' | 'pointerUp' | 'pointerMove', event: PointerEvent) => {
    const { x, y } = logical(event);
    sink({ kind, x, y, button: event.button, buttons: event.buttons, wheel: 0, modifiers: modifierMask(eventModifiers(event)) });
  };
  stage.addEventListener(
    'pointerdown',
    (event) => {
      stage.setPointerCapture(event.pointerId);
      if (SUPPRESSED_BUTTONS.has(event.button)) event.preventDefault();
      pointer('pointerDown', event);
    },
    options,
  );
  stage.addEventListener(
    'pointerup',
    (event) => {
      if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
      if (SUPPRESSED_BUTTONS.has(event.button)) event.preventDefault();
      pointer('pointerUp', event);
    },
    options,
  );
  stage.addEventListener('pointermove', (event) => pointer('pointerMove', event), options);
  stage.addEventListener('pointerleave', () => domOptions.pointerLeft?.(), options);
  stage.addEventListener(
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
  stage.addEventListener('contextmenu', (event) => event.preventDefault(), options);
  for (const type of ['mousedown', 'mouseup', 'auxclick'] as const) {
    stage.addEventListener(
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
      if (event.altKey && event.key === FULLSCREEN_KEY) {
        toggleFullscreen(stage);
        return;
      }
      sink(keyUpEvent(rawKey(event)));
    },
    options,
  );
  return () => controller.abort();
}

function eventModifiers(event: MouseEvent): Pick<RawKey, 'shift' | 'ctrl' | 'alt'> {
  return { shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey };
}
