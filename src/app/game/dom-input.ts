import { TextComposition, type TextInputState } from '../../ui/input/composition.ts';
import { keyDownEvents, keyUpEvents, MouseButton, modifierMask, type RawKey, type UiInputEvent } from '../../ui/input/events.ts';
import { type DevicePoint, type Resolution, toLogical } from '../../ui/resolution.ts';
import { MouseGrab } from './mouse-grab.ts';

export type InputSink = (event: UiInputEvent) => void;

export interface DomInputOptions {
  readonly pointerLeft?: () => void;
}

export interface DomInput {
  followTextInput(state: TextInputState): void;
  dispose(): void;
}

const SUPPRESSED_BUTTONS: ReadonlySet<number> = new Set([MouseButton.MIDDLE, MouseButton.BACK, MouseButton.FORWARD]);
const NUM_LOCK = 'NumLock';
const FULLSCREEN_KEY = 'Enter';
const FULLSCREEN_PRESS_KEY = 'F11';
const MOUSE_GRAB_KEY = 'ScrollLock';

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

function leftToBrowser(event: KeyboardEvent): boolean {
  return event.metaKey;
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

function lockEscape(): void {
  void keyboardLock()
    ?.lock(LOCKED_KEYS)
    .catch(() => undefined);
}

function toggleFullscreen(stage: HTMLElement, grab: MouseGrab): void {
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined);
    return;
  }
  grab.engage();
  void stage.requestFullscreen().then(lockEscape, () => grab.release());
}

export function installDomInput(
  stage: HTMLElement,
  sink: InputSink,
  resolution: () => Resolution,
  domOptions: DomInputOptions = {},
): DomInput {
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const grab = new MouseGrab(stage, resolution, controller.signal);
  const composition = new TextComposition();
  const ime = imeTarget(stage);
  installComposition(ime, composition, sink, controller.signal);
  const logical = (device: DevicePoint) => toLogical(resolution(), device.x, device.y);
  const pointer = (kind: 'pointerDown' | 'pointerUp' | 'pointerMove', event: PointerEvent) => {
    const { x, y } = logical(kind === 'pointerMove' ? grab.movedTo(event) : grab.at(event));
    sink({ kind, x, y, button: event.button, buttons: event.buttons, wheel: 0, modifiers: modifierMask(eventModifiers(event)) });
  };
  stage.addEventListener(
    'pointerdown',
    (event) => {
      if (!grab.locked) stage.setPointerCapture(event.pointerId);
      if (SUPPRESSED_BUTTONS.has(event.button)) event.preventDefault();
      pointer('pointerDown', event);
      grab.regain();
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
      const { x, y } = logical(grab.at(event));
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
  stage.addEventListener('mousedown', (event) => event.preventDefault(), options);
  for (const type of ['mouseup', 'auxclick'] as const) {
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
      if (leftToBrowser(event) || composition.takesKeyDown(event, document.activeElement === ime)) return;
      event.preventDefault();
      if (event.key === FULLSCREEN_PRESS_KEY) {
        if (!event.repeat) toggleFullscreen(stage, grab);
        return;
      }
      for (const e of keyDownEvents(rawKey(event))) sink(e);
    },
    options,
  );
  window.addEventListener(
    'keyup',
    (event) => {
      if (leftToBrowser(event) || composition.takesKeyUp(event)) return;
      event.preventDefault();
      if (event.altKey && event.key === FULLSCREEN_KEY) {
        toggleFullscreen(stage, grab);
        return;
      }
      if (event.key === FULLSCREEN_PRESS_KEY) return;
      if (event.key === MOUSE_GRAB_KEY) {
        grab.toggle();
        return;
      }
      for (const e of keyUpEvents(rawKey(event))) sink(e);
    },
    options,
  );
  return {
    followTextInput: (state) => followEditing(ime, state, controller.signal),
    dispose: () => {
      controller.abort();
      ime.remove();
    },
  };
}

const IME_TARGET_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'absolute',
  left: '0',
  top: '0',
  width: '20em',
  margin: '0',
  padding: '2px 4px',
  border: '1px solid #808080',
  font: '16px sans-serif',
  color: '#000',
  background: '#fff',
  opacity: '0',
  pointerEvents: 'none',
  zIndex: '1',
};
const COMPOSING_OPACITY = '1';
const IDLE_OPACITY = '0';

function imeTarget(stage: HTMLElement): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.tabIndex = -1;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('aria-hidden', 'true');
  Object.assign(input.style, IME_TARGET_STYLE);
  stage.append(input);
  return input;
}

function installComposition(input: HTMLInputElement, composition: TextComposition, sink: InputSink, signal: AbortSignal): void {
  const options = { signal };
  input.addEventListener(
    'compositionstart',
    () => {
      composition.start();
      input.style.opacity = COMPOSING_OPACITY;
    },
    options,
  );
  input.addEventListener(
    'compositionend',
    (event) => {
      input.style.opacity = IDLE_OPACITY;
      input.value = '';
      for (const e of composition.commit(event.data)) sink(e);
    },
    options,
  );
  input.addEventListener(
    'input',
    () => {
      if (!composition.composing) input.value = '';
    },
    options,
  );
}

function followEditing(input: HTMLInputElement, state: TextInputState, signal: AbortSignal): void {
  const follow = (editing: boolean) => {
    if (editing) input.focus({ preventScroll: true });
    else input.blur();
  };
  follow(state.editing);
  signal.addEventListener('abort', state.listen(follow), { once: true });
}

function eventModifiers(event: MouseEvent): Pick<RawKey, 'shift' | 'ctrl' | 'alt'> {
  return { shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey };
}
