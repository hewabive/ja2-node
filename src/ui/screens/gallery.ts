import { type Area, type DrawList, rgb } from '../draw-list.ts';
import type { ControllerContract } from '../layout/controller.ts';
import { ViewModelController } from '../layout/controller.ts';
import { LayoutScreen } from '../layout/layout-screen.ts';
import type { LayoutModel } from '../layout/model.ts';
import type { UiRuntime } from '../runtime.ts';
import type { UiTextService } from '../text/text-service.ts';
import { UiScreenKind } from '../widgets/button-sounds.ts';
import { Fade } from '../widgets/fade.ts';
import type { MessageBoxLabels, MessageBoxStyle } from '../widgets/message-box.ts';
import { interpolateRect, SnapshotZoom } from '../widgets/snapshot-zoom.ts';

export const GALLERY_SCREEN = 'gallery';
const NO_BOX = -1;
const PROGRESS_STEP = 10;
const FULL = 100;
const ZOOM_STEPS = 24;
const ZOOM_FROM = { x: 300, y: 220, width: 40, height: 30 };
const INITIAL_VOLUME = 63;
const INITIAL_MONEY = -1234567;

export const GALLERY_CONTRACT: ControllerContract = {
  id: GALLERY_SCREEN,
  actions: {
    push: {},
    toggle: {},
    choose: { args: 1 },
    toggleSound: {},
    hotspot: {},
    icon: {},
    setVolume: { args: 1 },
    rename: { payload: 'string' },
    openMenu: {},
    menuSelect: { args: 1 },
    menuClose: {},
    openBox: { args: 1 },
    boxResult: { args: 1 },
    fade: {},
    zoom: {},
    progress: {},
  },
  bindings: {
    status: 'string',
    toggled: 'boolean',
    choice: 'number',
    choiceNames: 'list',
    sound: 'boolean',
    money: 'number',
    volume: 'number',
    name: 'string',
    menuLines: 'list',
    menuOpen: 'boolean',
    boxNames: 'list',
    box: 'number',
    cursorNames: 'list',
    progress: 'number',
    rows: 'list',
  },
};

export interface GalleryOptions {
  readonly runtime: UiRuntime;
  readonly model: LayoutModel;
  readonly text: UiTextService;
  readonly messageBoxStyle: (style: number) => MessageBoxStyle;
  readonly messageBoxLabels: MessageBoxLabels;
}

export function galleryController(runtime: UiRuntime): ViewModelController {
  const model: Record<string, unknown> = {
    status: 'ready',
    toggled: false,
    choice: 0,
    choiceNames: ['Easy', 'Medium', 'Hard'],
    sound: true,
    money: INITIAL_MONEY,
    volume: INITIAL_VOLUME,
    name: 'Ivan',
    menuOpen: false,
    menuLines: [
      { text: 'Doctor', second: '2' },
      { text: 'Patient', second: '1' },
      { text: 'Repair', shade: 'shade' },
      { text: 'Train', shade: 'secondary' },
      { text: 'Cancel' },
    ],
    boxNames: ['Yes/No', 'OK', '1-4'],
    box: NO_BOX,
    cursorNames: ['target', 'wait', 'I-beam', 'flash', 'text'],
    progress: 0,
    rows: ['a list of rows', 'bound to a list', 'one template'],
  };
  const status = (text: string) => {
    model.status = text;
  };
  let pushes = 0;
  const controller = new ViewModelController(GALLERY_CONTRACT, model, {
    push: () => status(`push ${++pushes}`),
    toggle: () => {
      model.toggled = !model.toggled;
      status(`toggle ${String(model.toggled)}`);
    },
    choose: ([i]) => {
      model.choice = i ?? 0;
      status(`choice ${String(model.choice)}`);
    },
    toggleSound: () => {
      model.sound = !model.sound;
      status(`sound ${String(model.sound)}`);
    },
    hotspot: () => status('hotspot'),
    icon: () => status('icon'),
    setVolume: ([v]) => {
      model.volume = v ?? 0;
      status(`volume ${String(model.volume)}`);
    },
    rename: (_args, text) => {
      model.name = text ?? '';
      status(`name ${String(model.name)}`);
    },
    openMenu: () => {
      model.menuOpen = true;
      status('menu open');
    },
    menuSelect: ([line]) => {
      model.menuOpen = false;
      const lines = model.menuLines as { text: string }[];
      status(`menu ${lines[line ?? 0]?.text ?? ''}`);
    },
    menuClose: () => {
      model.menuOpen = false;
      status('menu closed');
    },
    openBox: ([i]) => {
      model.box = i ?? NO_BOX;
      status(`box ${String(model.box)}`);
    },
    boxResult: ([result]) => {
      model.box = NO_BOX;
      status(`box result ${String(result)}`);
    },
    fade: () => {
      status('fade');
      runtime.host.openModal(
        new Fade(runtime, {
          direction: 'out',
          onDone: () => runtime.host.openModal(new Fade(runtime, { direction: 'in', onDone: () => status('fade done') })),
        }),
      );
    },
    zoom: () => {
      status('zoom');
      const { width, height } = runtime.geometry();
      runtime.host.openModal(
        new SnapshotZoom(runtime, {
          steps: ZOOM_STEPS,
          destination: interpolateRect(ZOOM_FROM, { x: 0, y: 0, width, height }),
          onDone: () => status('zoom done'),
        }),
      );
    },
    progress: () => {
      model.progress = ((model.progress as number) + PROGRESS_STEP) % (FULL + PROGRESS_STEP);
      status(`progress ${String(model.progress)}`);
    },
  });
  return controller;
}

const SWATCH_STEPS = 9;
const CHANNEL_MAX = 255;

export function drawSwatch(list: DrawList, rect: Area): void {
  const step = Math.floor(rect.width / SWATCH_STEPS);
  for (let i = 0; i < SWATCH_STEPS; i++) {
    const level = Math.round((i * CHANNEL_MAX) / (SWATCH_STEPS - 1));
    list.fill(rect.x + i * step, rect.y, rect.x + (i + 1) * step, rect.y + rect.height, rgb(level, CHANNEL_MAX - level, 128));
  }
  list.rectangle(rect.x, rect.y, rect.x + step * SWATCH_STEPS - 1, rect.y + rect.height - 1, rgb(CHANNEL_MAX, CHANNEL_MAX, CHANNEL_MAX));
}

export function galleryScreen(options: GalleryOptions): LayoutScreen {
  const controller = galleryController(options.runtime);
  return new LayoutScreen({
    id: GALLERY_SCREEN,
    model: options.model,
    controller,
    services: options.runtime,
    sliders: options.runtime.sliders,
    text: options.text,
    messageBoxStyle: options.messageBoxStyle,
    messageBoxLabels: options.messageBoxLabels,
    soundScreen: UiScreenKind.OPTIONS,
    custom: { swatch: drawSwatch },
  });
}
