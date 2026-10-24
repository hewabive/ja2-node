import { imageInfo, pcxAsRgbSti } from '../../src/app/game/ui-assets.ts';
import { decodeSti } from '../../src/content/formats/sti.ts';
import { loadItemTable } from '../../src/content/items/items.ts';
import { STUB_DATA_VERSION } from '../../src/content/text/data-version.ts';
import { loadUiStrings } from '../../src/content/text/strings.ts';
import type { CatalogueItem } from '../../src/protocol/items.ts';
import { createCampaignSession } from '../../src/server/campaign-factory.ts';
import type { CampaignSession } from '../../src/server/campaign-session.ts';
import { buildItemCatalogue } from '../../src/server/item-catalogue.ts';
import { Session } from '../../src/server/session.ts';
import { TextService } from '../../src/server/text-service.ts';
import type { LayoutModel } from '../../src/ui/layout/model.ts';
import { messageBoxStyles } from '../../src/ui/layout/styles.ts';
import { ORIGINAL_SKIN } from '../../src/ui/layout/types.ts';
import type { LaptopClient, LaptopCommand, LaptopCommandReply, LaptopData, LaptopItem } from '../../src/ui/screens/laptop/laptop-client.ts';
import { LAPTOP_LAYOUTS, LaptopScreen } from '../../src/ui/screens/laptop/laptop-screen.ts';
import { StringsTextService } from '../../src/ui/text/text-service.ts';
import { messageBoxLabels } from '../../src/ui/widgets/message-box.ts';
import type { WidgetInfo } from '../../src/ui/widgets/widget-info.ts';
import type { StubSectorKit } from './sectors.ts';
import { drivenSession, stubSessionSources } from './session-reload.ts';
import { projectLayoutLoader, type TestRuntime, testRuntime } from './ui-runtime.ts';

const MESSAGE_BOX_LAYOUT = 'message-box';
const SETTLE_FRAMES = 6;

export interface LaptopUiKit {
  readonly layouts: Map<string, LayoutModel>;
  readonly catalogue: readonly CatalogueItem[];
}

export async function laptopUiKit(kit: StubSectorKit): Promise<LaptopUiKit> {
  const loader = projectLayoutLoader();
  const layouts = new Map<string, LayoutModel>();
  for (const name of [...LAPTOP_LAYOUTS, MESSAGE_BOX_LAYOUT]) layouts.set(name, await loader.load(ORIGINAL_SKIN, name));
  const items = await loadItemTable(async (path) => JSON.parse(new TextDecoder().decode(await kit.vfs.read(path))));
  const encoded = await buildItemCatalogue(items, new TextService({ vfs: kit.vfs, dataVersion: 'stubs' }), 'eng');
  return { layouts, catalogue: encoded.catalogue.items };
}

export interface LaptopHarness {
  readonly t: TestRuntime;
  readonly screen: LaptopScreen;
  readonly session: CampaignSession;
  readonly live: Session;
  readonly commands: LaptopCommand[];
  readonly replies: LaptopCommandReply[];
  closed: boolean;
}

export interface LaptopHarnessOptions {
  readonly seed: number;
  readonly prepare?: (session: CampaignSession) => void;
}

async function loadImage(t: TestRuntime, kit: StubSectorKit, path: string): Promise<void> {
  const key = path.toLowerCase();
  if (t.images.info(key) || !kit.vfs.stat(key)) return;
  const bytes = await kit.vfs.read(key);
  t.images.set(key, imageInfo(key.endsWith('.pcx') ? pcxAsRgbSti(bytes) : decodeSti(bytes)));
}

function laptopData(catalogue: readonly CatalogueItem[], session: CampaignSession): LaptopData {
  const items = new Map<number, LaptopItem>(
    catalogue.map((i) => [
      i.index,
      {
        index: i.index,
        shortName: i.shortName,
        graphic: { path: i.inventoryGraphics.small.path, frame: i.inventoryGraphics.small.subImageIndex },
        bigGraphic: { path: i.inventoryGraphics.big.path, frame: i.inventoryGraphics.big.subImageIndex },
        catalogue: i,
      },
    ]),
  );
  return {
    profile: (id) => {
      const record = session.campaign.laptop?.profileRecord(id);
      return record
        ? { id, name: record.name, nickname: record.nickname, faceIndex: record.faceIndex ?? id, aimBio: null, mercBio: null }
        : undefined;
    },
    item: (index) => items.get(index),
  };
}

export async function openLaptopHarness(kit: StubSectorKit, ui: LaptopUiKit, options: LaptopHarnessOptions): Promise<LaptopHarness> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), options.seed, { hire: [] });
  const strings = await loadUiStrings(kit.read, 'eng');
  created.useLabels(strings);
  const session = drivenSession(created, stubSessionSources(kit));
  options.prepare?.(session);
  const live = new Session('laptop-sites', session);
  const commands: LaptopCommand[] = [];
  const replies: LaptopCommandReply[] = [];
  const client: LaptopClient = {
    laptop: () => session.view().laptop ?? null,
    strategic: () => session.view().strategic ?? null,
    clock: () => session.view().clock ?? null,
    command: async (cmd: LaptopCommand) => {
      commands.push(cmd);
      const reply = live.dispatch(cmd as Parameters<Session['dispatch']>[0]) as LaptopCommandReply;
      replies.push(reply);
      return reply;
    },
  };
  const t = await testRuntime();
  for (const model of ui.layouts.values()) for (const asset of model.assets.values()) await loadImage(t, kit, asset.path);
  const text = new StringsTextService(strings);
  const box = ui.layouts.get(MESSAGE_BOX_LAYOUT);
  if (!box) throw new Error('no message box layout');
  const styles = messageBoxStyles(box);
  const harness = { t, commands, replies, session, live, closed: false } as LaptopHarness;
  const screen = new LaptopScreen({
    runtime: t.runtime,
    layouts: ui.layouts,
    text,
    client,
    data: laptopData(ui.catalogue, session),
    media: {
      loadImages: async (paths) => {
        for (const path of paths) await loadImage(t, kit, path);
      },
      loadTexts: async () => undefined,
      random: () => 0,
    },
    messageBoxStyle: (style) => styles[style] ?? (styles[0] as (typeof styles)[number]),
    messageBoxLabels: messageBoxLabels(text),
    dataVersion: STUB_DATA_VERSION,
    settings: { loadingTimeScale: 0, slideStepMs: 0, subtitles: true, speech: false, metric: true },
    zoomOnOpen: false,
    zoomOnClose: false,
    onClosed: () => {
      harness.closed = true;
    },
  });
  Object.assign(harness, { screen });
  t.runtime.host.push(screen);
  await settle(t);
  return harness;
}

export async function settle(t: TestRuntime, frames = SETTLE_FRAMES): Promise<void> {
  for (let i = 0; i < frames; i++) {
    t.frame();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export function find(t: TestRuntime, id: string): WidgetInfo | undefined {
  return t.runtime.describe().find((w) => w.id === id);
}

export function shown(t: TestRuntime, id: string): WidgetInfo {
  const w = find(t, id);
  if (!w?.visible) throw new Error(`${id} is not shown`);
  return w;
}

export async function click(t: TestRuntime, id: string, button?: number): Promise<void> {
  const { rect } = shown(t, id);
  const x = rect.x + Math.floor(rect.width / 2);
  const y = rect.y + Math.floor(rect.height / 2);
  t.move(x, y);
  t.frame();
  t.click(x, y, button);
  await settle(t);
}

export async function key(t: TestRuntime, name: string, on: 'both' | 'down' | 'up' = 'both'): Promise<void> {
  if (on !== 'up') t.runtime.input({ kind: 'keyDown', key: name, code: name, modifiers: 0 });
  if (on !== 'down') t.runtime.input({ kind: 'keyUp', key: name, code: name, modifiers: 0 });
  await settle(t);
}

export async function type(t: TestRuntime, text: string): Promise<void> {
  t.runtime.input({ kind: 'text', text });
  await settle(t, 1);
}

export async function dismissModal(t: TestRuntime): Promise<void> {
  if (t.runtime.host.modal) await key(t, 'Enter', 'up');
}
