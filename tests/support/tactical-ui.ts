import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadItemTable } from '../../src/content/items/items.ts';
import type { ProfilePresentation } from '../../src/content/narrative/profile-presentation.ts';
import { loadUiStrings } from '../../src/content/text/strings.ts';
import { PROJECT_DATA_DIR } from '../../src/node/repo.ts';
import type { CatalogueItem, ItemCatalogue } from '../../src/protocol/items.ts';
import type { CommandEnvelope } from '../../src/protocol/messages.ts';
import type { PlayerView, ViewFrame } from '../../src/protocol/view.ts';
import { buildItemCatalogue } from '../../src/server/item-catalogue.ts';
import { createSandboxSession } from '../../src/server/sandbox.ts';
import { Session } from '../../src/server/session.ts';
import { TextService } from '../../src/server/text-service.ts';
import type { DrawList } from '../../src/ui/draw-list.ts';
import type { HintAnswer, HintReply } from '../../src/ui/game-client.ts';
import { MouseButton } from '../../src/ui/input/events.ts';
import type { LayoutModel } from '../../src/ui/layout/model.ts';
import { messageBoxStyles, textBoxArt } from '../../src/ui/layout/styles.ts';
import { ORIGINAL_SKIN } from '../../src/ui/layout/types.ts';
import { CanvasMessageBoxes } from '../../src/ui/message-boxes.ts';
import {
  type BattleSound,
  type CommandReply,
  type InteractiveTile,
  type OverheadMapView,
  type RadarBox,
  type ScreenBox,
  type ScreenPoint,
  type ScrollEdges,
  type SoldierHeight,
  type SoldierMarker,
  type SpeechPlayback,
  TACTICAL_LAYOUTS,
  type TacticalClient,
  type TacticalEnvironment,
  type TacticalLayout,
  type TacticalMedia,
  type UiImageRef,
  type WorldMarker,
  type WorldPresenter,
} from '../../src/ui/screens/tactical/environment.ts';
import { GENERIC_FACE_BODY_TYPES, genericFacePath } from '../../src/ui/screens/tactical/generic-face.ts';
import { parseUiCursorTable } from '../../src/ui/screens/tactical/input/ui-cursors.ts';
import { TacticalScreen } from '../../src/ui/screens/tactical/tactical-screen.ts';
import { DEFAULT_DISPLAY_SETTINGS, type DisplaySettings } from '../../src/ui/settings.ts';
import { StringsTextService } from '../../src/ui/text/text-service.ts';
import { messageBoxLabels } from '../../src/ui/widgets/message-box.ts';
import type { WidgetInfo } from '../../src/ui/widgets/widget-info.ts';
import { FACE_FRAMES, FACE_HEIGHT, FACE_WIDTH } from '../../stubs/ui/faces.ts';
import { bigPictureShapes, SHAPE_LOOKS, smallSheetPlans, stubItemTable } from '../../stubs/ui/items.ts';
import { planStubSkin, readOriginalLayouts } from '../../stubs/ui/skin.ts';
import { type ClientSide, clientAnswer, clientSide, withQueries } from './hints.ts';
import type { StubSectorKit } from './sectors.ts';
import { projectLayoutLoader, type TestRuntime, testRuntime } from './ui-runtime.ts';

const CELL = 10;
const COLS = 160;
const MESSAGE_BOX_LAYOUT = 'message-box';
const BASIC_TEXT_BOX = 'basic';

export class SessionClient implements TacticalClient {
  readonly commands: { readonly cmd: CommandEnvelope; readonly reply: CommandReply }[] = [];
  paused = false;
  starts = 0;
  queued: readonly ViewFrame[] = [];
  hold: Promise<void> | null = null;
  readonly #session: Session;
  readonly #client: ClientSide;
  readonly #frames: ViewFrame[] = [];
  #view: PlayerView;

  constructor(session: Session, client: ClientSide) {
    this.#session = session;
    this.#client = client;
    this.#view = this.#snapshot();
    session.subscribe((message) => {
      if (message.t === 'frames') this.#frames.push(...(JSON.parse(JSON.stringify(message.frames)) as ViewFrame[]));
    });
  }

  takeFrames(): ViewFrame[] {
    return this.#frames.splice(0);
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

  get shownTick(): number {
    return this.#view.tick;
  }

  get queuedFrames(): readonly ViewFrame[] {
    return this.queued;
  }

  start(): void {
    this.starts++;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  async command(cmd: CommandEnvelope): Promise<CommandReply> {
    if (this.hold) await this.hold;
    const result = this.#session.dispatch(cmd);
    const reply = {
      ok: result.ok,
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.data !== undefined ? { data: result.data } : {}),
    };
    this.commands.push({ cmd, reply });
    this.refresh();
    return reply;
  }

  #answer(request: CommandEnvelope): HintAnswer {
    const result = clientAnswer(this.#client, this.#view, request);
    return JSON.parse(
      JSON.stringify({
        ok: result.ok,
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.data !== undefined ? { data: result.data } : {}),
      }),
    );
  }

  hint(request: CommandEnvelope): HintReply {
    return { state: 'ready', answer: this.#answer(request), source: 'local' };
  }

  async hintNow(request: CommandEnvelope): Promise<HintAnswer> {
    return this.#answer(request);
  }

  async query(request: CommandEnvelope): Promise<HintAnswer> {
    return this.#answer(request);
  }
}

export class FakeWorld implements WorldPresenter {
  readonly ready = true;
  readonly radarImage = null;
  readonly night = false;
  readonly located: number[] = [];
  readonly centred: number[] = [];
  camera = { centerX: 805, centerY: 725 };
  hovered: number | null = null;
  selected: number | null = null;
  roofLevel = false;
  heights = new Map<number, SoldierHeight>();
  soldierMarkers = new Map<number, SoldierMarker>();
  markers: readonly WorldMarker[] = [];
  doors = new Map<number, InteractiveTile>();
  exitGrids = new Set<number>();
  edges: ScrollEdges = { left: false, right: false, top: false, bottom: false };
  readonly scrolled: { readonly dx: number; readonly dy: number }[] = [];
  overhead: OverheadMapView | null = null;
  readonly #view: () => PlayerView;

  constructor(view: () => PlayerView) {
    this.#view = view;
  }

  #cellOf(gridNo: number): { x: number; y: number } {
    return { x: (gridNo % COLS) * CELL + CELL / 2, y: Math.floor(gridNo / COLS) * CELL + CELL / 2 };
  }

  pickPoint(gridNo: number): ScreenPoint {
    const cell = this.#cellOf(gridNo);
    const dx = cell.x - this.camera.centerX;
    const dy = cell.y - this.camera.centerY;
    return { x: 320 + 2 * dx - 2 * dy, y: 180 + dx + dy - CELL };
  }

  cellScreenPosition(gridNo: number): ScreenPoint {
    const p = this.pickPoint(gridNo);
    return { x: p.x, y: p.y + CELL };
  }

  soldierTrueScreenPosition(id: number): ScreenPoint | null {
    const s = this.#view().soldiers.find((v) => v.id === id);
    if (!s) return null;
    const p = this.pickPoint(s.gridNo);
    return { x: p.x, y: p.y + CELL };
  }

  soldierBox(id: number): ScreenBox | null {
    const p = this.soldierTrueScreenPosition(id);
    return p ? { x: p.x - 10, y: p.y - 40, width: 20, height: 40 } : null;
  }

  soldierHeight(id: number): SoldierHeight {
    return this.heights.get(id) ?? 'stand';
  }

  soldierMarker(id: number): SoldierMarker {
    return this.soldierMarkers.get(id) ?? { stanceOffset: 0, hidden: false, moving: false, stationary: true };
  }

  soldierAt(x: number, y: number): number | null {
    for (const s of this.#view().soldiers) {
      const box = this.soldierBox(s.id);
      if (box && x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height) return s.id;
    }
    return null;
  }

  gridNoAt(x: number, y: number): number | null {
    const offX = x - 320;
    const offY = y - 180 + CELL;
    const cellX = this.camera.centerX + Math.floor((offX / 2 + offY) / 2);
    const cellY = this.camera.centerY + Math.floor((offY - offX / 2) / 2);
    return Math.floor(cellY / CELL) * COLS + Math.floor(cellX / CELL);
  }

  radarViewport(): RadarBox | null {
    return { x1: 30, y1: 10, x2: 50, y2: 25 };
  }

  radarDot(gridNo: number): ScreenPoint | null {
    return { x: (gridNo % COLS) >> 1, y: Math.floor(gridNo / COLS) >> 2 };
  }

  centerOn(gridNo: number): void {
    this.centred.push(gridNo);
  }

  locate(gridNo: number): void {
    this.located.push(gridNo);
  }

  centerFromRadar(): void {}

  setViewport(): void {}

  setRoofLevel(on: boolean): void {
    this.roofLevel = on;
  }

  setHovered(id: number | null): void {
    this.hovered = id;
  }

  setSelected(id: number | null): void {
    this.selected = id;
  }

  itemTile(): UiImageRef | null {
    return null;
  }

  pointerBox(): UiImageRef | null {
    return null;
  }

  setMarkers(markers: readonly WorldMarker[]): void {
    this.markers = markers;
  }

  markerScreenPoint(marker: WorldMarker): ScreenPoint | null {
    const p = this.pickPoint(marker.gridNo);
    return { x: p.x + (marker.offsetX ?? 0), y: p.y + (marker.offsetY ?? 0) };
  }

  interactiveTileAt(gridNo: number): InteractiveTile | null {
    return this.doors.get(gridNo) ?? null;
  }

  exitGridAt(gridNo: number): boolean {
    return this.exitGrids.has(gridNo);
  }

  scrollEdges(): ScrollEdges {
    return this.edges;
  }

  scrollBy(dx: number, dy: number): boolean {
    this.scrolled.push({ dx, dy });
    return true;
  }

  overheadMap(): OverheadMapView | null {
    return this.overhead;
  }

  tileImage(name: string): UiImageRef | null {
    return { path: `tile:${name}`, frame: 0 };
  }

  tileCentre(gridNo: number): ScreenPoint {
    return this.pickPoint(gridNo);
  }
}

export class FakeMedia implements TacticalMedia {
  readonly gunNut = false;
  speaking: SpeechPlayback | null = null;
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

  readonly profiles = new Map<number, ProfilePresentation>();

  profile(id: number): ProfilePresentation | null {
    return this.profiles.get(id) ?? null;
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
}

export interface TacticalUiTest {
  readonly t: TestRuntime;
  readonly session: Session;
  readonly client: SessionClient;
  readonly world: FakeWorld;
  readonly media: FakeMedia;
  readonly screen: TacticalScreen;
  readonly attention: number[];
  readonly beeps: number[];
  readonly fingerprintsDenied: number[];
  readonly flow: string[];
  readonly battleSounds: { readonly soldier: number; readonly sound: BattleSound }[];
  display: DisplaySettings;
  widget(id: string): WidgetInfo;
  find(id: string): WidgetInfo | undefined;
  click(id: string, button?: number, modifiers?: number): Promise<void>;
  clickAt(x: number, y: number, button?: number): Promise<void>;
  key(key: string, modifiers?: number): void;
  frames(frames: readonly ViewFrame[]): void;
  deliver(): void;
  advance(ticks: number): void;
  settle(frames?: number): Promise<void>;
  draw(): DrawList;
}

export interface TacticalUiKit {
  readonly client: ClientSide;
  readonly catalogue: ItemCatalogue;
  readonly models: ReadonlyMap<string, LayoutModel>;
  readonly messageBox: LayoutModel;
}

export async function tacticalUiKit(kit: StubSectorKit): Promise<TacticalUiKit> {
  const sources = { read: kit.read, exists: (p: string) => kit.worlds.exists(p), world: (p: string) => kit.worlds.world(p) };
  const client = await clientSide(sources);
  const items = await loadItemTable(async (path) => JSON.parse(new TextDecoder().decode(await kit.vfs.read(path))));
  const encoded = await buildItemCatalogue(items, new TextService({ vfs: kit.vfs, dataVersion: 'stubs' }), 'eng');
  const loader = projectLayoutLoader();
  const models = new Map<string, LayoutModel>();
  for (const name of TACTICAL_LAYOUTS) models.set(name, await loader.load(ORIGINAL_SKIN, name));
  return { client, catalogue: encoded.catalogue, models, messageBox: await loader.load(ORIGINAL_SKIN, MESSAGE_BOX_LAYOUT) };
}

async function stubImages(t: TestRuntime): Promise<void> {
  for (let body = 0; body < GENERIC_FACE_BODY_TYPES; body++)
    t.images.set(genericFacePath(body), {
      kind: 'indexed',
      animatedFrames: 0,
      frames: Array.from({ length: FACE_FRAMES }, () => ({ width: FACE_WIDTH, height: FACE_HEIGHT, offsetX: 0, offsetY: 0 })),
    });
  const table = await stubItemTable();
  for (const plan of smallSheetPlans(table))
    t.images.set(plan.path, {
      kind: 'indexed',
      animatedFrames: 0,
      frames: plan.frames.map((shape) => ({
        width: SHAPE_LOOKS[shape].small[0],
        height: SHAPE_LOOKS[shape].small[1],
        offsetX: 0,
        offsetY: 0,
      })),
    });
  for (const [path, shape] of bigPictureShapes(table))
    t.images.set(path, {
      kind: 'indexed',
      animatedFrames: 0,
      frames: [{ width: SHAPE_LOOKS[shape].big[0], height: SHAPE_LOOKS[shape].big[1], offsetX: 0, offsetY: 0 }],
    });
  for (const plan of planStubSkin(await readOriginalLayouts()).values()) {
    t.images.set(plan.path, {
      kind: 'indexed',
      animatedFrames: plan.animated,
      frames: plan.frames.map((f) => ({ width: f.width, height: f.height, offsetX: 0, offsetY: 0 })),
    });
  }
}

export async function tacticalUiTest(kit: StubSectorKit, ui: TacticalUiKit, seed = 5, given?: Session): Promise<TacticalUiTest> {
  const t = await testRuntime();
  await stubImages(t);
  const sources = { read: kit.read, exists: (p: string) => kit.worlds.exists(p), world: (p: string) => kit.worlds.world(p) };
  const session = given ?? withQueries(new Session('tactical-ui', await createSandboxSession(kit.read, false, seed)), sources);
  const client = new SessionClient(session, ui.client);
  const world = new FakeWorld(() => client.view);
  const media = new FakeMedia(ui.catalogue);
  const strings = await loadUiStrings(async (path) => new Uint8Array(await readFile(join(PROJECT_DATA_DIR, path))), 'eng');
  const text = new StringsTextService(strings);
  const styles = messageBoxStyles(ui.messageBox);
  const style = (s: number) => styles[s] ?? (styles[0] as (typeof styles)[number]);
  const boxLabels = messageBoxLabels(text);
  const attention: number[] = [];
  const beeps: number[] = [];
  const fingerprintsDenied: number[] = [];
  const flow: string[] = [];
  const battleSounds: { readonly soldier: number; readonly sound: BattleSound }[] = [];
  const uiCursors = parseUiCursorTable(JSON.parse(await readFile(join(PROJECT_DATA_DIR, 'tables/ui-cursors.json'), 'utf8')));
  let display: DisplaySettings = DEFAULT_DISPLAY_SETTINGS;
  let die = 0;
  const env: TacticalEnvironment = {
    runtime: t.runtime,
    text,
    layout: (name: TacticalLayout) => ui.models.get(name) as LayoutModel,
    boxes: new CanvasMessageBoxes({ services: t.runtime, style, labels: () => boxLabels }),
    basicTextBox: textBoxArt(ui.messageBox, (ui.messageBox.style('textBoxes') as Record<string, unknown>)[BASIC_TEXT_BOX]),
    client,
    world,
    media,
    flow: {
      options: () => flow.push('options'),
      saveGame: () => flow.push('saveGame'),
      loadGame: () => flow.push('loadGame'),
      exitGame: () => flow.push('exitGame'),
      mapScreen: () => flow.push('mapScreen'),
    },
    sounds: {
      attention: (id) => attention.push(id),
      newMessageBeep: () => beeps.push(t.now),
      fingerprintDenied: () => fingerprintsDenied.push(t.now),
    },
    random: (range) => (die++ * 7) % Math.max(1, range),
    metric: () => true,
    uiCursors,
    display: () => display,
    setDisplay: (change) => {
      display = { ...display, ...change };
    },
    battleSound: (soldier, sound) => battleSounds.push({ soldier, sound }),
  };
  const screen = new TacticalScreen(env);
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
  t.frame();
  return {
    t,
    session,
    client,
    world,
    media,
    screen,
    attention,
    beeps,
    fingerprintsDenied,
    flow,
    battleSounds,
    get display() {
      return display;
    },
    set display(next: DisplaySettings) {
      display = next;
    },
    widget,
    find,
    click: async (id, button = MouseButton.LEFT, modifiers = 0) => {
      const { rect } = widget(id);
      await clickAt(rect.x + Math.floor(rect.width / 2), rect.y + Math.floor(rect.height / 2), button, modifiers);
    },
    clickAt,
    key(key, modifiers = 0) {
      t.runtime.input({ kind: 'keyDown', key, code: '', modifiers });
      t.runtime.input({ kind: 'keyUp', key, code: '', modifiers });
      t.frame();
    },
    frames(frames) {
      screen.frames(frames);
      t.frame();
    },
    deliver() {
      client.refresh();
      screen.frames(client.takeFrames());
      t.frame();
    },
    advance(ticks) {
      session.advance({ ticks });
      client.refresh();
      t.frame();
    },
    settle,
    draw: () => t.list,
  };
}
