import { installDomInput } from '../../app/game/dom-input.ts';
import { startFrameLoop } from '../../app/game/frame-loop.ts';
import { GamePage } from '../../app/game/game-page.ts';
import { bootUi } from '../../app/game/ui-boot.ts';
import { bootLaptopScreen } from '../../app/laptop/laptop-boot.ts';
import { SessionClient } from '../../app/net/session-client.ts';
import { AUTO_UI_SCALE } from '../../ui/resolution.ts';

const SESSION_PARAM = 'session';
const SEED_PARAM = 'seed';
const SCALE_PARAM = 'scale';
const PIN_CLOCK_PARAM = 'pinClock';
const WAIT_PARAM = 'wait';
const SLIDE_PARAM = 'slide';
const ZOOM_PARAM = 'zoom';
const PINNED_CLOCK_MS = 0;
const VIEW_TIMEOUT_MS = 20_000;
const VIEW_POLL_MS = 50;

interface LaptopHook {
  session: string | null;
  closed: boolean;
}

declare global {
  interface Window {
    __ja2Laptop?: LaptopHook;
  }
}

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('screen') as HTMLCanvasElement;
const scale = Number(params.get(SCALE_PARAM) ?? AUTO_UI_SCALE);
const page = new GamePage(canvas, { scale: Number.isFinite(scale) ? scale : AUTO_UI_SCALE, fixed640: false });
const clock = params.has(PIN_CLOCK_PARAM) ? () => PINNED_CLOCK_MS : () => performance.now();
const hook: LaptopHook = { session: null, closed: false };
window.__ja2Laptop = hook;
const fail = (error: unknown) => {
  page.hook.error = error instanceof Error ? error.message : String(error);
};

installDomInput(
  canvas,
  (event) => page.input(event),
  () => page.resolution,
  { pointerLeft: () => page.pointerLeft() },
);
startFrameLoop({ now: clock, requestFrame: (run) => requestAnimationFrame(run), frame: (now) => page.frame(now), failed: fail });

async function newCampaign(): Promise<string> {
  const seed = params.get(SEED_PARAM);
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...(seed !== null ? { seed: Number(seed) } : {}), campaign: { hire: [] } }),
  });
  const body = (await res.json()) as { session?: string; error?: string };
  if (!res.ok || !body.session) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body.session;
}

async function laptopView(client: SessionClient): Promise<void> {
  const deadline = performance.now() + VIEW_TIMEOUT_MS;
  while (!client.latestView?.laptop) {
    if (performance.now() > deadline) throw new Error('the session shows no laptop');
    await new Promise((resolve) => setTimeout(resolve, VIEW_POLL_MS));
  }
}

function numberParam(name: string): number | undefined {
  const value = params.get(name);
  if (value === null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

async function boot(): Promise<void> {
  const session = params.get(SESSION_PARAM) ?? (await newCampaign());
  hook.session = session;
  const client = await SessionClient.connect(session);
  page.client = client;
  page.hook.session = client.session;
  const ui = await bootUi(page);
  canvas.addEventListener('pointerdown', () => ui.audio.unlock());
  window.addEventListener('keydown', () => ui.audio.unlock());
  await laptopView(client);
  const wait = numberParam(WAIT_PARAM);
  const slide = numberParam(SLIDE_PARAM);
  const screen = await bootLaptopScreen(ui, {
    session: client,
    settings: { ...(wait === undefined ? {} : { loadingTimeScale: wait }), ...(slide === undefined ? {} : { slideStepMs: slide }) },
    zoomOnOpen: params.get(ZOOM_PARAM) === '1',
    zoomOnClose: params.get(ZOOM_PARAM) === '1',
    onClosed: () => {
      hook.closed = true;
    },
  });
  page.host.push(screen);
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      page.hook.ready = true;
    }),
  );
}

boot().catch(fail);
