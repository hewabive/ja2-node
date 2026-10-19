import { type CreditsMonitor, createCreditsMonitor, playCredits } from '../../app/credits/scroller.ts';
import { fetchHealth, readVfsFileOrNull } from '../../app/net/vfs.ts';
import { loadSettings, saveSettings } from '../../app/settings.ts';
import type { VideoResult } from '../../app/video/player.ts';
import { createSequenceMonitor, playSequence, type SequenceMonitor } from '../../app/video/sequence-player.ts';
import { beginningPlan, endingPlan, type SequencePlan, sequenceEnabled, splashPlan } from '../../app/video/sequences.ts';
import { engineSound } from '../../app/video/sound.ts';
import { AudioEngine } from '../../audio/engine.ts';
import { type ClientSettings, effectiveMaster, updateSettings } from '../../ui/settings.ts';

interface VideoPageHook {
  ready: boolean;
  busy: boolean;
  error: string | null;
  unlocked: boolean;
  video: SequenceMonitor;
  credits: CreditsMonitor;
}

declare global {
  interface Window {
    __ja2Video: VideoPageHook;
  }
}

const AUTOPLAY_PARAM = 'autoplay';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found as T;
}

const status = element<HTMLSpanElement>('status');
const results = element<HTMLTableElement>('results');
const hook: VideoPageHook = {
  ready: false,
  busy: false,
  error: null,
  unlocked: false,
  video: createSequenceMonitor(),
  credits: createCreditsMonitor(),
};
window.__ja2Video = hook;

let settings: ClientSettings = loadSettings();
const engine = new AudioEngine({ createGraph: () => new AudioContext(), load: readVfsFileOrNull });
engine.setVolumes({ ...settings.volumes, master: effectiveMaster(settings) });
const unlock = () => {
  engine.unlock();
  hook.unlocked = engine.unlocked;
};
window.addEventListener('pointerdown', unlock, { capture: true });
window.addEventListener('keydown', unlock, { capture: true });
const sound = engineSound(engine);

function tableRow(cells: readonly string[], header = false): HTMLTableRowElement {
  const row = document.createElement('tr');
  for (const text of cells) {
    const cell = document.createElement(header ? 'th' : 'td');
    cell.textContent = text;
    row.append(cell);
  }
  return row;
}

function showResults(rows: readonly VideoResult[]): void {
  results.replaceChildren(
    tableRow(['video', 'outcome', 'frames shown / decoded / total', 'clock', 'audio', 'max decode ms'], true),
    ...rows.map((r) =>
      tableRow([
        r.path,
        r.error ? `${r.outcome} (${r.error})` : r.outcome,
        `${r.framesShown} / ${r.framesDecoded} / ${r.frameCount}`,
        r.clock ?? '-',
        r.audioStarted ? 'yes' : 'no',
        r.maxDecodeMs.toFixed(1),
      ]),
    ),
  );
}

async function exclusive(task: () => Promise<void>): Promise<void> {
  if (hook.busy) return;
  hook.busy = true;
  try {
    await task();
  } catch (err) {
    hook.error = (err as Error).message;
    status.textContent = hook.error;
    status.classList.add('error');
  } finally {
    hook.busy = false;
  }
}

async function runSequence(plan: SequencePlan): Promise<void> {
  const result = await playSequence(plan, { sound, monitor: hook.video });
  showResults(result.videos);
  if (plan.followedBy === 'credits') await playCredits({ monitor: hook.credits });
}

element<HTMLButtonElement>('playSplash').addEventListener('click', () => void exclusive(() => runSequence(splashPlan())));
element<HTMLButtonElement>('playBeginning').addEventListener('click', () => void exclusive(() => runSequence(beginningPlan())));
element<HTMLButtonElement>('playEnding').addEventListener('click', () => {
  const ending = {
    miguelAlive: element<HTMLInputElement>('miguelAlive').checked,
    skyriderAlive: element<HTMLInputElement>('skyriderAlive').checked,
  };
  void exclusive(() => runSequence(endingPlan(ending)));
});
element<HTMLButtonElement>('playCredits').addEventListener(
  'click',
  () => void exclusive(() => playCredits({ monitor: hook.credits }).then(() => undefined)),
);

const splashSetting = element<HTMLInputElement>('settingSplash');
const introSetting = element<HTMLInputElement>('settingIntro');
splashSetting.checked = settings.playSplash;
introSetting.checked = settings.playIntro;
const saveSwitches = () => {
  settings = updateSettings(settings, { playSplash: splashSetting.checked, playIntro: introSetting.checked });
  saveSettings(settings);
};
splashSetting.addEventListener('change', saveSwitches);
introSetting.addEventListener('change', saveSwitches);

try {
  const health = await fetchHealth();
  status.textContent = `data ${health.dataVersion ?? (health.data.original ? 'original' : 'stubs')}`;
} catch (err) {
  status.textContent = (err as Error).message;
  status.classList.add('error');
}
hook.ready = true;
if (new URLSearchParams(location.search).get(AUTOPLAY_PARAM) === 'splash' && sequenceEnabled('splash', settings)) {
  void exclusive(() => runSequence(splashPlan()));
}
