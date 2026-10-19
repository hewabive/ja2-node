import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { drivenSession, stubSessionSources } from '../../../../tests/support/session-reload.ts';
import { projectLayoutLoader, type TestRuntime, testRuntime } from '../../../../tests/support/ui-runtime.ts';
import { STUB_DATA_VERSION } from '../../../content/text/data-version.ts';
import { loadUiStrings } from '../../../content/text/strings.ts';
import { createCampaignSession } from '../../../server/campaign-factory.ts';
import { Session } from '../../../server/session.ts';
import type { ImageItem } from '../../draw-list.ts';
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
  closed: boolean;
}

async function openLaptop(): Promise<Harness> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), SEED, { hire: [] });
  const strings = await loadUiStrings(kit.read, 'eng');
  created.useLabels(strings);
  const sim = drivenSession(created, stubSessionSources(kit));
  const live = new Session('laptop-screen', sim);
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
  const harness: Harness = { t, commands, closed: false, screen: null as unknown as LaptopScreen };
  const screen = new LaptopScreen({
    runtime: t.runtime,
    layouts,
    text,
    client,
    data: {
      profile: (id) => ({ id, name: `Merc ${id}`, nickname: `M${id}`, faceIndex: id, aimBio: null }),
      item: () => undefined,
    },
    media: { loadImages: async () => undefined, loadTexts: async () => undefined, random: () => 0 },
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
});
