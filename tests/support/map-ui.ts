import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadItemTable } from '../../src/content/items/items.ts';
import type { ProfilePresentation } from '../../src/content/narrative/profile-presentation.ts';
import { loadUiStrings } from '../../src/content/text/strings.ts';
import { PROJECT_DATA_DIR } from '../../src/node/repo.ts';
import type { CatalogueItem, ItemCatalogue } from '../../src/protocol/items.ts';
import type { MessageEntry } from '../../src/protocol/message-log.ts';
import type { CommandEnvelope } from '../../src/protocol/messages.ts';
import type { PlayerView, ViewFrame } from '../../src/protocol/view.ts';
import { buildItemCatalogue } from '../../src/server/item-catalogue.ts';
import type { Session } from '../../src/server/session.ts';
import { TextService } from '../../src/server/text-service.ts';
import type { DrawList } from '../../src/ui/draw-list.ts';
import type { HintAnswer, HintReply } from '../../src/ui/game-client.ts';
import { MouseButton } from '../../src/ui/input/events.ts';
import type { LayoutModel } from '../../src/ui/layout/model.ts';
import { messageBoxStyles, textBoxArt } from '../../src/ui/layout/styles.ts';
import { ORIGINAL_SKIN } from '../../src/ui/layout/types.ts';
import { CanvasMessageBoxes } from '../../src/ui/message-boxes.ts';
import {
  MAP_LAYOUTS,
  type MapClient,
  type MapCommandReply,
  type MapEnvironment,
  type MapLayout,
  type MapMedia,
} from '../../src/ui/screens/map/environment.ts';
import { mapFacts } from '../../src/ui/screens/map/facts.ts';
import { MapScreen } from '../../src/ui/screens/map/map-screen.ts';
import type { MapBoardArt } from '../../src/ui/screens/map/map-view.ts';
import type { SpeechPlayback } from '../../src/ui/screens/tactical/environment.ts';
import { StringsTextService } from '../../src/ui/text/text-service.ts';
import { messageBoxLabels } from '../../src/ui/widgets/message-box.ts';
import type { WidgetInfo } from '../../src/ui/widgets/widget-info.ts';
import { planStubSkin, readOriginalLayouts } from '../../stubs/ui/skin.ts';
import { BattleSessionClient, battleLayoutModels, FakeBattleSounds, testBattleEnvironment } from './battle-ui.ts';
import { buildMapScreenCampaign } from './e2e-campaign-saves.ts';
import { type ClientSide, clientAnswer, clientSide, withQueries } from './hints.ts';
import { createSaveKit, type SaveKit } from './saves.ts';
import type { StubSectorKit } from './sectors.ts';
import { projectLayoutLoader, type TestRuntime, testRuntime } from './ui-runtime.ts';

const MESSAGE_BOX_LAYOUT = 'message-box';
const BASIC_TEXT_BOX = 'basic';
const BOARD_WIDTH = 357;
const BOARD_HEIGHT = 306;
export const TEST_BOARD: MapBoardArt = {
  normal: 'test-board/normal',
  ltRed: 'test-board/ltRed',
  dkRed: 'test-board/dkRed',
  ltGreen: 'test-board/ltGreen',
  dkGreen: 'test-board/dkGreen',
};

function reply(result: { readonly ok: boolean; readonly reason?: string; readonly data?: unknown }): MapCommandReply {
  return JSON.parse(
    JSON.stringify({
      ok: result.ok,
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.data !== undefined ? { data: result.data } : {}),
    }),
  );
}

export class MapSessionClient implements MapClient {
  readonly commands: { readonly cmd: CommandEnvelope; readonly reply: MapCommandReply }[] = [];
  readonly holds = new Set<string>();
  paused = false;
  started = false;
  readonly #session: Session;
  readonly #client: ClientSide;
  #view: PlayerView;

  constructor(session: Session, client: ClientSide) {
    this.#session = session;
    this.#client = client;
    this.#view = this.#snapshot();
  }

  #snapshot(): PlayerView {
    return JSON.parse(JSON.stringify(this.#session.sim.view())) as PlayerView;
  }

  refresh(): void {
    this.#view = this.#snapshot();
  }

  get view(): PlayerView {
    return this.#view;
  }

  get latestView(): PlayerView {
    return this.#view;
  }

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.started = false;
    this.holds.clear();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  holdTime(reason: string, held: boolean): void {
    if (held) this.holds.add(reason);
    else this.holds.delete(reason);
  }

  async command(cmd: CommandEnvelope): Promise<MapCommandReply> {
    const answer = reply(this.#session.dispatch(cmd));
    this.commands.push({ cmd, reply: answer });
    this.refresh();
    return answer;
  }

  #answer(request: CommandEnvelope): HintAnswer {
    return reply(clientAnswer(this.#client, this.#view, request));
  }

  hint(request: CommandEnvelope): HintReply {
    return { state: 'ready', answer: this.#answer(request), source: 'local' };
  }

  async hintNow(request: CommandEnvelope): Promise<HintAnswer> {
    return this.#answer(request);
  }

  async query(request: CommandEnvelope): Promise<HintAnswer> {
    return reply(await this.#session.query(request));
  }
}

export class FakeMapMedia implements MapMedia {
  readonly gunNut = false;
  readonly board = TEST_BOARD;
  readonly radar = (): string | null => null;
  speaking: SpeechPlayback | null = null;
  log: MessageEntry[] = [];
  readonly #items = new Map<string, CatalogueItem>();
  readonly #byIndex = new Map<number, CatalogueItem>();

  constructor(catalogue: ItemCatalogue) {
    for (const item of catalogue.items) {
      this.#items.set(item.name, item);
      this.#byIndex.set(item.index, item);
    }
  }

  image(): boolean {
    return true;
  }

  profile(): ProfilePresentation | null {
    return null;
  }

  item(name: string): CatalogueItem | null {
    return this.#items.get(name) ?? null;
  }

  itemByIndex(index: number): CatalogueItem | null {
    return this.#byIndex.get(index) ?? null;
  }

  gaps(): null {
    return null;
  }

  speech(): SpeechPlayback | null {
    return this.speaking;
  }

  keyItem(key: { readonly item?: string }): string | null {
    return key.item ?? null;
  }

  messages(): readonly MessageEntry[] {
    return this.log;
  }

  dialogueText(): string | null {
    return null;
  }
}

export interface MapUiKit {
  readonly client: ClientSide;
  readonly catalogue: ItemCatalogue;
  readonly models: ReadonlyMap<string, LayoutModel>;
  readonly messageBox: LayoutModel;
}

export async function mapUiKit(kit: StubSectorKit): Promise<MapUiKit> {
  const sources = { read: kit.read, exists: (p: string) => kit.worlds.exists(p), world: (p: string) => kit.worlds.world(p) };
  const client = await clientSide(sources);
  const items = await loadItemTable(async (path) => JSON.parse(new TextDecoder().decode(await kit.vfs.read(path))));
  const encoded = await buildItemCatalogue(items, new TextService({ vfs: kit.vfs, dataVersion: 'stubs' }), 'eng');
  const loader = projectLayoutLoader();
  const models = new Map<string, LayoutModel>();
  for (const name of MAP_LAYOUTS) models.set(name, await loader.load(ORIGINAL_SKIN, name));
  for (const [name, model] of await battleLayoutModels()) models.set(name, model);
  return { client, catalogue: encoded.catalogue, models, messageBox: await loader.load(ORIGINAL_SKIN, MESSAGE_BOX_LAYOUT) };
}

async function stubImages(t: TestRuntime): Promise<void> {
  for (const plan of planStubSkin(await readOriginalLayouts()).values())
    t.images.set(plan.path, {
      kind: 'indexed',
      animatedFrames: plan.animated,
      frames: plan.frames.map((f) => ({ width: f.width, height: f.height, offsetX: 0, offsetY: 0 })),
    });
  for (const key of Object.values(TEST_BOARD))
    t.images.set(key, { kind: 'rgb', animatedFrames: 0, frames: [{ width: BOARD_WIDTH, height: BOARD_HEIGHT, offsetX: 0, offsetY: 0 }] });
}

export interface MapUiTest {
  readonly t: TestRuntime;
  readonly session: Session;
  readonly client: MapSessionClient;
  readonly battleClient: BattleSessionClient;
  readonly battleSounds: FakeBattleSounds;
  readonly media: FakeMapMedia;
  readonly screen: MapScreen;
  readonly mercs: readonly number[];
  readonly trainer: number;
  readonly flow: string[];
  readonly sounds: string[];
  widget(id: string): WidgetInfo;
  find(id: string): WidgetInfo | undefined;
  click(id: string, button?: number, modifiers?: number): Promise<void>;
  clickAt(x: number, y: number, button?: number, modifiers?: number): Promise<void>;
  clickSector(sector: string, button?: number): Promise<void>;
  hoverSector(sector: string, ms?: number): Promise<void>;
  key(key: string, modifiers?: number, code?: string): void;
  frames(frames: readonly ViewFrame[]): void;
  deliver(): void;
  settle(frames?: number): Promise<void>;
  draw(): DrawList;
  dispose(): Promise<void>;
}

export async function mapUiTest(kit: StubSectorKit, ui: MapUiKit): Promise<MapUiTest> {
  const t = await testRuntime();
  await stubImages(t);
  const saves: SaveKit = await createSaveKit(kit);
  const sources = { read: kit.read, exists: (p: string) => kit.worlds.exists(p), world: (p: string) => kit.worlds.world(p) };
  const campaign = await buildMapScreenCampaign(saves, kit);
  const session = withQueries(campaign.session, sources);
  const client = new MapSessionClient(session, ui.client);
  const media = new FakeMapMedia(ui.catalogue);
  const strings = await loadUiStrings(async (path) => new Uint8Array(await readFile(join(PROJECT_DATA_DIR, path))), 'eng');
  const text = new StringsTextService(strings);
  const styles = messageBoxStyles(ui.messageBox);
  const style = (s: number) => styles[s] ?? (styles[0] as (typeof styles)[number]);
  const boxLabels = messageBoxLabels(text);
  const strategic = ui.client.rules.strategic;
  if (!strategic) throw new Error('the stub rules have no strategic content');
  const flow: string[] = [];
  const sounds: string[] = [];
  const battleClient = new BattleSessionClient(session, client);
  const battleSounds = new FakeBattleSounds();
  const boxes = new CanvasMessageBoxes({ services: t.runtime, style, labels: () => boxLabels });
  let die = 0;
  const env: MapEnvironment = {
    runtime: t.runtime,
    text,
    layout: (name: MapLayout) => ui.models.get(name) as LayoutModel,
    boxes,
    messageBoxStyle: style,
    messageBoxLabels: boxLabels,
    basicTextBox: textBoxArt(ui.messageBox, (ui.messageBox.style('textBoxes') as Record<string, unknown>)[BASIC_TEXT_BOX]),
    client,
    media,
    facts: mapFacts(strategic.content, strategic.economy),
    flow: {
      options: () => flow.push('options'),
      saveGame: () => flow.push('saveGame'),
      loadGame: () => flow.push('loadGame'),
      exitGame: () => flow.push('exitGame'),
      preBattle: () => flow.push('preBattle'),
    },
    sounds: {
      glowClick: () => sounds.push('glowClick'),
      newMessageBeep: () => sounds.push('newMessageBeep'),
      confirmRoute: (soldier) => sounds.push(`confirmRoute ${soldier}`),
    },
    random: (range) => (die++ * 7) % Math.max(1, range),
    metric: () => true,
    notifySleepWake: () => true,
    battle: testBattleEnvironment({
      t,
      text,
      models: ui.models,
      client: battleClient,
      sounds: battleSounds,
      boxes,
      exitGame: () => flow.push('exitGame'),
    }),
  };
  const screen = new MapScreen(env);
  t.runtime.host.push(screen);
  const all = () => t.runtime.describe();
  const find = (id: string) => all().find((w) => w.id === id);
  const widget = (id: string) => {
    const found = find(id);
    if (!found)
      throw new Error(
        `no widget ${id} in ${all()
          .map((w) => w.id)
          .join(', ')}`,
      );
    return found;
  };
  const settle = async (frames = 3) => {
    for (let i = 0; i < frames; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      t.frame();
    }
  };
  const pointer = (kind: 'pointerMove' | 'pointerDown' | 'pointerUp', x: number, y: number, button: number, modifiers: number) =>
    t.runtime.input({ kind, x, y, button, buttons: 0, wheel: 0, modifiers });
  const clickAt = async (x: number, y: number, button: number = MouseButton.LEFT, modifiers = 0) => {
    pointer('pointerMove', x, y, button, modifiers);
    t.frame();
    pointer('pointerDown', x, y, button, modifiers);
    t.frame();
    pointer('pointerUp', x, y, button, modifiers);
    await settle();
  };
  const sectorPoint = (sector: string) => {
    const p = screen.sectorPoint(sector);
    if (!p) throw new Error(`no sector ${sector}`);
    return p;
  };
  t.frame();
  return {
    t,
    session,
    client,
    battleClient,
    battleSounds,
    media,
    screen,
    mercs: campaign.mercs,
    trainer: campaign.trainer,
    flow,
    sounds,
    widget,
    find,
    click: async (id, button = MouseButton.LEFT, modifiers = 0) => {
      const { rect } = widget(id);
      await clickAt(rect.x + Math.floor(rect.width / 2), rect.y + Math.floor(rect.height / 2), button, modifiers);
    },
    clickAt,
    clickSector: async (sector, button = MouseButton.LEFT) => {
      const p = sectorPoint(sector);
      await clickAt(p.x, p.y, button);
    },
    hoverSector: async (sector, ms = 250) => {
      const p = sectorPoint(sector);
      pointer('pointerMove', p.x, p.y, MouseButton.LEFT, 0);
      t.frame();
      t.frame(ms);
      await settle();
    },
    key(key, modifiers = 0, code = '') {
      t.runtime.input({ kind: 'keyDown', key, code, modifiers });
      t.runtime.input({ kind: 'keyUp', key, code, modifiers });
      t.frame();
    },
    frames(frames) {
      screen.frames(frames);
      t.frame();
    },
    deliver() {
      screen.frames(battleClient.takeFrames());
      t.frame();
    },
    settle,
    draw: () => t.list,
    dispose: () => saves.dispose(),
  };
}
