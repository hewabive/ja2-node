import { ClientRandom, seedFromText } from '../../audio/client-random.ts';
import type { ProfilePresentation } from '../../content/narrative/profile-presentation.ts';
import type { CatalogueItem } from '../../protocol/items.ts';
import type { DrawItem } from '../../ui/draw-list.ts';
import type { LayoutModel } from '../../ui/layout/model.ts';
import { messageBoxStyles } from '../../ui/layout/styles.ts';
import { ORIGINAL_SKIN } from '../../ui/layout/types.ts';
import type {
  LaptopClient,
  LaptopData,
  LaptopItem,
  LaptopMedia,
  LaptopMemory,
  LaptopProfile,
  LaptopSettings,
} from '../../ui/screens/laptop/laptop-client.ts';
import { LAPTOP_LAYOUTS, LaptopScreen } from '../../ui/screens/laptop/laptop-screen.ts';
import { messageBoxLabels } from '../../ui/widgets/message-box.ts';
import { preloadLayout, type UiBoot } from '../game/ui-boot.ts';
import type { SessionClient } from '../net/session-client.ts';
import { loadSettings } from '../settings.ts';

const MESSAGE_BOX_LAYOUT = 'message-box';
const RANDOM_SEED_TEXT = 'laptop';

export class SessionLaptopClient implements LaptopClient {
  readonly session: SessionClient;

  constructor(session: SessionClient) {
    this.session = session;
  }

  laptop() {
    return this.session.latestView?.laptop ?? null;
  }

  strategic() {
    return this.session.latestView?.strategic ?? null;
  }

  clock() {
    return this.session.latestView?.clock ?? null;
  }

  command(cmd: { readonly type: string; readonly [key: string]: unknown }) {
    return this.session.command(cmd);
  }
}

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function loadLaptopData(session: string, language: string | null): Promise<LaptopData> {
  const [profileList, itemList] = await Promise.all([
    json<{ profiles: ProfilePresentation[] }>(`/api/sessions/${encodeURIComponent(session)}/profiles`),
    json<{ items: CatalogueItem[] }>(`/api/items${language ? `?lang=${encodeURIComponent(language)}` : ''}`),
  ]);
  const profiles = new Map<number, LaptopProfile>(
    profileList.profiles.map((p) => [
      p.id,
      { id: p.id, name: p.name, nickname: p.nickname, faceIndex: p.faceIndex, aimBio: p.aimBio, mercBio: p.mercBio },
    ]),
  );
  const items = new Map<number, LaptopItem>(
    itemList.items.map((i) => [
      i.index,
      {
        index: i.index,
        shortName: i.shortName,
        graphic: { path: i.inventoryGraphics.small.path, frame: i.inventoryGraphics.small.subImageIndex },
        name: i.longName,
        ammoCapacity: i.magazine?.capacity ?? null,
        gunCalibre: i.weapon?.calibre?.name ?? null,
        bigGraphic: { path: i.inventoryGraphics.big.path, frame: i.inventoryGraphics.big.subImageIndex },
        catalogue: i,
      },
    ]),
  );
  return { profile: (id) => profiles.get(id), item: (index) => items.get(index) };
}

export function laptopMedia(ui: UiBoot, random: ClientRandom): LaptopMedia {
  return {
    loadImages: async (paths) => {
      await Promise.all(paths.map((path) => ui.assets.image(path.toLowerCase())));
    },
    loadTexts: async (files) => {
      for (const file of files) {
        if (ui.edt.has(file)) continue;
        const bytes = await ui.source.readOptional(file);
        if (bytes) ui.edt.add(file, bytes);
      }
    },
    random: (range) => random.int(range),
  };
}

export function laptopSettings(overrides: Partial<LaptopSettings> = {}): LaptopSettings {
  const settings = loadSettings();
  return {
    loadingTimeScale: settings.websiteLoadingTimeScale,
    subtitles: settings.subtitles,
    speech: settings.speech,
    metric: settings.display.useMetricSystem,
    ...overrides,
  };
}

export async function loadLaptopLayouts(ui: UiBoot, skin = ORIGINAL_SKIN): Promise<Map<string, LayoutModel>> {
  const layouts = new Map<string, LayoutModel>();
  for (const name of [...LAPTOP_LAYOUTS, MESSAGE_BOX_LAYOUT]) {
    const model = await ui.layouts.load(skin, name);
    await preloadLayout(ui, model);
    layouts.set(name, model);
  }
  return layouts;
}

export interface LaptopBootOptions {
  readonly session: SessionClient;
  readonly memory?: LaptopMemory;
  readonly settings?: Partial<LaptopSettings>;
  readonly zoomOnOpen?: boolean;
  readonly zoomOnClose?: boolean;
  readonly backdrop?: readonly DrawItem[];
  readonly onClosed?: () => void;
  readonly onQuitRequest?: () => void;
  readonly onHelp?: () => void;
}

export async function bootLaptopScreen(ui: UiBoot, options: LaptopBootOptions): Promise<LaptopScreen> {
  const session = options.session.session;
  if (!session) throw new Error('the laptop needs a session');
  const layouts = await loadLaptopLayouts(ui);
  const messageBox = layouts.get(MESSAGE_BOX_LAYOUT);
  if (!messageBox) throw new Error('the message box layout is missing');
  const styles = messageBoxStyles(messageBox);
  const fallback = styles[0];
  if (!fallback) throw new Error('the message box layout has no styles');
  const data = await loadLaptopData(session, loadSettings().language);
  return new LaptopScreen({
    runtime: ui.runtime,
    layouts,
    text: ui.text,
    client: new SessionLaptopClient(options.session),
    data,
    media: laptopMedia(ui, new ClientRandom(seedFromText(RANDOM_SEED_TEXT))),
    messageBoxStyle: (style) => styles[style] ?? fallback,
    messageBoxLabels: messageBoxLabels(ui.text),
    dataVersion: ui.dataVersion,
    settings: laptopSettings(options.settings),
    ...(options.memory ? { memory: options.memory } : {}),
    ...(options.zoomOnOpen === undefined ? {} : { zoomOnOpen: options.zoomOnOpen }),
    ...(options.zoomOnClose === undefined ? {} : { zoomOnClose: options.zoomOnClose }),
    ...(options.backdrop ? { backdrop: options.backdrop } : {}),
    ...(options.onClosed ? { onClosed: options.onClosed } : {}),
    ...(options.onQuitRequest ? { onQuitRequest: options.onQuitRequest } : {}),
    ...(options.onHelp ? { onHelp: options.onHelp } : {}),
  });
}
