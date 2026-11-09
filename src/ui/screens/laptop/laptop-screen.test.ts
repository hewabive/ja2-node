import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { drivenSession, stubSessionSources } from '../../../../tests/support/session-reload.ts';
import { projectLayoutLoader, type TestRuntime, testRuntime } from '../../../../tests/support/ui-runtime.ts';
import { STUB_DATA_VERSION } from '../../../content/text/data-version.ts';
import { loadUiStrings } from '../../../content/text/strings.ts';
import type { LaptopView } from '../../../protocol/view.ts';
import { createCampaignSession } from '../../../server/campaign-factory.ts';
import { Session } from '../../../server/session.ts';
import type { DrawItem, ImageItem } from '../../draw-list.ts';
import type { LayoutModel } from '../../layout/model.ts';
import { messageBoxStyles } from '../../layout/styles.ts';
import { ORIGINAL_SKIN } from '../../layout/types.ts';
import { StringsTextService } from '../../text/text-service.ts';
import { messageBoxLabels } from '../../widgets/message-box.ts';
import type { WidgetInfo } from '../../widgets/widget-info.ts';
import type { LaptopClient, LaptopCommand, LaptopCommandReply } from './laptop-client.ts';
import { LaptopMode } from './laptop-modes.ts';
import { LAPTOP_LAYOUTS, LaptopScreen } from './laptop-screen.ts';

const SEED = 7;
const SETTLE_FRAMES = 6;
const CONNECTION_FRAMES = 60;
const STEP_MS = 16;
const SLIDE_FRAMES = 25;
const BW_SNOW = 'laptop/bwsnow.sti';
const MESSAGE_BOX_LAYOUT = 'message-box';
const IMP_INTRO_SUBJECT = 'Build your own mercenary';

let kit: StubSectorKit;
let layouts: Map<string, LayoutModel>;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  const loader = projectLayoutLoader();
  layouts = new Map();
  for (const name of [...LAPTOP_LAYOUTS, MESSAGE_BOX_LAYOUT]) layouts.set(name, await loader.load(ORIGINAL_SKIN, name));
});

afterAll(async () => {
  await kit.dispose();
});

interface Harness {
  readonly t: TestRuntime;
  readonly screen: LaptopScreen;
  readonly commands: string[];
  readonly elsewhere: (cmd: LaptopCommand) => void;
  closed: boolean;
}

type Dispatch = (cmd: LaptopCommand) => void;

interface LaptopOptions {
  readonly slideStepMs?: number;
  readonly zooms?: boolean;
  readonly backdrop?: () => readonly DrawItem[];
  readonly prepare?: (dispatch: Dispatch, laptop: () => LaptopView | null) => void;
}

async function openLaptop(options: LaptopOptions = {}): Promise<Harness> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), SEED, { hire: [] });
  const strings = await loadUiStrings(kit.read, 'eng');
  created.useLabels(strings);
  const sim = drivenSession(created, stubSessionSources(kit));
  const live = new Session('laptop-screen', sim);
  options.prepare?.(
    (cmd) => {
      const reply = live.dispatch(cmd as Parameters<Session['dispatch']>[0]);
      if (!reply.ok) throw new Error(`${cmd.type} refused: ${reply.reason}`);
    },
    () => sim.view().laptop ?? null,
  );
  const commands: string[] = [];
  const client: LaptopClient = {
    laptop: () => sim.view().laptop ?? null,
    strategic: () => sim.view().strategic ?? null,
    clock: () => sim.view().clock ?? null,
    command: async (cmd: LaptopCommand) => {
      commands.push(cmd.type);
      return live.dispatch(cmd as Parameters<Session['dispatch']>[0]) as LaptopCommandReply;
    },
  };
  const t = await testRuntime();
  const text = new StringsTextService(strings);
  const box = layouts.get(MESSAGE_BOX_LAYOUT);
  if (!box) throw new Error('no message box layout');
  const styles = messageBoxStyles(box);
  const elsewhere = (cmd: LaptopCommand) => void live.dispatch(cmd as Parameters<Session['dispatch']>[0]);
  const harness: Harness = { t, commands, elsewhere, closed: false, screen: null as unknown as LaptopScreen };
  const screen = new LaptopScreen({
    runtime: t.runtime,
    layouts,
    text,
    client,
    data: {
      profile: (id) => ({
        id,
        name: `Merc ${id}`,
        nickname: `M${id}`,
        faceIndex: id,
        eyes: [0, 0],
        mouth: [0, 0],
        blinkFrequency: 0,
        expressionFrequency: 0,
        aimBio: null,
      }),
      item: () => undefined,
      refreshProfiles: async () => undefined,
    },
    media: { loadImages: async () => undefined, loadTexts: async () => undefined, gaps: () => null, random: () => 0 },
    messageBoxStyle: (style) => styles[style] ?? (styles[0] as (typeof styles)[number]),
    messageBoxLabels: messageBoxLabels(text),
    dataVersion: STUB_DATA_VERSION,
    settings: { loadingTimeScale: 0, slideStepMs: options.slideStepMs ?? 0, subtitles: true, speech: false },
    zoomOnOpen: options.zooms === true,
    zoomOnClose: options.zooms === true,
    ...(options.backdrop ? { backdrop: options.backdrop } : {}),
    onClosed: () => {
      harness.closed = true;
    },
  });
  Object.assign(harness, { screen });
  t.runtime.host.push(screen);
  await settle(t);
  return harness;
}

async function settle(t: TestRuntime, frames = SETTLE_FRAMES): Promise<void> {
  for (let i = 0; i < frames; i++) {
    t.frame();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function find(t: TestRuntime, id: string): WidgetInfo | undefined {
  return t.runtime.describe().find((w) => w.id === id);
}

function shown(t: TestRuntime, id: string): WidgetInfo {
  const w = find(t, id);
  if (!w?.visible) throw new Error(`${id} is not shown`);
  return w;
}

async function click(t: TestRuntime, id: string, button?: number): Promise<void> {
  const { rect } = shown(t, id);
  const x = rect.x + Math.floor(rect.width / 2);
  const y = rect.y + Math.floor(rect.height / 2);
  t.move(x, y);
  t.frame();
  t.click(x, y, button);
  await settle(t);
}

async function key(t: TestRuntime, name: string): Promise<void> {
  t.runtime.input({ kind: 'keyDown', key: name, code: name, modifiers: 0 });
  t.runtime.input({ kind: 'keyUp', key: name, code: name, modifiers: 0 });
  await settle(t);
}

async function toAimMember(h: Harness): Promise<void> {
  await click(h.t, 'memberCardLink');
  await click(h.t, 'toMugShotsLink');
  await click(h.t, 'mugRegion0_0');
  expect(h.screen.shell.mode).toBe(LaptopMode.AIM_MEMBERS);
}

const MAP_PICTURE: DrawItem = { kind: 'fill', x: 1, y: 2, width: 3, height: 4, color: 0x123456 };
const ZOOM = 'laptopZoom';
const ZOOM_MS = 1000;
const CONTRACT_DAYS = 7;

function hireOne(dispatch: Dispatch, laptop: () => LaptopView | null): void {
  const profile = laptop()?.aim.find((a) => a.face === 'available')?.profile;
  if (profile === undefined) throw new Error('no A.I.M. merc available');
  dispatch({ type: 'aimHire', profile, contract: CONTRACT_DAYS, gear: false });
}

function leftWithAMercHired(dispatch: Dispatch, laptop: () => LaptopView | null): void {
  hireOne(dispatch, laptop);
  dispatch({ type: 'closeLaptop' });
  dispatch({ type: 'openLaptop' });
}

async function powerDown(h: Harness): Promise<void> {
  if (find(h.t, 'newMailOk')?.visible) await click(h.t, 'newMailOk');
  await click(h.t, 'powerButton');
  for (let i = 0; i < 10 && !h.commands.includes('closeLaptop'); i++) await settle(h.t);
  expect(h.commands).toContain('closeLaptop');
}

async function waitMs(t: TestRuntime, ms: number): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += STEP_MS) t.frame(STEP_MS);
  await settle(t, 1);
}

function drawnImages(t: TestRuntime): string[] {
  return t.list.items.filter((i): i is ImageItem => i.kind === 'image').map((i) => i.asset);
}

describe('the canvas laptop on a stub campaign', () => {
  it('greets with the new-mail box, reads and pages the I.M.P. mail and shows the finances', async () => {
    const { t, screen, commands } = await openLaptop();
    expect(screen.newMailBox).toBe(true);
    expect(shown(t, 'newMailOk').enabled).toBe(true);
    const images = t.list.items.filter((i): i is ImageItem => i.kind === 'image').map((i) => i.asset);
    expect(images).toContain('laptop/laptop3.sti');
    await click(t, 'newMailOk');
    expect(screen.newMailBox).toBe(false);

    await click(t, 'emailButton');
    expect(screen.shell.mode).toBe(LaptopMode.EMAIL);
    expect(shown(t, 'listPage').text).toBe('1 / 1');
    const unread = [0, 1, 2, 3, 4].find((i) => find(t, `unreadSubject${i}`)?.visible === true);
    expect(unread).toBeDefined();
    await click(t, `mailRow${unread}`);
    expect(commands).toContain('readEmail');
    expect(commands).toContain('emailText');
    expect(shown(t, 'viewerSubject.0').text).toBe(` ${IMP_INTRO_SUBJECT}`);
    expect(shown(t, 'mailPage.0').text).toBe('1 / 2');
    await click(t, 'nextMailPage.0');
    expect(shown(t, 'mailPage.0').text).toBe('2 / 2');
    await click(t, 'closeMail.0');
    expect(find(t, 'viewerSubject.0')?.visible ?? false).toBe(false);

    await click(t, 'financesButton');
    expect(screen.shell.mode).toBe(LaptopMode.FINANCES);
    expect(shown(t, 'amount7').text).toMatch(/^\$[\d,]+$/);
    await click(t, 'nextFinancePage');
    expect(shown(t, 'financePage').text).toMatch(/2 \/ 2$/);
  });

  it('asks to delete a mail opened unread from the new-mail icon as a read one, as showing it marks it read', async () => {
    const { t, screen } = await openLaptop();
    await click(t, 'newMailOk');
    await click(t, 'newMailIcon');
    expect(screen.shell.mode).toBe(LaptopMode.EMAIL);
    expect(shown(t, 'viewerSubject.0').text).toBe(` ${IMP_INTRO_SUBJECT}`);
    await click(t, 'deleteMail.0');
    expect(shown(t, 'deleteReadText').visible).toBe(true);
    expect(find(t, 'deleteUnreadText')?.visible ?? false).toBe(false);
  });

  it('opens the bookmarks on the first browser use, reaches the A.I.M. members and closes on Esc', async () => {
    const h = await openLaptop();
    const { t, screen, commands } = h;
    await click(t, 'newMailOk');
    await click(t, 'webButton');
    expect(screen.shell.showBookmarks).toBe(true);
    await key(t, 'Escape');
    expect(screen.shell.showBookmarks).toBe(false);
    expect(h.closed).toBe(false);
    await click(t, 'webButton');
    await click(t, 'bookmarkRegion0');
    expect(screen.shell.mode).toBe(LaptopMode.AIM);
    await click(t, 'memberCardLink');
    expect(screen.shell.mode).toBe(LaptopMode.AIM_MEMBERS_SORTED_FILES);
    await click(t, 'toMugShotsLink');
    expect(screen.shell.mode).toBe(LaptopMode.AIM_MEMBERS_FACIAL_INDEX);
    await click(t, 'mugRegion0_0');
    expect(screen.shell.mode).toBe(LaptopMode.AIM_MEMBERS);
    expect(shown(t, 'aimContact').visible).toBe(true);
    await key(t, 'Escape');
    await settle(t, 20);
    expect(commands).toContain('closeLaptop');
    expect(h.closed).toBe(true);
  });

  it('keeps the A.I.M. conference through a laptop program outside the web and drops it on another web page', async () => {
    const h = await openLaptop();
    const { t, screen } = h;
    await click(t, 'newMailOk');
    await click(t, 'webButton');
    await click(t, 'bookmarkRegion0');
    await toAimMember(h);
    await click(t, 'aimContact');
    await settle(t, CONNECTION_FRAMES);
    expect(shown(t, 'hire').visible).toBe(true);

    await click(t, 'emailButton');
    expect(screen.shell.mode).toBe(LaptopMode.EMAIL);
    await click(t, 'webButton');
    expect(screen.shell.mode).toBe(LaptopMode.AIM_MEMBERS);
    expect(shown(t, 'hire').visible).toBe(true);

    await click(t, 'webButton');
    await click(t, 'bookmarkRegion0');
    expect(screen.shell.mode).toBe(LaptopMode.AIM);
    await toAimMember(h);
    expect(find(t, 'hire')?.visible ?? false).toBe(false);
    expect(find(t, 'terminal')?.visible ?? false).toBe(false);
  });

  it("brings the merc's face back under its snow, without the terminal, to a page left while the title bar rose", async () => {
    const h = await openLaptop({ slideStepMs: STEP_MS });
    const { t, screen } = h;
    await click(t, 'newMailOk');
    await click(t, 'webButton');
    await settle(t, SLIDE_FRAMES);
    await click(t, 'bookmarkRegion0');
    await toAimMember(h);
    await click(t, 'aimContact');
    expect(drawnImages(t)).not.toContain(BW_SNOW);
    await click(t, 'emailButton');
    await settle(t, SLIDE_FRAMES);
    expect(screen.shell.mode).toBe(LaptopMode.EMAIL);
    await click(t, 'webButton');
    expect(screen.shell.mode).toBe(LaptopMode.AIM_MEMBERS);
    expect(find(t, 'terminal')?.visible ?? false).toBe(false);
    expect(drawnImages(t)).toContain(BW_SNOW);
  });

  it("zooms out of the map screen's picture taken as it opens, with no cursor and no input until the zoom ends", async () => {
    let picture: readonly DrawItem[] = [MAP_PICTURE];
    const h = await openLaptop({ zooms: true, backdrop: () => picture });
    picture = [];
    expect(h.t.sounds.played).toContainEqual({ file: 'sounds/laptop power up (8-11).wav', volume: 127 });
    expect(h.screen.hidesCursor).toBe(true);
    expect(find(h.t, ZOOM)?.state).toBe('opening');
    expect(h.t.list.items).toContainEqual(MAP_PICTURE);
    expect(h.t.list.items.find((i) => i.kind === 'snapshot')).toMatchObject({ sourceArea: { x: 0, y: 0, width: 640, height: 480 } });
    await waitMs(h.t, ZOOM_MS);
    expect(find(h.t, ZOOM)).toBeUndefined();
    expect(h.screen.hidesCursor).toBe(false);
    expect(h.t.list.items).not.toContainEqual(MAP_PICTURE);
  });

  it("powers down without the zoom while nobody was hired, and with a merc hired on the new game's laptop", async () => {
    const nobody = await openLaptop({ zooms: true });
    await waitMs(nobody.t, ZOOM_MS);
    await powerDown(nobody);
    expect(nobody.closed).toBe(true);
    const newGame = await openLaptop({ zooms: true, prepare: hireOne });
    await waitMs(newGame.t, ZOOM_MS);
    await powerDown(newGame);
    expect(newGame.closed).toBe(true);
  });

  it("powers down into the laptop button over the map screen's picture once the new game's laptop was left with a merc hired", async () => {
    const h = await openLaptop({ zooms: true, prepare: leftWithAMercHired, backdrop: () => [MAP_PICTURE] });
    await waitMs(h.t, ZOOM_MS);
    await powerDown(h);
    expect(h.closed).toBe(false);
    expect(find(h.t, ZOOM)?.state).toBe('closing');
    expect(h.t.sounds.played).toContainEqual({ file: 'sounds/laptop power down (8-11).wav', volume: 127 });
    expect(h.t.list.items).toContainEqual(MAP_PICTURE);
    await waitMs(h.t, ZOOM_MS);
    expect(h.closed).toBe(true);
  });

  it('closes without a command of its own when another client closes the laptop', async () => {
    const h = await openLaptop();
    await click(h.t, 'newMailOk');
    expect(h.closed).toBe(false);
    h.elsewhere({ type: 'closeLaptop' });
    await settle(h.t);
    expect(h.closed).toBe(true);
    expect(h.commands).not.toContain('closeLaptop');
  });
});
