import { loadItemTable } from '../../src/content/items/items.ts';
import { edtEncodingOf, STUB_DATA_VERSION } from '../../src/content/text/data-version.ts';
import { EDT_LAYOUTS_PATH, EdtLayouts } from '../../src/content/text/edt-layouts.ts';
import { loadUiStrings } from '../../src/content/text/strings.ts';
import { STUBS_PREFIX } from '../../src/node/data-vfs.ts';
import type { CatalogueItem } from '../../src/protocol/items.ts';
import type { LaptopView } from '../../src/protocol/view.ts';
import { createCampaignSession } from '../../src/server/campaign-factory.ts';
import type { CampaignSession } from '../../src/server/campaign-session.ts';
import { buildItemCatalogue } from '../../src/server/item-catalogue.ts';
import { Session } from '../../src/server/session.ts';
import { TextService } from '../../src/server/text-service.ts';
import type { LayoutModel } from '../../src/ui/layout/model.ts';
import { messageBoxStyles } from '../../src/ui/layout/styles.ts';
import { ORIGINAL_SKIN } from '../../src/ui/layout/types.ts';
import type { LaptopClient, LaptopCommand, LaptopCommandReply, LaptopItem } from '../../src/ui/screens/laptop/laptop-client.ts';
import { BOOKMARK_MODES } from '../../src/ui/screens/laptop/laptop-modes.ts';
import { LAPTOP_LAYOUTS, LaptopScreen } from '../../src/ui/screens/laptop/laptop-screen.ts';
import { EdtTextCache } from '../../src/ui/text/edt-text.ts';
import { StringsTextService } from '../../src/ui/text/text-service.ts';
import { messageBoxLabels } from '../../src/ui/widgets/message-box.ts';
import type { WidgetInfo } from '../../src/ui/widgets/widget-info.ts';
import type { StubSectorKit } from './sectors.ts';
import { drivenSession, stubSessionSources } from './session-reload.ts';
import { projectLayoutLoader, type TestRuntime, testRuntime } from './ui-runtime.ts';

const MESSAGE_BOX_LAYOUT = 'message-box';
const SETTLE_FRAMES = 6;
const DEFAULT_SEED = 7;

export interface LaptopHire {
  readonly profile: number;
  readonly contract: number;
}

export interface LaptopHarnessOptions {
  readonly seed?: number;
  readonly hire?: readonly LaptopHire[];
}

export interface LaptopHarness {
  readonly t: TestRuntime;
  readonly screen: LaptopScreen;
  readonly session: CampaignSession;
  readonly commands: LaptopCommand[];
  readonly replies: LaptopCommandReply[];
  laptop(): LaptopView;
  closed: boolean;
}

export interface LaptopUiKit {
  readonly layouts: ReadonlyMap<string, LayoutModel>;
  readonly items: ReadonlyMap<number, LaptopItem>;
  readonly edtLayouts: EdtLayouts;
}

function laptopItem(i: CatalogueItem): LaptopItem {
  return {
    index: i.index,
    shortName: i.shortName,
    graphic: { path: i.inventoryGraphics.small.path, frame: i.inventoryGraphics.small.subImageIndex },
    name: i.longName,
    ammoCapacity: i.magazine?.capacity ?? null,
    gunCalibre: i.weapon?.calibre?.name ?? null,
  };
}

async function json(kit: StubSectorKit, path: string): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await kit.vfs.read(path)));
}

export async function laptopUiKit(kit: StubSectorKit): Promise<LaptopUiKit> {
  const loader = projectLayoutLoader();
  const layouts = new Map<string, LayoutModel>();
  for (const name of [...LAPTOP_LAYOUTS, MESSAGE_BOX_LAYOUT]) layouts.set(name, await loader.load(ORIGINAL_SKIN, name));
  const table = await loadItemTable((path) => json(kit, path));
  const encoded = await buildItemCatalogue(table, new TextService({ vfs: kit.vfs, dataVersion: STUB_DATA_VERSION }), 'eng');
  const items = new Map(encoded.catalogue.items.map((i) => [i.index, laptopItem(i)]));
  return { layouts, items, edtLayouts: EdtLayouts.parse(await json(kit, EDT_LAYOUTS_PATH)) };
}

async function readStubText(kit: StubSectorKit, file: string): Promise<Uint8Array | null> {
  for (const path of [file, `${STUBS_PREFIX}/${file}`]) if (kit.vfs.stat(path)) return kit.vfs.read(path);
  return null;
}

export async function openLaptopHarness(kit: StubSectorKit, ui: LaptopUiKit, options: LaptopHarnessOptions = {}): Promise<LaptopHarness> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), options.seed ?? DEFAULT_SEED, { hire: [] });
  const strings = await loadUiStrings(kit.read, 'eng');
  created.useLabels(strings);
  const sim = drivenSession(created, stubSessionSources(kit));
  const live = new Session('laptop-ui', sim);
  for (const h of options.hire ?? []) {
    const reply = live.dispatch({ type: 'aimHire', profile: h.profile, contract: h.contract, gear: false });
    if (!reply.ok) throw new Error(`cannot hire ${h.profile}: ${reply.reason}`);
  }
  const commands: LaptopCommand[] = [];
  const replies: LaptopCommandReply[] = [];
  const client: LaptopClient = {
    laptop: () => sim.view().laptop ?? null,
    strategic: () => sim.view().strategic ?? null,
    clock: () => sim.view().clock ?? null,
    command: async (cmd: LaptopCommand) => {
      commands.push(cmd);
      const reply = live.dispatch(cmd as Parameters<Session['dispatch']>[0]) as LaptopCommandReply;
      replies.push(reply);
      return reply;
    },
  };
  const t = await testRuntime();
  const edt = new EdtTextCache(ui.edtLayouts, edtEncodingOf(STUB_DATA_VERSION));
  const text = new StringsTextService(strings, (file, row) => edt.field(file, row));
  const box = ui.layouts.get(MESSAGE_BOX_LAYOUT);
  if (!box) throw new Error('no message box layout');
  const styles = messageBoxStyles(box);
  const harness = {
    t,
    session: sim,
    commands,
    replies,
    closed: false,
    laptop: () => {
      const laptop = sim.view().laptop;
      if (!laptop) throw new Error('the laptop is closed');
      return laptop;
    },
  } as LaptopHarness;
  const screen = new LaptopScreen({
    runtime: t.runtime,
    layouts: ui.layouts,
    text,
    client,
    data: {
      profile: (id) => ({ id, name: `Merc ${id}`, nickname: `M${id}`, faceIndex: id, aimBio: null }),
      item: (index) => ui.items.get(index),
    },
    media: {
      loadImages: async () => undefined,
      loadTexts: async (files) => {
        for (const file of files) {
          if (edt.has(file)) continue;
          const bytes = await readStubText(kit, file);
          if (bytes) edt.add(file, bytes);
        }
      },
      random: () => 0,
    },
    messageBoxStyle: (style) => styles[style] ?? (styles[0] as (typeof styles)[number]),
    messageBoxLabels: messageBoxLabels(text),
    dataVersion: STUB_DATA_VERSION,
    settings: { loadingTimeScale: 0, slideStepMs: 0, subtitles: true, speech: false },
    zoomOnOpen: false,
    zoomOnClose: false,
    onClosed: () => {
      harness.closed = true;
    },
  });
  Object.assign(harness, { screen });
  for (const name of LAPTOP_LAYOUTS) {
    const model = ui.layouts.get(name);
    if (!model) continue;
    for (const file of edtFilesOf(model)) {
      if (edt.has(file)) continue;
      const bytes = await readStubText(kit, file);
      if (bytes) edt.add(file, bytes);
    }
  }
  t.runtime.host.push(screen);
  await settleLaptop(t);
  return harness;
}

function edtFilesOf(model: LayoutModel): string[] {
  const files = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const v of value) visit(v);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    const o = value as Record<string, unknown>;
    if (Array.isArray(o.edt) && typeof o.edt[0] === 'string') files.add(o.edt[0]);
    for (const v of Object.values(o)) visit(v);
  };
  visit(model.json.widgets ?? []);
  return [...files];
}

export async function settleLaptop(t: TestRuntime, frames = SETTLE_FRAMES): Promise<void> {
  for (let i = 0; i < frames; i++) {
    t.frame();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export function findWidget(t: TestRuntime, id: string): WidgetInfo | undefined {
  return t.runtime.describe().find((w) => w.id === id);
}

export function shownWidget(t: TestRuntime, id: string): WidgetInfo {
  const w = findWidget(t, id);
  if (!w?.visible) throw new Error(`${id} is not shown`);
  return w;
}

export async function clickWidget(t: TestRuntime, id: string, button?: number): Promise<void> {
  const { rect } = shownWidget(t, id);
  const x = rect.x + Math.floor(rect.width / 2);
  const y = rect.y + Math.floor(rect.height / 2);
  t.move(x, y);
  t.frame();
  t.click(x, y, button);
  await settleLaptop(t);
}

export async function pressKey(t: TestRuntime, name: string): Promise<void> {
  t.runtime.input({ kind: 'keyDown', key: name, code: name, modifiers: 0 });
  t.runtime.input({ kind: 'keyUp', key: name, code: name, modifiers: 0 });
  await settleLaptop(t);
}

export async function dismissNewMail(h: LaptopHarness): Promise<void> {
  if (h.screen.newMailBox) await clickWidget(h.t, 'newMailOk');
}

export async function openWebPage(h: LaptopHarness, bookmark: number): Promise<void> {
  await dismissNewMail(h);
  const mode = BOOKMARK_MODES[bookmark];
  if (mode === undefined) throw new Error(`no page for bookmark ${bookmark}`);
  h.screen.shell.goToWebPage(bookmark);
  await settleLaptop(h.t, SETTLE_FRAMES * 2);
  if (h.screen.shell.mode !== mode) throw new Error(`the laptop shows mode ${h.screen.shell.mode}, not ${mode}`);
}

export async function openProgram(h: LaptopHarness, button: string): Promise<void> {
  await dismissNewMail(h);
  await clickWidget(h.t, button);
  await settleLaptop(h.t, SETTLE_FRAMES * 2);
}
