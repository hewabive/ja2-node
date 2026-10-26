import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadUiStrings } from '../../src/content/text/strings.ts';
import { PROJECT_DATA_DIR } from '../../src/node/repo.ts';
import type { PlayerView } from '../../src/protocol/view.ts';
import type { GameOptions, Health, LoadSuccess, Refusal, SaveHeader, SaveListing, SaveSuccess } from '../../src/ui/client/api-types.ts';
import type { FrontEndClient, NewCampaign, SessionStatus } from '../../src/ui/client/front-end-client.ts';
import type { DrawList } from '../../src/ui/draw-list.ts';
import { MouseButton } from '../../src/ui/input/events.ts';
import type { LayoutModel } from '../../src/ui/layout/model.ts';
import { messageBoxStyles } from '../../src/ui/layout/styles.ts';
import { ORIGINAL_SKIN } from '../../src/ui/layout/types.ts';
import { CanvasMessageBoxes } from '../../src/ui/message-boxes.ts';
import type { CreatedSession, SaveRequest, SessionStart } from '../../src/ui/saves/save-controller.ts';
import {
  FRONT_END_LAYOUTS,
  type FrontEndEnvironment,
  FrontEndLayout,
  type SettingsStore,
} from '../../src/ui/screens/front-end/environment.ts';
import { FrontEndFlow, type FrontEndHost, type FrontEndMusic, type LaptopPort } from '../../src/ui/screens/front-end/flow.ts';
import { type ClientSettings, DEFAULT_SETTINGS, type SettingsChange, updateSettings } from '../../src/ui/settings.ts';
import { Labels } from '../../src/ui/text/labels.ts';
import { StringsTextService } from '../../src/ui/text/text-service.ts';
import { messageBoxLabels } from '../../src/ui/widgets/message-box.ts';
import type { WidgetInfo } from '../../src/ui/widgets/widget-info.ts';
import { planStubSkin, readOriginalLayouts } from '../../stubs/ui/skin.ts';
import { projectLayoutLoader, type TestRuntime, testRuntime } from './ui-runtime.ts';

const ENGINE = { version: '0.7.0', commit: 'abcdef0123456' };
const OPTIONS: GameOptions = { difficulty: 2, sciFi: true, gunNut: false, saveMode: 'anywhere', bloodAndGore: true };

export function header(overrides: Partial<SaveHeader> = {}): SaveHeader {
  return {
    kind: 'player',
    description: 'a save',
    savedAt: '2026-10-19T10:00:00.000Z',
    engine: ENGINE,
    content: { source: 'stubs', dataVersion: 'stubs' },
    options: OPTIONS,
    world: { day: 2, hour: 9, minute: 5 },
    sector: 'A9',
    flow: 'strategic',
    mercs: 3,
    balance: 12_500,
    campaign: 'c1',
    session: 'campaign',
    tick: 100,
    ...overrides,
  };
}

export function listing(name: string, modified: string, overrides: Partial<SaveHeader> = {}): SaveListing {
  return { name, native: false, modified, header: header({ description: name, ...overrides }), version: 2, compatible: true, problems: [] };
}

export class FakeClient implements FrontEndClient {
  listings: SaveListing[] = [];
  session: string | null = null;
  view: PlayerView | null = null;
  canSave = true;
  options: GameOptions | null = OPTIONS;
  readonly calls: string[] = [];
  readonly campaigns: NewCampaign[] = [];
  readonly saved: { session: string; request: SaveRequest }[] = [];
  readonly loads: { session: string | null; name: string }[] = [];
  readonly deleted: string[] = [];
  readonly bloodAndGore: boolean[] = [];
  nextFlow: 'laptop' | 'strategic' | 'tactical' = 'strategic';
  #sessions = 0;

  async health(): Promise<Health> {
    return {
      ok: true,
      data: { original: false, slf: 0, stubs: true },
      dataVersion: 'stubs',
      language: 'eng',
      engine: ENGINE,
      files: 1,
    };
  }

  async saves(): Promise<SaveListing[]> {
    return this.listings;
  }

  #open(flow: 'laptop' | 'strategic' | 'tactical'): string {
    this.session = `session-${++this.#sessions}`;
    this.view = { tick: 0, mapPath: null, soldiers: [], strategic: { flow } as NonNullable<PlayerView['strategic']> };
    return this.session;
  }

  async newCampaign(campaign: NewCampaign): Promise<string> {
    this.calls.push('newCampaign');
    this.campaigns.push(campaign);
    return this.#open('laptop');
  }

  async connect(session: string): Promise<void> {
    this.calls.push(`connect ${session}`);
    this.session = session;
  }

  async status(): Promise<SessionStatus> {
    return { canSave: this.canSave, options: this.options };
  }

  async setBloodAndGore(on: boolean): Promise<void> {
    this.bloodAndGore.push(on);
  }

  async closeSession(): Promise<void> {
    this.calls.push('closeSession');
    this.session = null;
    this.view = null;
  }

  leaveSession(): void {
    this.calls.push('leaveSession');
    this.session = null;
    this.view = null;
  }

  async save(session: string, request: SaveRequest): Promise<SaveSuccess | Refusal> {
    this.saved.push({ session, request });
    const name = request.name ?? `saved-${this.saved.length}`;
    return { ok: true, name, kind: 'player', header: header({ description: request.description ?? '' }) };
  }

  #loaded(name: string): LoadSuccess {
    return { ok: true, name, seed: 1, warnings: [], header: header() };
  }

  async loadInPlace(session: string, name: string): Promise<LoadSuccess> {
    this.loads.push({ session, name });
    this.view = { tick: 0, mapPath: null, soldiers: [], strategic: { flow: this.nextFlow } as NonNullable<PlayerView['strategic']> };
    return this.#loaded(name);
  }

  async createSession(start: SessionStart): Promise<CreatedSession> {
    this.loads.push({ session: null, name: start.load ?? start.save ?? '' });
    const id = `loaded-${this.loads.length}`;
    this.view = { tick: 0, mapPath: null, soldiers: [], strategic: { flow: this.nextFlow } as NonNullable<PlayerView['strategic']> };
    return { session: id, load: this.#loaded(start.load ?? '') };
  }

  async deleteSave(name: string): Promise<boolean> {
    this.deleted.push(name);
    this.listings = this.listings.filter((l) => l.name !== name);
    return true;
  }
}

export class MemorySettings implements SettingsStore {
  settings: ClientSettings = DEFAULT_SETTINGS;
  persisted: ClientSettings | null = null;

  current(): ClientSettings {
    return this.settings;
  }

  change(change: SettingsChange): void {
    this.settings = updateSettings(this.settings, change);
  }

  persist(): void {
    this.persisted = this.settings;
  }
}

export class FakeHost implements FrontEndHost {
  readonly version = '0.7.0 (abcdef0)';
  readonly modes: FrontEndMusic[] = [];
  readonly rows: string[] = ['@T,{;ja2-node', '@};A test credit'];
  quits = 0;
  beginnings = 0;
  laptopPort: LaptopPort | null = null;

  laptop(): LaptopPort | null {
    return this.laptopPort;
  }

  async playBeginning(): Promise<void> {
    this.beginnings++;
  }

  music(mode: FrontEndMusic): void {
    this.modes.push(mode);
  }

  quit(): void {
    this.quits++;
  }

  rowFeed() {
    const queue = [...this.rows];
    return () => queue.shift() ?? null;
  }

  random(range: number): number {
    return Math.max(0, range - 1);
  }
}

export interface FrontEndTest {
  readonly t: TestRuntime;
  readonly env: FrontEndEnvironment;
  readonly client: FakeClient;
  readonly settings: MemorySettings;
  readonly host: FakeHost;
  readonly flow: FrontEndFlow;
  readonly pauses: boolean[];
  widget(id: string): WidgetInfo;
  find(id: string): WidgetInfo | undefined;
  click(id: string, modifiers?: number): void;
  key(key: string, phase?: 'down' | 'up', modifiers?: number): void;
  type(text: string): void;
  settle(frames?: number): Promise<void>;
  screen(): string | null;
  modal(): string | null;
  draw(): DrawList;
}

async function stubImages(t: TestRuntime): Promise<void> {
  for (const plan of planStubSkin(await readOriginalLayouts()).values()) {
    t.images.set(plan.path, {
      kind: 'indexed',
      animatedFrames: plan.animated,
      frames: plan.frames.map((f) => ({ width: f.width, height: f.height, offsetX: 0, offsetY: 0 })),
    });
  }
}

async function strings() {
  return loadUiStrings(async (path) => new Uint8Array(await readFile(join(PROJECT_DATA_DIR, path))), 'eng');
}

export async function frontEndTest(): Promise<FrontEndTest> {
  const pauses: boolean[] = [];
  const t = await testRuntime(undefined, { pauseGame: (paused) => pauses.push(paused) });
  await stubImages(t);
  const loader = projectLayoutLoader();
  const models = new Map<string, LayoutModel>();
  for (const name of FRONT_END_LAYOUTS) models.set(name, await loader.load(ORIGINAL_SKIN, name));
  const uiStrings = await strings();
  const text = new StringsTextService(uiStrings);
  const labels = new Labels('eng', uiStrings.tables);
  const styles = messageBoxStyles(models.get(FrontEndLayout.MESSAGE_BOX) as LayoutModel);
  const style = (s: number) => styles[s] ?? (styles[0] as (typeof styles)[number]);
  const boxLabels = messageBoxLabels(text);
  const env: FrontEndEnvironment = {
    runtime: t.runtime,
    text,
    labels: () => labels,
    layout: (name) => models.get(name) as LayoutModel,
    boxes: new CanvasMessageBoxes({ services: t.runtime, style, labels: () => boxLabels }),
    messageBoxStyle: style,
    messageBoxLabels: boxLabels,
  };
  const client = new FakeClient();
  const settings = new MemorySettings();
  const host = new FakeHost();
  const flow = new FrontEndFlow(env, client, settings, {
    version: host.version,
    playBeginning: () => host.playBeginning(),
    music: (mode) => host.music(mode),
    quit: () => host.quit(),
    rowFeed: () => host.rowFeed(),
    random: (range) => host.random(range),
    laptop: () => host.laptop(),
  });
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
  const pointer = (kind: 'pointerMove' | 'pointerDown' | 'pointerUp', x: number, y: number, modifiers: number) =>
    t.runtime.input({ kind, x, y, button: MouseButton.LEFT, buttons: 0, wheel: 0, modifiers });
  return {
    t,
    env,
    client,
    settings,
    host,
    flow,
    pauses,
    widget,
    find,
    click(id, modifiers = 0) {
      const { rect } = widget(id);
      const x = rect.x + Math.floor(rect.width / 2);
      const y = rect.y + Math.floor(rect.height / 2);
      pointer('pointerMove', x, y, modifiers);
      t.frame();
      pointer('pointerDown', x, y, modifiers);
      t.frame();
      pointer('pointerUp', x, y, modifiers);
      t.frame();
    },
    key(key, phase = 'down', modifiers = 0) {
      if (phase === 'down') t.runtime.input({ kind: 'keyDown', key, code: '', modifiers });
      t.runtime.input({ kind: 'keyUp', key, code: '', modifiers });
      t.frame();
    },
    type(text) {
      t.runtime.input({ kind: 'text', text });
      t.frame();
    },
    async settle(frames = 3) {
      for (let i = 0; i < frames; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        t.frame();
      }
    },
    screen: () => t.runtime.host.screen?.id ?? null,
    modal: () => t.runtime.host.modal?.id ?? null,
    draw: () => t.list,
  };
}
