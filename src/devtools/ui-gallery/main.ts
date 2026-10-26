import { installDomInput } from '../../app/game/dom-input.ts';
import { startFrameLoop } from '../../app/game/frame-loop.ts';
import { GamePage } from '../../app/game/game-page.ts';
import { bootUi, preloadLayout } from '../../app/game/ui-boot.ts';
import { messageBoxStyles } from '../../ui/layout/styles.ts';
import { ORIGINAL_SKIN } from '../../ui/layout/types.ts';
import { AUTO_UI_SCALE } from '../../ui/resolution.ts';
import { galleryScreen } from '../../ui/screens/gallery.ts';
import { messageBoxLabels } from '../../ui/widgets/message-box.ts';

const SCALE_PARAM = 'scale';
const FIXED_640_PARAM = 'fixed640';
const PIN_CLOCK_PARAM = 'pinClock';
const SKIN_PARAM = 'skin';
const PINNED_CLOCK_MS = 0;
const GALLERY_LAYOUT = 'gallery';
const MESSAGE_BOX_LAYOUT = 'message-box';

const params = new URLSearchParams(location.search);
const stage = document.getElementById('stage') as HTMLElement;
const canvas = document.getElementById('screen') as HTMLCanvasElement;
const scale = Number(params.get(SCALE_PARAM) ?? AUTO_UI_SCALE);
const page = new GamePage(stage, canvas, {
  scale: Number.isFinite(scale) ? scale : AUTO_UI_SCALE,
  fixed640: params.get(FIXED_640_PARAM) === '1',
});
const clock = params.has(PIN_CLOCK_PARAM) ? () => PINNED_CLOCK_MS : () => performance.now();
const fail = (error: unknown) => {
  page.hook.error = error instanceof Error ? error.message : String(error);
};

installDomInput(
  stage,
  (event) => page.input(event),
  () => page.resolution,
  { pointerLeft: () => page.pointerLeft() },
);
startFrameLoop({ now: clock, requestFrame: (run) => requestAnimationFrame(run), frame: (now) => page.frame(now), failed: fail });

async function boot(): Promise<void> {
  const ui = await bootUi(page);
  stage.addEventListener('pointerdown', () => ui.audio.unlock());
  window.addEventListener('keydown', () => ui.audio.unlock());
  const skin = params.get(SKIN_PARAM) ?? ORIGINAL_SKIN;
  const model = await ui.layouts.load(skin, GALLERY_LAYOUT);
  const messageBox = await ui.layouts.load(skin, MESSAGE_BOX_LAYOUT);
  await Promise.all([preloadLayout(ui, model), preloadLayout(ui, messageBox)]);
  const styles = messageBoxStyles(messageBox);
  const fallback = styles[0];
  if (!fallback) throw new Error('the message box layout has no styles');
  page.host.push(
    galleryScreen({
      runtime: ui.runtime,
      model,
      text: ui.text,
      messageBoxStyle: (style) => styles[style] ?? fallback,
      messageBoxLabels: messageBoxLabels(ui.text),
    }),
  );
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      page.hook.ready = true;
    }),
  );
}

boot().catch(fail);
