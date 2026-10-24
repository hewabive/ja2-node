import { ClientRandom, seedFromText } from '../../audio/client-random.ts';
import type { ViewFrame } from '../../protocol/view.ts';
import type { AssetKey } from '../../ui/draw-list.ts';
import type { LayoutModel } from '../../ui/layout/model.ts';
import { collectReferences } from '../../ui/layout/references.ts';
import { messageBoxStyles, textBoxArt } from '../../ui/layout/styles.ts';
import { ORIGINAL_SKIN } from '../../ui/layout/types.ts';
import { CanvasMessageBoxes } from '../../ui/message-boxes.ts';
import { FRONT_END_LAYOUTS, type FrontEndEnvironment, FrontEndLayout } from '../../ui/screens/front-end/environment.ts';
import {
  FrontEndFlow,
  type FrontEndHost,
  type FrontEndMusic,
  gameScreenOf,
  type MapPort,
  type TacticalPort,
} from '../../ui/screens/front-end/flow.ts';
import { LOADINGSCREEN_NOTHING } from '../../ui/screens/front-end/loading.ts';
import { type LaptopMemory, laptopMemory } from '../../ui/screens/laptop/laptop-client.ts';
import type { Labels } from '../../ui/text/labels.ts';
import { messageBoxLabels } from '../../ui/widgets/message-box.ts';
import { CreditRowFeed, fetchCreditRow } from '../credits/rows.ts';
import { bootLaptopScreen } from '../laptop/laptop-boot.ts';
import { fetchHealth } from '../launcher/api.ts';
import { fetchLabels } from '../launcher/labels.ts';
import { MapHost } from '../map/map-host.ts';
import type { SessionClient } from '../net/session-client.ts';
import { fetchVfsFile } from '../net/vfs.ts';
import { TacticalHost } from '../tactical/tactical-host.ts';
import { createSequenceMonitor, playSequence, type SequenceMonitor } from '../video/sequence-player.ts';
import { beginningPlan, sequenceEnabled } from '../video/sequences.ts';
import { engineSound } from '../video/sound.ts';
import { HttpFrontEndClient } from './front-end-client.ts';
import { FrontEndMusicPlayer } from './front-end-music.ts';
import type { GamePage } from './game-page.ts';
import { HelpHost } from './help-host.ts';
import { BrowserSettingsStore, engineVolumes } from './settings-store.ts';
import { createStoryLayer } from './story-host.ts';
import type { UiBoot } from './ui-boot.ts';

const LAUNCHER_PAGE = '/';
const FRONT_END_RANDOM_SEED = 'front-end';
const LOADING_PICTURE_PREFIX = 'picture';
const SHORT_COMMIT = 7;
const BASIC_TEXT_BOX = 'basic';

export interface FrontEnd {
  readonly flow: FrontEndFlow;
  readonly client: HttpFrontEndClient;
  readonly music: FrontEndMusicPlayer;
  readonly video: SequenceMonitor;
}

function deferredAssets(model: LayoutModel): ReadonlySet<string> {
  if (model.json.screen !== 'loading') return new Set();
  return new Set([...model.assets.keys()].filter((name) => name !== `${LOADING_PICTURE_PREFIX}${LOADINGSCREEN_NOTHING}`));
}

function assetsOf(model: LayoutModel): AssetKey[] {
  const deferred = deferredAssets(model);
  return [...collectReferences(model).assets.entries()].filter(([name]) => !deferred.has(name)).map(([, use]) => use.asset.path);
}

async function preloadAll(ui: UiBoot, models: readonly LayoutModel[]): Promise<void> {
  await Promise.all([...new Set(models.flatMap(assetsOf))].map((path) => ui.assets.image(path)));
}

function loadScreenOf(frames: readonly ViewFrame[]): number | null {
  let found: number | null = null;
  for (const frame of frames)
    for (const event of frame.events ?? []) if (event.type === 'sectorLoaded' && event.loadScreen) found = event.loadScreen.id;
  return found;
}

function versionLabel(engine: { readonly version: string; readonly commit: string } | undefined): string {
  return engine ? `${engine.version} (${engine.commit.slice(0, SHORT_COMMIT)})` : '';
}

export async function startFrontEnd(page: GamePage, ui: UiBoot): Promise<FrontEnd> {
  const settings = new BrowserSettingsStore();
  const models = new Map<string, LayoutModel>();
  for (const name of FRONT_END_LAYOUTS) models.set(name, await ui.layouts.load(ORIGINAL_SKIN, name));
  await preloadAll(ui, [...models.values()]);
  const health = await fetchHealth().catch(() => null);
  const labels: Labels = await fetchLabels(settings.current().language ?? health?.language ?? null);
  const styles = messageBoxStyles(models.get(FrontEndLayout.MESSAGE_BOX) as LayoutModel);
  const fallback = styles[0];
  if (!fallback) throw new Error('the message box layout has no styles');
  const boxLabels = messageBoxLabels(ui.text);
  const messageBoxModel = models.get(FrontEndLayout.MESSAGE_BOX) as LayoutModel;
  const basicTextBox = textBoxArt(
    messageBoxModel,
    (messageBoxModel.style('textBoxes') as Readonly<Record<string, unknown>>)[BASIC_TEXT_BOX],
  );
  const env: FrontEndEnvironment = {
    runtime: ui.runtime,
    text: ui.text,
    labels: () => labels,
    layout: (name) => {
      const model = models.get(name);
      if (!model) throw new Error(`front-end layout ${name} is not loaded`);
      return model;
    },
    boxes: new CanvasMessageBoxes({ services: ui.runtime, style: (s) => styles[s] ?? fallback, labels: () => boxLabels }),
    messageBoxStyle: (s) => styles[s] ?? fallback,
    messageBoxLabels: boxLabels,
  };
  const client = new HttpFrontEndClient(() => settings.current().language);
  const music = new FrontEndMusicPlayer(settings.current(), fetchVfsFile);
  void music.load(ui.audio.engine);
  settings.listen((current) => {
    ui.audio.engine.setVolumes(engineVolumes(current));
    music.settings(current);
  });
  const random = new ClientRandom(seedFromText(FRONT_END_RANDOM_SEED));
  let tactical: TacticalHost | null = null;
  const tacticalFor = (session: SessionClient): TacticalHost => {
    if (tactical?.session === session) return tactical;
    tactical?.dispose();
    tactical = new TacticalHost({
      page,
      ui,
      session,
      boxes: env.boxes,
      basicTextBox,
      language: () => settings.current().language,
      gunNut: async () => (await client.status()).options?.gunNut ?? false,
    });
    return tactical;
  };
  let map: MapHost | null = null;
  const mapFor = (session: SessionClient): MapHost => {
    if (map?.session === session) return map;
    map?.dispose();
    map = new MapHost({
      page,
      ui,
      session,
      boxes: env.boxes,
      basicTextBox,
      messageBoxStyle: env.messageBoxStyle,
      messageBoxLabels: env.messageBoxLabels,
      language: () => settings.current().language,
      gunNut: async () => (await client.status()).options?.gunNut ?? false,
    });
    return map;
  };
  let lastLoadScreen: number | null = null;
  const tacticalPort = (host: TacticalHost): TacticalPort => ({
    get loaded() {
      return host.loaded;
    },
    get stale() {
      return host.stale;
    },
    get loadScreen() {
      return host.loadScreen ?? lastLoadScreen;
    },
    load: (onProgress) => host.load(onProgress),
    screen: (flow) => host.screen({ ...flow, help: () => help.force('tactical') }),
  });
  const mapPort = (host: MapHost): MapPort => ({
    get loaded() {
      return host.loaded;
    },
    load: (onProgress) => host.load(onProgress),
    enter: (abandonFight) => host.enter(abandonFight),
    screen: (flow) => host.screen({ ...flow, help: () => help.forceMap() }),
  });
  page.frameListener = (ms) => {
    tactical?.frameTime(ms);
    map?.frameTime();
    help.frame();
    story.frame();
  };
  const laptopMemories = new Map<string, LaptopMemory>();
  const laptopMemoryFor = (session: string): LaptopMemory => {
    const known = laptopMemories.get(session);
    if (known) return known;
    const created = laptopMemory();
    laptopMemories.set(session, created);
    return created;
  };
  const video = createSequenceMonitor();
  const host: FrontEndHost = {
    version: versionLabel(health?.engine),
    playBeginning: async () => {
      if (!sequenceEnabled('beginning', settings.current())) return;
      await playSequence(beginningPlan(), { sound: engineSound(ui.audio.engine), monitor: video });
    },
    music: (mode: FrontEndMusic) => music.show(mode, client.client?.music ?? null),
    quit: () => location.assign(LAUNCHER_PAGE),
    preload: async (layout, onProgress) => {
      const paths = assetsOf(env.layout(layout));
      let done = 0;
      onProgress(done, paths.length);
      for (const path of paths) {
        await ui.assets.image(path);
        onProgress(++done, paths.length);
      }
    },
    rowFeed: () => {
      const feed = new CreditRowFeed(fetchCreditRow);
      return () => feed.take();
    },
    random: (range) => random.int(range),
    tactical: () => (client.client ? tacticalPort(tacticalFor(client.client)) : null),
    map: () => (client.client ? mapPort(mapFor(client.client)) : null),
    laptop: () => {
      const session = client.client;
      const id = session?.session;
      if (!session || !id) return null;
      return {
        open: (flow) =>
          bootLaptopScreen(ui, {
            session,
            memory: laptopMemoryFor(id),
            onClosed: flow.closed,
            onQuitRequest: flow.quit,
            onHelp: () => help.force('laptop'),
          }),
      };
    },
  };
  const flow = new FrontEndFlow(env, client, settings, host);
  const help = new HelpHost({
    page,
    ui,
    settings,
    campaign: () => client.client?.campaign ?? null,
    view: () => client.client?.view ?? null,
  });
  await help.load();
  const story = createStoryLayer({ page, ui, env, flow, client, settings, music, video, tacticalLoaded: () => tactical?.loaded ?? false });
  page.hook.help = help.hook;
  page.hook.story = story.hook;
  client.onConnected = (session: SessionClient | null) => {
    page.client = session;
    page.hook.session = session?.session ?? null;
    if (tactical && tactical.session !== session) {
      tactical.dispose();
      tactical = null;
    }
    if (map && map.session !== session) {
      map.dispose();
      map = null;
    }
    lastLoadScreen = null;
    story.reset();
    if (!session) return;
    session.onFrames = (frames) => {
      music.frames(frames);
      lastLoadScreen = loadScreenOf(frames) ?? lastLoadScreen;
      if (!tactical && gameScreenOf(session.view) === 'tactical' && session.view?.mapPath) tacticalFor(session);
      tactical?.frames(frames);
      map?.frames(frames);
      story.frames(frames, (released) => flow.frames(released));
    };
    session.onReceive = (frames) => tactical?.received(frames);
    session.onWelcome = () => tactical?.welcome();
  };
  return { flow, client, music, video };
}
