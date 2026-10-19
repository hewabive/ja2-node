import { AUTO_UI_SCALE, type ScaleSetting } from '../../ui/resolution.ts';
import { TEST_PATTERN_IMAGES, TestPatternScreen } from '../../ui/screens/test-pattern.ts';
import { SessionClient } from '../net/session-client.ts';
import { type ClientSettings, loadSettings } from '../settings.ts';
import { installDomInput } from './dom-input.ts';
import { startFrameLoop } from './frame-loop.ts';
import { GamePage } from './game-page.ts';
import { bootUi } from './ui-boot.ts';

const SESSION_PARAM = 'session';
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

SessionClient.connect(params.get(SESSION_PARAM) ?? undefined)
  .then((client) => {
    page.client = client;
    page.hook.session = client.session;
  })
  .catch(fail);

async function boot(): Promise<void> {
  const ui = await bootUi(page, { images: TEST_PATTERN_IMAGES });
  page.canvas.addEventListener('pointerdown', () => ui.audio.unlock());
  window.addEventListener('keydown', () => ui.audio.unlock());
  testScreen = new TestPatternScreen(() => page.resolution, ui.assets.fonts, ui.assets.images);
  page.host.push(testScreen);
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      page.hook.ready = true;
    }),
  );
}

boot().catch(fail);
