import { AUTO_UI_SCALE, type ScaleSetting } from '../../ui/resolution.ts';
import { TEST_PATTERN_IMAGES, TestPatternScreen } from '../../ui/screens/test-pattern.ts';
import type { ClientSettings } from '../../ui/settings.ts';
import { loadSettings } from '../settings.ts';
import { installDomInput } from './dom-input.ts';
import { startFrameLoop } from './frame-loop.ts';
import { type FrontEnd, startFrontEnd } from './front-end.ts';
import { GamePage } from './game-page.ts';
import { ModalPause } from './modal-pause.ts';
import { bootUi } from './ui-boot.ts';

const SESSION_PARAM = 'session';
const SCREEN_PARAM = 'screen';
const TEST_PATTERN = 'testPattern';
const SCALE_PARAM = 'scale';
const FIXED_640_PARAM = 'fixed640';
const PIN_CLOCK_PARAM = 'pinClock';
const PINNED_CLOCK_MS = 0;
const OFF = '0';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found as T;
}

function scaleSetting(settings: ClientSettings, params: URLSearchParams): ScaleSetting {
  const scale = params.has(SCALE_PARAM) ? Number(params.get(SCALE_PARAM)) : settings.uiScale;
  const fixed640 = params.has(FIXED_640_PARAM) ? params.get(FIXED_640_PARAM) !== OFF : settings.fixed640;
  return { scale: Number.isFinite(scale) ? scale : AUTO_UI_SCALE, fixed640 };
}

const params = new URLSearchParams(location.search);
const page = new GamePage(element<HTMLCanvasElement>('screen'), scaleSetting(loadSettings(), params));
const clock = params.has(PIN_CLOCK_PARAM) ? () => PINNED_CLOCK_MS : () => performance.now();
const fail = (error: unknown) => {
  page.hook.error = error instanceof Error ? error.message : String(error);
};

let testScreen: TestPatternScreen | null = null;
let frontEnd: FrontEnd | null = null;
const pause = new ModalPause(() => frontEnd?.client.client ?? null);

installDomInput(
  page.canvas,
  (event) => {
    page.input(event);
    page.hook.pointer = testScreen?.pointer ?? null;
    page.hook.presses = testScreen?.presses ?? 0;
  },
  () => page.resolution,
  { pointerLeft: () => page.pointerLeft() },
);
startFrameLoop({ now: clock, requestFrame: (run) => requestAnimationFrame(run), frame: (now) => page.frame(now), failed: fail });

function markReady(): void {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      page.hook.ready = true;
    }),
  );
}

async function bootTestPattern(): Promise<void> {
  const ui = await bootUi(page, { images: TEST_PATTERN_IMAGES });
  testScreen = new TestPatternScreen(() => page.resolution, ui.assets.fonts, ui.assets.images);
  page.host.push(testScreen);
  markReady();
}

async function bootFrontEnd(): Promise<void> {
  const ui = await bootUi(page, { pauseGame: (paused) => pause.set(paused) });
  frontEnd = await startFrontEnd(page, ui);
  const started = frontEnd;
  page.hook.music = started.music.page.hook;
  page.hook.video = started.video;
  const unlock = () => {
    ui.audio.unlock();
    started.music.page.unlocked();
  };
  page.canvas.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  const session = params.get(SESSION_PARAM);
  if (session) {
    await started.client.connect(session);
    started.flow.enterGame();
  } else started.flow.mainMenu();
  markReady();
}

(params.get(SCREEN_PARAM) === TEST_PATTERN ? bootTestPattern() : bootFrontEnd()).catch(fail);
