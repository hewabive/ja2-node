import type { CampaignEndingView } from '../../protocol/view.ts';
import type { FrontEndEnvironment } from '../../ui/screens/front-end/environment.ts';
import type { FrontEndFlow } from '../../ui/screens/front-end/flow.ts';
import { LOADING_SCREEN } from '../../ui/screens/front-end/loading.ts';
import { StoryBlackHold, StoryBlackScreen } from '../../ui/screens/story/black-screen.ts';
import { StoryLayer } from '../../ui/screens/story/story-layer.ts';
import { meanwhileSceneSeen } from '../../ui/settings.ts';
import { Fade } from '../../ui/widgets/fade.ts';
import { playSequence, type SequenceMonitor } from '../video/sequence-player.ts';
import { endingPlan } from '../video/sequences.ts';
import { engineSound } from '../video/sound.ts';
import type { HttpFrontEndClient } from './front-end-client.ts';
import type { FrontEndMusicPlayer } from './front-end-music.ts';
import type { GamePage } from './game-page.ts';
import type { BrowserSettingsStore } from './settings-store.ts';
import type { UiBoot } from './ui-boot.ts';

const TACTICAL_SCREEN = 'tactical';

export interface StoryHostOptions {
  readonly page: GamePage;
  readonly ui: UiBoot;
  readonly env: FrontEndEnvironment;
  readonly flow: FrontEndFlow;
  readonly client: HttpFrontEndClient;
  readonly settings: BrowserSettingsStore;
  readonly music: FrontEndMusicPlayer;
  readonly video: SequenceMonitor;
  readonly tacticalLoaded: () => boolean;
}

export function createStoryLayer(o: StoryHostOptions): StoryLayer {
  const host = o.page.host;
  const runtime = o.ui.runtime;
  let black: StoryBlackHold | null = null;
  const holdBlack = () => {
    black = new StoryBlackHold(() => runtime.geometry());
    host.openModal(black);
  };
  const clearBlack = () => {
    if (black) host.closeModal(black);
    black = null;
  };
  const playEnding = async (ending: CampaignEndingView): Promise<void> => {
    o.client.leaveSession();
    o.music.show('none', null);
    if (host.depth === 0) host.push(new StoryBlackScreen(() => runtime.geometry()));
    else host.replace(new StoryBlackScreen(() => runtime.geometry()));
    clearBlack();
    await playSequence(endingPlan(ending), { sound: engineSound(o.ui.audio.engine), monitor: o.video });
    o.flow.credits();
  };
  return new StoryLayer({
    boxes: o.env.boxes,
    text: o.ui.text,
    sceneSeen: (scene) => meanwhileSceneSeen(o.settings.current(), scene),
    fadeOut: () =>
      new Promise((resolve) =>
        host.openModal(
          new Fade(runtime, {
            direction: 'out',
            onDone: () => {
              holdBlack();
              resolve();
            },
          }),
        ),
      ),
    clearBlack,
    fadeIn: () => new Promise((resolve) => host.openModal(new Fade(runtime, { direction: 'in', onDone: resolve }))),
    gameShown: () => {
      const screen = host.screen;
      if (!screen || screen.id === LOADING_SCREEN) return false;
      return screen.id !== TACTICAL_SCREEN || o.tacticalLoaded();
    },
    ending: playEnding,
  });
}
