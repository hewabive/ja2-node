import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bigPictureShapes, SHAPE_LOOKS, smallSheetPlans, stubItemTable } from '../../../../stubs/ui/items.ts';
import { planStubSkin, readOriginalLayouts } from '../../../../stubs/ui/skin.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { FakeMedia, type TacticalUiKit, tacticalUiKit } from '../../../../tests/support/tactical-ui.ts';
import { projectLayoutLoader, type TestRuntime, testRuntime } from '../../../../tests/support/ui-runtime.ts';
import { loadUiStrings } from '../../../content/text/strings.ts';
import { PROJECT_DATA_DIR } from '../../../node/repo.ts';
import type { ItemInfo } from '../../../protocol/hints.ts';
import type { CatalogueItem } from '../../../protocol/items.ts';
import type { InventoryQuery, StashEntryView } from '../../../protocol/map-inventory.ts';
import type { MessageEntry } from '../../../protocol/message-log.ts';
import type { CommandEnvelope } from '../../../protocol/messages.ts';
import type { InventoryItemView, PlayerView, StrategicMercView } from '../../../protocol/view.ts';
import { CursorId, EXTERN_CURSOR } from '../../cursors/cursor-ids.ts';
import type { HintAnswer, HintReply } from '../../game-client.ts';
import { KeyModifier, MouseButton } from '../../input/events.ts';
import type { LayoutModel } from '../../layout/model.ts';
import { messageBoxStyles, textBoxArt } from '../../layout/styles.ts';
import { ORIGINAL_SKIN } from '../../layout/types.ts';
import { CanvasMessageBoxes } from '../../message-boxes.ts';
import { FontName } from '../../text/fonts.ts';
import { stringPixLength } from '../../text/measure.ts';
import { sprintMoney } from '../../text/money.ts';
import { glyphRun } from '../../text/print.ts';
import { StringsTextService } from '../../text/text-service.ts';
import { MessageBoxFlag, MessageBoxReturn, messageBoxLabels } from '../../widgets/message-box.ts';
import type { BattleEnvironment } from '../battle/environment.ts';
import type { MapClient, MapCommandReply, MapEnvironment, MapLayout } from './environment.ts';
import type { MapFacts } from './facts.ts';
import { MapInventory } from './map-inventory.ts';

const HAND = 5;
const BIG_POCKET = 7;
const SMALL_POCKET = 11;
const MERC = 3;
const OTHER = 4;
const POOL_LEFT = 270;
const RANGE_IN_TILES = 12;
const STATS_TEXT = 5;
const MAP_DESCRIPTION_PRIORITY = 125;
const MAP_MONEY_VALUE_WIDTH = 35;
const MAP_MONEY_REMAINING = [61, 107, 75] as const;
const MAP_MONEY_REMOVING = [61, 135, 70] as const;
const MONEY_SEPARATE = 4;

let kit: StubSectorKit;
let ui: TacticalUiKit;
let models: Map<string, LayoutModel>;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await tacticalUiKit(kit);
  const loader = projectLayoutLoader();
  models = new Map([
    ['map-screen', await loader.load(ORIGINAL_SKIN, 'map-screen')],
    ['map-inventory', await loader.load(ORIGINAL_SKIN, 'map-inventory')],
  ]);
});

afterAll(async () => {
  await kit.dispose();
});

class FakeClient implements MapClient {
  view: PlayerView;
  readonly commands: CommandEnvelope[] = [];
  readonly queries: CommandEnvelope[] = [];
  readonly hints: CommandEnvelope[] = [];
  readonly paused = false;
  stash: StashEntryView[] = [];
  usable = true;
  reply: (cmd: CommandEnvelope) => MapCommandReply = () => ({ ok: true });
  compatible: (item: number, candidate: number) => boolean = () => false;
  itemInfo: ItemInfo | null = null;
  queriesAnswered: Promise<void> = Promise.resolve();

  constructor(view: PlayerView) {
    this.view = view;
  }

  get latestView(): PlayerView {
    return this.view;
  }

  async command(cmd: CommandEnvelope): Promise<MapCommandReply> {
    this.commands.push(cmd);
    return this.reply(cmd);
  }

  start(): void {}

  stop(): void {}

  setPaused(): void {}

  holdTime(): void {}

  onRefused(): void {}

  hint(request: CommandEnvelope): HintReply {
    this.hints.push(request);
    if (request.type === 'itemInfo' && this.itemInfo) return { state: 'ready', answer: { ok: true, data: this.itemInfo }, source: 'local' };
    if (request.type !== 'compatibleItems') return { state: 'ready', answer: { ok: false, reason: 'noSector' }, source: 'local' };
    const item = request.item as number;
    const compatible = (request.items as number[]).map((candidate) => this.compatible(item, candidate));
    return { state: 'ready', answer: { ok: true, data: { compatible } }, source: 'local' };
  }

  async hintNow(): Promise<HintAnswer> {
    return { ok: false, reason: 'noSector' };
  }

  async query(request: CommandEnvelope): Promise<HintAnswer> {
    this.queries.push(request);
    await this.queriesAnswered;
    const answer: InventoryQuery = { sector: String(request.sector), z: 0, usable: this.usable, stash: this.stash, mercs: [] };
    return { ok: true, data: answer };
  }
}

class FakeMapMedia extends FakeMedia {
  readonly board = { normal: 'b', ltRed: 'b', dkRed: 'b', ltGreen: 'b', dkGreen: 'b' };
  readonly radar = () => null;

  messages(): readonly MessageEntry[] {
    return [];
  }

  dialogueText(): string | null {
    return null;
  }
}

interface Harness {
  readonly t: TestRuntime;
  readonly text: StringsTextService;
  readonly client: FakeClient;
  readonly inventory: MapInventory;
  readonly boxes: string[];
  info: StrategicMercView | null;
  answer: number;
  settle(): Promise<void>;
  click(id: string, button?: number, modifiers?: number): Promise<void>;
  hover(id: string): void;
  widget(id: string): { readonly rect: { x: number; y: number; width: number; height: number }; readonly text: string | null };
}

function item(predicate: (i: CatalogueItem) => boolean): CatalogueItem {
  const found = ui.catalogue.items.find(predicate);
  if (!found) throw new Error('no such stub item');
  return found;
}

function view(slot: number, name: string, count = 1, index = 0): InventoryItemView {
  return { slot, item: name, index, count, status: Array.from({ length: count }, () => 88) };
}

function merc(id: number, name: string, sector: string, inventory: InventoryItemView[]): StrategicMercView {
  return {
    id,
    name,
    sector,
    betweenSectors: false,
    squad: 0,
    assignment: 0,
    life: 80,
    lifeMax: 80,
    breath: 100,
    breathMax: 100,
    asleep: false,
    inventory,
    weight: 31,
    armour: 23,
    camo: 4,
  };
}

function gunInfo(gun: CatalogueItem, range: number): ItemInfo {
  const stat = (value: number) => ({ value, exceptional: false });
  return {
    item: gun.index,
    kind: 'weapon',
    count: 1,
    weight: 1.2,
    status: 88,
    weapon: { status: 88, weight: stat(1.2), range: stat(range), damage: stat(20), ap: stat(9), bullets: { single: 1, burst: 0 } },
  };
}

function drawnRuns(h: Harness, text: string): { x: number; y: number; foreground: number }[] {
  const font = h.t.runtime.fonts.get(FontName.BLOCKFONT2);
  const wanted = glyphRun(font, text, 0, 0)
    .glyphs.map((g) => g.index)
    .join();
  return h.t.list.items.flatMap((i) =>
    i.kind === 'glyphs' && i.glyphs.map((g) => g.index).join() === wanted
      ? [{ x: i.glyphs[0]?.x ?? 0, y: i.glyphs[0]?.y ?? 0, foreground: i.foreground }]
      : [],
  );
}

function descriptionButton(h: Harness, id: string): { x: number; y: number; width: number; height: number } {
  const rect = h.t.runtime.buttons.buttons.find((b) => b.id === id)?.describe().rect;
  if (!rect) throw new Error(`no button ${id}`);
  return rect;
}

async function clickDescriptionButton(h: Harness, id: string, button: number = MouseButton.LEFT): Promise<void> {
  const rect = descriptionButton(h, id);
  h.t.click(rect.x + Math.floor(rect.width / 2), rect.y + Math.floor(rect.height / 2), button);
  await h.settle();
}

function playerView(mercs: StrategicMercView[]): PlayerView {
  return { tick: 1, soldiers: [], items: [], strategic: { mercs } } as unknown as PlayerView;
}

function stashEntry(index: number, name: string, count = 1, reachable = true): StashEntryView {
  return { index, item: name, count, status: Array.from({ length: count }, () => 70), reachable, gridNo: 1000 + index, level: 0 };
}

async function stubImages(t: TestRuntime): Promise<void> {
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
  for (const plan of planStubSkin(await readOriginalLayouts()).values())
    t.images.set(plan.path, {
      kind: 'indexed',
      animatedFrames: plan.animated,
      frames: plan.frames.map((f) => ({ width: f.width, height: f.height, offsetX: 0, offsetY: 0 })),
    });
}

async function harness(mercs: StrategicMercView[]): Promise<Harness> {
  const t = await testRuntime();
  await stubImages(t);
  const strings = await loadUiStrings(async (path) => new Uint8Array(await readFile(join(PROJECT_DATA_DIR, path))), 'eng');
  const text = new StringsTextService(strings);
  const styles = messageBoxStyles(ui.messageBox);
  const style = (s: number) => styles[s] ?? (styles[0] as (typeof styles)[number]);
  const labels = messageBoxLabels(text);
  const client = new FakeClient(playerView(mercs));
  const env: MapEnvironment = {
    runtime: t.runtime,
    text,
    layout: (name: MapLayout) => models.get(name) as LayoutModel,
    boxes: new CanvasMessageBoxes({ services: t.runtime, style, labels: () => labels }),
    messageBoxStyle: style,
    messageBoxLabels: labels,
    basicTextBox: textBoxArt(ui.messageBox, (ui.messageBox.style('textBoxes') as Record<string, unknown>).basic),
    client,
    prompts: () => null,
    media: new FakeMapMedia(ui.catalogue),
    facts: {} as MapFacts,
    flow: {
      options: () => undefined,
      saveGame: () => undefined,
      loadGame: () => undefined,
      quickSave: async () => null,
      quickLoad: () => undefined,
      exitGame: () => undefined,
      preBattle: () => undefined,
    },
    sounds: {
      glowClick: () => undefined,
      newMessageBeep: () => undefined,
      confirmRoute: () => undefined,
      vehicleEntered: () => undefined,
      mercDiedOffTheMap: () => undefined,
      damageFeedback: () => undefined,
      skillCheckFailed: () => undefined,
      reloaded: () => undefined,
    },
    random: () => 0,
    metric: () => true,
    notifySleepWake: () => true,
    battle: {} as BattleEnvironment,
    version: '',
    gameOptions: async () => null,
    radarItemDot: (gridNo) => ({ x: gridNo % 100, y: 1 }),
  };
  const boxes: string[] = [];
  const h: Harness = {
    t,
    text,
    client,
    boxes,
    info: mercs[0] ?? null,
    answer: MessageBoxReturn.YES,
    inventory: undefined as unknown as MapInventory,
    settle: async () => {
      for (let i = 0; i < 4; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        h.inventory.update(t.now);
        t.frame();
      }
    },
    click: async (id, button = 0, modifiers = 0) => {
      const { rect } = h.widget(id);
      const x = rect.x + Math.floor(rect.width / 2);
      const y = rect.y + Math.floor(rect.height / 2);
      t.runtime.input({ kind: 'pointerMove', x, y, button, buttons: 0, wheel: 0, modifiers });
      t.frame();
      t.runtime.input({ kind: 'pointerDown', x, y, button, buttons: 0, wheel: 0, modifiers });
      t.frame();
      t.runtime.input({ kind: 'pointerUp', x, y, button, buttons: 0, wheel: 0, modifiers });
      await h.settle();
    },
    hover: (id) => {
      const { rect } = h.widget(id);
      const x = rect.x + Math.floor(rect.width / 2);
      const y = rect.y + Math.floor(rect.height / 2);
      t.runtime.input({ kind: 'pointerMove', x, y, button: 0, buttons: 0, wheel: 0, modifiers: 0 });
      t.frame();
    },
    widget: (id) => {
      const found = h.inventory.describe().find((w) => w.id === id);
      if (!found) throw new Error(`no widget ${id}`);
      return found;
    },
  };
  const inventory = new MapInventory({
    env,
    infoMerc: () => h.info,
    location: () => ({ sector: 'D13', z: 0 }),
    box: async (message: string, flags: MessageBoxFlag) => {
      boxes.push(message);
      return flags === MessageBoxFlag.YESNO ? h.answer : MessageBoxReturn.OK;
    },
    shift: () => (t.runtime.modifiers & KeyModifier.SHIFT) !== 0,
    ctrl: () => (t.runtime.modifiers & KeyModifier.CTRL) !== 0,
    mercClosed: () => undefined,
    poolClosed: () => undefined,
  });
  (h as { inventory: MapInventory }).inventory = inventory;
  t.runtime.host.push({
    id: 'mapStub',
    enter: () => inventory.enter(),
    exit: () => inventory.exit(),
    update: (now: number) => inventory.update(now),
    input: () => false,
    render: (list) => inventory.render(list),
    describe: () => inventory.describe(),
  });
  t.frame();
  return h;
}

describe('the map screen inventory over a scripted session', () => {
  it('shows the selected merc inventory at the map positions with his armour, weight and camouflage', async () => {
    const gun = item((i) => i.class === 'GUN');
    const h = await harness([merc(MERC, 'Hollis', 'D13', [view(HAND, gun.name), view(SMALL_POCKET, gun.name)])]);
    h.inventory.openMerc();
    await h.settle();
    expect(h.widget('mercSlot5').text).toContain(gun.longName);
    expect(h.widget('armour').text).toBe(' 23%');
    expect(h.widget('weight').text).toBe('31%');
    expect(h.widget('camo').text).toBe('4%');
    expect(h.widget('mercSlot11').rect).toMatchObject({ x: 22, y: 251 });
    const drawn = h.t.list.items.filter((i) => i.kind === 'image' && i.asset === gun.inventoryGraphics.small.path.toLowerCase());
    expect(drawn.length).toBeGreaterThanOrEqual(2);
    expect(
      h.t.list.items.some((i) => i.kind === 'image' && i.asset === 'interface/inventory_normal_male.sti' && i.x === 71 && i.y === 116),
    ).toBe(true);
  });

  it('moves an item between slots and to a teammate through the client cursor', async () => {
    const gun = item((i) => i.class === 'GUN');
    const h = await harness([merc(MERC, 'Hollis', 'D13', [view(HAND, gun.name)]), merc(OTHER, 'Vant', 'D13', [])]);
    h.inventory.openMerc();
    await h.settle();
    await h.click('mercSlot5');
    expect(h.inventory.cursorItem).toBe(gun.name);
    expect(h.inventory.holding).toBe(true);
    await h.click('mercSlot7');
    expect(h.client.commands.at(-1)).toEqual({ type: 'moveItem', soldier: MERC, from: HAND, to: BIG_POCKET, count: 1 });
    expect(h.inventory.holding).toBe(false);
    await h.click('mercSlot5');
    h.info = h.client.view.strategic?.mercs[1] ?? null;
    await h.click('mercSlot7');
    expect(h.client.commands.at(-1)).toMatchObject({ type: 'moveItem', soldier: MERC, from: HAND, to: BIG_POCKET, toSoldier: OTHER });
  });

  it('shows the normal pointer as soon as the held item goes into a slot, with the mouse still (MAPEndItemPointer)', async () => {
    const gun = item((i) => i.class === 'GUN');
    const h = await harness([merc(MERC, 'Hollis', 'D13', [view(HAND, gun.name)])]);
    h.inventory.openMerc();
    await h.settle();
    await h.click('mercSlot5');
    expect(h.t.runtime.cursor.current).toBe(EXTERN_CURSOR);
    await h.click('mercSlot7');
    expect([h.inventory.holding, h.t.runtime.cursor.current, h.t.runtime.cursorReport().visible]).toEqual([false, CursorId.NORMAL, true]);
  });

  it('splits money from the description box into the cursor and puts the split into another pocket', async () => {
    const money: InventoryItemView = { ...view(SMALL_POCKET, 'MONEY'), money: 500 };
    const h = await harness([merc(MERC, 'Hollis', 'D13', [money])]);
    h.inventory.openMerc();
    await h.settle();
    await h.click(`mercSlot${SMALL_POCKET}`, MouseButton.RIGHT);
    expect(h.inventory.merc.description.open).toBe(true);
    const clickButton = async (id: string) => {
      const rect = h.t.runtime.buttons.buttons.find((b) => b.id === id)?.describe().rect;
      if (!rect) throw new Error(`no button ${id}`);
      h.t.click(rect.x + Math.floor(rect.width / 2), rect.y + Math.floor(rect.height / 2));
      await h.settle();
    };
    await clickButton('itemDescriptionMoney1');
    await clickButton('itemDescriptionMoneyDone');
    expect(h.inventory.merc.panel.cursor?.source).toEqual({ kind: 'money', soldier: MERC, slot: SMALL_POCKET, amount: 100 });
    expect(h.inventory.cursorItem).toBe('MONEY');
    await h.click('mercSlot7');
    expect(h.client.commands.at(-1)).toEqual({ type: 'splitMoney', soldier: MERC, slot: SMALL_POCKET, amount: 100, to: BIG_POCKET });
    expect(h.inventory.holding).toBe(false);
  });

  it('throws the cursor item away after the trash can question', async () => {
    const gun = item((i) => i.class === 'GUN');
    const h = await harness([merc(MERC, 'Hollis', 'D13', [view(HAND, gun.name)])]);
    h.inventory.openMerc();
    await h.settle();
    await h.click('mercSlot5');
    h.answer = MessageBoxReturn.NO;
    await h.click('trashCan');
    expect(h.boxes).toEqual(['You’ll never see it again. You sure?'.replace('’', "'")]);
    expect(h.client.commands).toEqual([]);
    h.answer = MessageBoxReturn.YES;
    await h.click('trashCan');
    expect(h.client.commands).toEqual([{ type: 'discardItem', soldier: MERC, slot: HAND, count: 1 }]);
    expect(h.inventory.holding).toBe(false);
  });

  it('asks the second trash question for an object with ubMission (TrashCanBtnCallback)', async () => {
    const gun = item((i) => i.class === 'GUN');
    const h = await harness([merc(MERC, 'Hollis', 'D13', [{ ...view(HAND, gun.name), mission: 1 }])]);
    h.inventory.openMerc();
    await h.settle();
    await h.click('mercSlot5');
    h.answer = MessageBoxReturn.NO;
    await h.click('trashCan');
    expect(h.boxes).toEqual(['This item looks REALLY important. Are you REALLY REALLY sure you want to trash it?']);
    expect(h.client.commands).toEqual([]);
  });

  it('pages the sector inventory, counts its objects and blocks Done while an item is held', async () => {
    const gun = item((i) => i.class === 'GUN');
    const h = await harness([merc(MERC, 'Hollis', 'D13', [view(HAND, gun.name)])]);
    h.client.stash = Array.from({ length: 50 }, (_, i) => stashEntry(i, gun.name, i === 0 ? 3 : 1));
    h.inventory.openPool();
    await h.settle();
    expect(h.client.queries.at(-1)).toEqual({ type: 'inventory', sector: 'D13' });
    expect(h.widget('poolLocation').text).toBe('D13');
    expect(h.widget('poolCount').text).toBe('52');
    expect(h.widget('poolPage').text).toBe('1 / 2');
    expect(h.widget('poolPrev')).toMatchObject({ enabled: false });
    await h.click('poolNext');
    expect(h.widget('poolPage').text).toBe('2 / 2');
    await h.click('poolPrev');
    await h.click('poolSlot0');
    expect(h.inventory.pool.cursor).toMatchObject({ index: 0, count: 1 });
    expect(h.widget('poolDone')).toMatchObject({ enabled: false });
  });

  it('puts a merc item into the pool and takes a pool item into a merc slot', async () => {
    const gun = item((i) => i.class === 'GUN');
    const h = await harness([merc(MERC, 'Hollis', 'D13', [view(HAND, gun.name)])]);
    h.client.stash = [stashEntry(0, gun.name, 2)];
    h.inventory.openMerc();
    h.inventory.openPool();
    await h.settle();
    await h.click('mercSlot5');
    await h.click('poolSlot3');
    expect(h.client.commands.at(-1)).toEqual({ type: 'moveItem', soldier: MERC, from: HAND, to: 'ground', sector: 'D13', count: 1 });
    await h.click('mercSlot5');
    await h.click('poolSlot0');
    expect(h.client.commands.at(-1)).toMatchObject({ to: 'ground', stashIndex: 0 });
    await h.click('poolSlot0', 0, KeyModifier.SHIFT);
    expect(h.inventory.pool.cursor).toMatchObject({ index: 0, count: 'all' });
    await h.click('mercSlot11');
    expect(h.client.commands.at(-1)).toEqual({
      type: 'moveItem',
      soldier: MERC,
      from: 'ground',
      item: 0,
      to: SMALL_POCKET,
      sector: 'D13',
    });
    expect(h.inventory.pool.cursor).toBeNull();
  });

  it('keeps an item on its cursor until the refreshed pool answers, so it never shows in both places or in neither', async () => {
    const gun = item((i) => i.class === 'GUN');
    const hollis = (inventory: InventoryItemView[]) => [merc(MERC, 'Hollis', 'D13', inventory)];
    const h = await harness(hollis([view(HAND, gun.name)]));
    h.inventory.openMerc();
    h.inventory.openPool();
    await h.settle();
    let answer: () => void = () => undefined;
    const holdQueries = () => {
      h.client.queriesAnswered = new Promise((resolve) => {
        answer = resolve;
      });
    };
    h.client.reply = () => {
      h.client.view = playerView(hollis([]));
      h.client.stash = [stashEntry(0, gun.name)];
      return { ok: true };
    };
    await h.click('mercSlot5');
    holdQueries();
    await h.click('poolSlot0');
    expect(h.inventory.merc.panel.cursor).toMatchObject({ item: gun.name });
    expect(h.inventory.pool.stash).toEqual([]);
    answer();
    await h.settle();
    expect(h.inventory.merc.panel.cursor).toBeNull();
    expect(h.inventory.pool.stash).toEqual([stashEntry(0, gun.name)]);
    h.client.reply = () => {
      h.client.view = playerView(hollis([view(HAND, gun.name)]));
      h.client.stash = [];
      return { ok: true };
    };
    await h.click('poolSlot0');
    holdQueries();
    await h.click('mercSlot5');
    expect(h.inventory.pool.cursor).toMatchObject({ index: 0 });
    answer();
    await h.settle();
    expect(h.inventory.pool.cursor).toBeNull();
    expect(h.inventory.pool.stash).toEqual([]);
  });

  it('keeps the pool as it opened while it is open: a take leaves its slot empty and a placement lands in the clicked slot (Map_Screen_Interface_Map_Inventory.cc:579-601, :774-815)', async () => {
    const gun = item((i) => i.class === 'GUN');
    const hollis = (inventory: InventoryItemView[]) => [merc(MERC, 'Hollis', 'D13', inventory)];
    const h = await harness(hollis([]));
    h.client.stash = [stashEntry(7, gun.name), stashEntry(3, gun.name), stashEntry(5, gun.name)];
    h.inventory.openMerc();
    h.inventory.openPool();
    await h.settle();
    expect(h.inventory.pool.layout.slice(0, 4)).toEqual([7, 3, 5, null]);
    h.client.reply = () => {
      h.client.view = playerView(hollis([view(HAND, gun.name)]));
      h.info = hollis([view(HAND, gun.name)])[0] ?? null;
      h.client.stash = [stashEntry(7, gun.name), stashEntry(5, gun.name)];
      return { ok: true, data: { item: gun.name, count: 1 } };
    };
    await h.click('poolSlot1');
    await h.click('mercSlot5');
    expect(h.inventory.pool.layout.slice(0, 4)).toEqual([7, null, 5, null]);
    expect(h.inventory.pool.pageEntries()[1]).toBeNull();
    h.client.reply = () => {
      h.client.view = playerView(hollis([]));
      h.info = hollis([])[0] ?? null;
      h.client.stash = [stashEntry(7, gun.name), stashEntry(3, gun.name), stashEntry(5, gun.name)];
      return { ok: true, data: { item: gun.name, count: 1, stashIndex: 3 } };
    };
    await h.click('mercSlot5');
    await h.click('poolSlot10');
    expect(h.client.commands.at(-1)).toMatchObject({ type: 'moveItem', from: HAND, to: 'ground' });
    expect(h.inventory.pool.layout.slice(0, 11)).toEqual([7, null, 5, null, null, null, null, null, null, null, 3]);
  });

  it('shows the pool only once its stash answers, as the original builds the stash as the pool opens (Map_Screen_Interface_Map_Inventory.cc:300)', async () => {
    const gun = item((i) => i.class === 'GUN');
    const h = await harness([merc(MERC, 'Hollis', 'D13', [])]);
    h.client.stash = [stashEntry(0, gun.name)];
    let answer: () => void = () => undefined;
    h.client.queriesAnswered = new Promise((resolve) => {
      answer = resolve;
    });
    h.inventory.openPool();
    await h.settle();
    expect(h.inventory.pool.open).toBe(true);
    expect(h.inventory.pool.shown).toBe(false);
    expect(h.widget('poolDone')).toMatchObject({ visible: false });
    answer();
    await h.settle();
    expect(h.inventory.pool.shown).toBe(true);
    expect(h.widget('poolDone')).toMatchObject({ visible: true, enabled: true });
  });

  it('writes the pool back in the order it shows as it closes, empty slots left out (SaveSeenAndUnseenItems)', async () => {
    const gun = item((i) => i.class === 'GUN');
    const h = await harness([merc(MERC, 'Hollis', 'D13', [])]);
    h.client.stash = [stashEntry(7, gun.name), stashEntry(3, gun.name)];
    h.inventory.openPool();
    await h.settle();
    h.client.stash = [stashEntry(3, gun.name)];
    await h.inventory.pool.refresh();
    await h.click('poolDone');
    expect(h.inventory.pool.open).toBe(false);
    expect(h.client.commands).toEqual([{ type: 'arrangeStash', sector: 'D13', order: [3] }]);
  });

  it("moves a pool item onto another pool slot and keeps the cursor on what the placement leaves, as the original's pool cursor does (MapInvenPoolSlotsPrimary)", async () => {
    const gun = item((i) => i.class === 'GUN');
    const ammo = item((i) => i.class === 'AMMO');
    const h = await harness([merc(MERC, 'Hollis', 'D13', [])]);
    h.client.stash = [stashEntry(0, gun.name), stashEntry(1, ammo.name)];
    h.inventory.openPool();
    await h.settle();
    h.client.reply = () => {
      h.client.stash = [stashEntry(0, gun.name), stashEntry(2, ammo.name)];
      return { ok: true, data: { item: ammo.name, count: 1, stashIndex: 2 } };
    };
    await h.click('poolSlot1');
    await h.click('poolSlot4');
    expect(h.client.commands.at(-1)).toEqual({
      type: 'moveItem',
      soldier: MERC,
      from: 'ground',
      item: 1,
      to: 'ground',
      sector: 'D13',
      count: 1,
    });
    expect(h.inventory.pool.layout.slice(0, 5)).toEqual([0, null, null, null, 2]);
    expect(h.inventory.pool.cursor).toBeNull();
    h.client.reply = () => {
      h.client.stash = [stashEntry(2, gun.name), stashEntry(1, ammo.name)];
      return { ok: true, data: { item: ammo.name, count: 1, stashIndex: 2, leftover: 1 } };
    };
    await h.click('poolSlot4');
    await h.click('poolSlot0');
    expect(h.client.commands.at(-1)).toMatchObject({ item: 2, to: 'ground', stashIndex: 0 });
    expect(h.inventory.pool.layout.slice(0, 5)).toEqual([2, null, null, null, 1]);
    expect(h.inventory.pool.cursor).toMatchObject({ index: 1, item: ammo.name, count: 'all' });
  });

  it('throws a pool item into the trash can after the question, the second one for an object with ubMission (TrashCanBtnCallback)', async () => {
    const gun = item((i) => i.class === 'GUN');
    const h = await harness([merc(MERC, 'Hollis', 'D13', [])]);
    h.client.stash = [{ ...stashEntry(4, gun.name, 2), mission: 1 }];
    h.inventory.openMerc();
    h.inventory.openPool();
    await h.settle();
    await h.click('poolSlot0');
    h.answer = MessageBoxReturn.NO;
    await h.click('trashCan');
    expect(h.boxes).toEqual(['This item looks REALLY important. Are you REALLY REALLY sure you want to trash it?']);
    expect(h.client.commands).toEqual([]);
    h.answer = MessageBoxReturn.YES;
    h.client.reply = () => {
      h.client.stash = [stashEntry(4, gun.name)];
      return { ok: true, data: { item: gun.name, count: 1 } };
    };
    await h.click('trashCan');
    expect(h.client.commands).toEqual([{ type: 'discardItem', soldier: MERC, slot: 'ground', item: 4, sector: 'D13', count: 1 }]);
    expect(h.inventory.pool.cursor).toBeNull();
    expect(h.inventory.pool.pageEntries()[0]).toMatchObject({ index: 4, count: 1 });
  });

  it('explains why a pool slot cannot be used, in the original order', async () => {
    const gun = item((i) => i.class === 'GUN');
    const h = await harness([merc(MERC, 'Hollis', 'C13', [])]);
    h.client.stash = [stashEntry(0, gun.name, 1, false), stashEntry(1, gun.name)];
    h.inventory.openPool();
    await h.settle();
    await h.click('poolSlot0');
    await h.click('poolSlot1');
    h.info = merc(MERC, 'Hollis', 'D13', []);
    h.client.usable = false;
    await h.inventory.pool.refresh();
    await h.click('poolSlot1');
    expect(h.boxes).toEqual([
      h.text.string('gzLateLocalizedString', 37),
      (h.text.string('pMapInventoryErrorString', 1) ?? '').replace('%s', 'Hollis'),
      h.text.string('pMapInventoryErrorString', 2),
    ]);
    expect(h.client.commands).toEqual([]);
    expect(h.inventory.pool.cursor).toBeNull();
  });

  it('opens the key ring of a merc in the loaded sector on the map grid', async () => {
    const key = item((i) => i.class === 'KEY');
    const h = await harness([merc(MERC, 'Hollis', 'D13', [])]);
    h.client.view = {
      ...h.client.view,
      soldiers: [{ id: MERC, team: 0, bodyType: 0, keys: [{ position: 0, keyId: 1, count: 1, item: key.name }] }],
    } as unknown as PlayerView;
    h.inventory.openMerc();
    await h.settle();
    expect(
      h.t.list.items.some((i) => i.kind === 'image' && i.asset === 'interface/gold_key_button.sti' && i.x === 217 && i.y === 271),
    ).toBe(true);
    await h.click('mercKeyRing');
    expect(h.inventory.merc.keyRing.open).toBe(true);
    const cells = h.t.list.items.filter((i) => i.kind === 'image' && i.asset === 'interface/extra_inventory.sti');
    expect(cells[0]).toMatchObject({ x: 40, y: 107 + 15 });
    expect(cells[4]).toMatchObject({ x: 40, y: 107 + 15 + 28 });
  });

  it('takes keys off the ring of a merc in no loaded sector into a pocket, onto another position and into the trash', async () => {
    const key = item((i) => i.class === 'KEY');
    const h = await harness([{ ...merc(MERC, 'Hollis', 'C13', []), keys: [{ position: 0, keyId: 1, count: 2, item: key.name }] }]);
    h.inventory.openMerc();
    await h.settle();
    await h.click('mercKeyRing');
    expect(h.inventory.merc.keyRing.open).toBe(true);
    const cell = async (position: number) => {
      const rect = h.t.runtime.regions.regions.find((r) => r.id === `keyRingCell${position}`);
      if (!rect) throw new Error(`no cell ${position}`);
      h.t.click(rect.x1 + 2, rect.y1 + 2);
      await h.settle();
    };
    const rightClick = async (position: number) => {
      const rect = h.t.runtime.regions.regions.find((r) => r.id === `keyRingCell${position}`);
      if (!rect) throw new Error(`no cell ${position}`);
      h.t.click(rect.x1 + 2, rect.y1 + 2, MouseButton.RIGHT);
      await h.settle();
    };
    await rightClick(0);
    expect([h.inventory.merc.keyRing.open, h.inventory.merc.description.open]).toEqual([true, false]);
    await rightClick(5);
    expect(h.inventory.merc.keyRing.open).toBe(false);
    await h.click('mercKeyRing');
    await cell(0);
    expect(h.inventory.merc.panel.cursor?.source).toEqual({ kind: 'keyRing', soldier: MERC, position: 0, count: 1 });
    await cell(3);
    expect(h.client.commands.at(-1)).toEqual({ type: 'moveKey', soldier: MERC, from: { ring: 0 }, to: { ring: 3 }, count: 1 });
    expect(h.inventory.holding).toBe(false);
    await cell(0);
    h.inventory.merc.keyRing.close();
    await h.click(`mercSlot${SMALL_POCKET}`);
    expect(h.client.commands.at(-1)).toEqual({ type: 'moveKey', soldier: MERC, from: { ring: 0 }, to: SMALL_POCKET, count: 1 });
    await h.click('mercKeyRing');
    await cell(0);
    h.inventory.merc.keyRing.close();
    await h.click('trashCan');
    expect(h.client.commands.at(-1)).toEqual({ type: 'discardItem', soldier: MERC, slot: { ring: 0 }, count: 1 });
  });

  it('cleans up a stack with CTRL+click on the map and still picks it up, as MAPInvClickCallbackPrimary does not return', async () => {
    const clip = item((i) => i.class === 'AMMO');
    const h = await harness([merc(MERC, 'Hollis', 'D13', [view(SMALL_POCKET, clip.name, 2), view(BIG_POCKET, clip.name)])]);
    h.inventory.openMerc();
    await h.settle();
    await h.click(`mercSlot${SMALL_POCKET}`, 0, KeyModifier.CTRL);
    expect(h.client.commands).toEqual([{ type: 'combineStack', soldier: MERC, slot: SMALL_POCKET }]);
    expect(h.inventory.merc.panel.cursor?.source).toEqual({ kind: 'slot', soldier: MERC, slot: SMALL_POCKET, count: 1, index: 0 });
    h.client.reply = () => ({ ok: true, data: { combined: true, left: 1 } });
    await h.click(`mercSlot${BIG_POCKET}`, 0, KeyModifier.CTRL);
    expect(h.client.commands.at(-1)).toEqual({ type: 'combineStack', soldier: MERC, slot: BIG_POCKET, from: SMALL_POCKET, index: 0 });
    expect(h.inventory.holding).toBe(true);
  });

  it('outlines compatible items between the merc and the pool after 100 ms and flashes the pool item on the radar', async () => {
    const gun = item((i) => i.class === 'GUN');
    const clip = item((i) => i.class === 'AMMO');
    const h = await harness([
      merc(MERC, 'Hollis', 'D13', [view(HAND, gun.name, 1, gun.index), view(SMALL_POCKET, clip.name, 1, clip.index)]),
    ]);
    h.client.compatible = (a, b) => (a === gun.index && b === clip.index) || (a === clip.index && b === gun.index);
    h.client.stash = [stashEntry(0, clip.name), stashEntry(1, gun.name)];
    h.inventory.openMerc();
    h.inventory.openPool();
    await h.settle();
    const pooled = () =>
      h.t.list.items.flatMap((i) =>
        i.kind === 'image' && i.x >= POOL_LEFT && i.effect?.kind === 'outline' && i.effect.color !== null ? [i.y] : [],
      );
    const soldier = h.inventory.merc.panel;
    const merc0 = () => h.client.view.strategic?.mercs[0];
    const lit = () =>
      [HAND, SMALL_POCKET].filter((slot) => {
        const m = merc0();
        return m ? soldier.outlineOf({ id: MERC, inventory: m.inventory } as never, slot) !== null : false;
      });
    h.hover('poolSlot0');
    expect([lit(), pooled()]).toEqual([[], []]);
    h.t.frame(120);
    expect(lit()).toEqual([HAND]);
    expect(pooled()).toHaveLength(1);
    h.hover('mercSlot5');
    h.t.frame(120);
    h.t.frame();
    expect(lit()).toEqual([SMALL_POCKET]);
    expect(pooled()).toHaveLength(1);
    h.hover('poolSlot1');
    expect(h.inventory.radarHighlight()).toEqual({ gridNo: 1001, flashOn: false });
    h.t.frame(210);
    expect(h.inventory.radarHighlight()).toEqual({ gridNo: 1001, flashOn: true });
    h.t.frame(210);
    expect(h.inventory.radarHighlight()).toEqual({ gridNo: 1001, flashOn: false });
    h.hover('mercSlot5');
    expect(h.inventory.radarHighlight()).toBeNull();
  });

  it('closes the description, then the cursor, then the pool on Escape', async () => {
    const gun = item((i) => i.class === 'GUN');
    const h = await harness([merc(MERC, 'Hollis', 'D13', [view(HAND, gun.name)])]);
    h.client.stash = [stashEntry(0, gun.name)];
    h.inventory.openMerc();
    h.inventory.openPool();
    await h.settle();
    await h.click('mercSlot5', 2);
    expect(h.inventory.merc.description.open).toBe(true);
    expect(h.t.list.items.some((i) => i.kind === 'image' && i.asset === 'interface/iteminfoc.sti' && i.x === 0 && i.y === 107)).toBe(true);
    expect(h.inventory.escape()).toBe(true);
    expect(h.inventory.merc.description.open).toBe(false);
    await h.click('poolSlot0');
    expect(h.inventory.escape()).toBe(true);
    expect(h.inventory.pool.cursor).toBeNull();
    expect(h.inventory.escape()).toBe(true);
    expect(h.inventory.pool.open).toBe(false);
    expect(h.inventory.escape()).toBe(false);
  });

  it("describes the object in the merc's slot and its attachment, with the range in tiles as the hint gives it (MAPInternalInitItemDescriptionBox, Interface_Items.cc:2327)", async () => {
    const gun = item((i) => i.class === 'GUN');
    const silenced: InventoryItemView = { ...view(HAND, gun.name), attachments: [{ item: 'SILENCER', status: 77 }] };
    const h = await harness([merc(MERC, 'Hollis', 'D13', [silenced])]);
    h.client.itemInfo = gunInfo(gun, RANGE_IN_TILES);
    h.inventory.openMerc();
    await h.settle();
    await h.click(`mercSlot${HAND}`, MouseButton.RIGHT);
    expect(h.client.hints).toContainEqual({ type: 'itemInfo', soldier: MERC, slot: HAND, metric: true });
    expect(h.client.hints.some((q) => q.type === 'itemInfo' && q.item !== undefined)).toBe(false);
    expect(drawnRuns(h, String(RANGE_IN_TILES))).toEqual([expect.objectContaining({ foreground: STATS_TEXT })]);
    const attachment = h.t.runtime.regions.regions.find((r) => r.id === 'itemDescriptionAttachment0');
    if (!attachment) throw new Error('no attachment region');
    h.t.click(attachment.x1 + 2, attachment.y1 + 2, MouseButton.RIGHT);
    await h.settle();
    expect(h.inventory.merc.description.object).toEqual({ kind: 'attachment', soldier: MERC, slot: HAND, attachment: 0 });
    expect(h.client.hints).toContainEqual({ type: 'itemInfo', soldier: MERC, slot: HAND, attachment: 0, metric: true });
  });

  it('closes the description with the done button only the map screen has, splitting money on a left click only (ItemDescDoneButtonCallbackPrimary, ItemDescDoneButtonCallbackSecondary)', async () => {
    const gun = item((i) => i.class === 'GUN');
    const money: InventoryItemView = { ...view(SMALL_POCKET, 'MONEY'), money: 500 };
    const h = await harness([merc(MERC, 'Hollis', 'D13', [view(HAND, gun.name), money])]);
    h.inventory.openMerc();
    await h.settle();
    await h.click(`mercSlot${HAND}`, MouseButton.RIGHT);
    const done = descriptionButton(h, 'itemDescriptionDone');
    expect(done).toMatchObject({ x: 204, y: 107 + 107 });
    expect(h.t.list.items.some((i) => i.kind === 'image' && i.asset === 'interface/itemdescdonebutton.sti' && i.x === 204)).toBe(true);
    const box = h.t.runtime.regions.regions.find((r) => r.id === 'itemDescriptionBox');
    expect([box?.priority, box?.cursor]).toEqual([MAP_DESCRIPTION_PRIORITY, CursorId.NORMAL]);
    await clickDescriptionButton(h, 'itemDescriptionDone');
    expect(h.inventory.merc.description.open).toBe(false);
    await h.click(`mercSlot${SMALL_POCKET}`, MouseButton.RIGHT);
    await clickDescriptionButton(h, 'itemDescriptionMoney1');
    await clickDescriptionButton(h, 'itemDescriptionDone', MouseButton.RIGHT);
    expect([h.inventory.merc.description.open, h.inventory.merc.panel.cursor]).toEqual([false, null]);
    await h.click(`mercSlot${SMALL_POCKET}`, MouseButton.RIGHT);
    await clickDescriptionButton(h, 'itemDescriptionMoney1');
    await clickDescriptionButton(h, 'itemDescriptionDone');
    expect(h.inventory.merc.description.open).toBe(false);
    expect(h.inventory.merc.panel.cursor?.source).toEqual({ kind: 'money', soldier: MERC, slot: SMALL_POCKET, amount: 100 });
    expect(h.t.runtime.buttons.buttons.some((b) => b.id === 'itemDescriptionDone')).toBe(false);
  });

  it('prints the split amounts right-aligned to 35 pixels on their stat line and the Separate label in colour 5 on the map (Interface_Items.cc:2372, :2399-2421)', async () => {
    const money: InventoryItemView = { ...view(SMALL_POCKET, 'MONEY'), money: 500 };
    const h = await harness([merc(MERC, 'Hollis', 'D13', [money])]);
    h.inventory.openMerc();
    await h.settle();
    await h.click(`mercSlot${SMALL_POCKET}`, MouseButton.RIGHT);
    await clickDescriptionButton(h, 'itemDescriptionMoney1');
    const font = h.t.runtime.fonts.get(FontName.BLOCKFONT2);
    const box = h.t.runtime.regions.regions.find((r) => r.id === 'itemDescriptionBox');
    if (!box) throw new Error('no description box');
    for (const [amount, [x, y, valueDx]] of [
      [400, MAP_MONEY_REMAINING],
      [100, MAP_MONEY_REMOVING],
    ] as const) {
      const text = sprintMoney(amount);
      const at = { x: box.x1 + x + valueDx + MAP_MONEY_VALUE_WIDTH - stringPixLength(text, font), y: box.y1 + y };
      expect(drawnRuns(h, text)).toContainEqual({ ...at, foreground: STATS_TEXT });
    }
    const separate = h.text.string('gzMoneyAmounts', MONEY_SEPARATE) ?? '';
    expect(drawnRuns(h, separate).map((r) => r.foreground)).toEqual([STATS_TEXT]);
  });

  it('lets a click on the inventory Done button hidden under the description box close the inventory: the box region lies below it (quirk, Interface_Items.cc:1669)', async () => {
    const gun = item((i) => i.class === 'GUN');
    const h = await harness([merc(MERC, 'Hollis', 'D13', [view(HAND, gun.name)])]);
    h.inventory.openMerc();
    await h.settle();
    await h.click(`mercSlot${HAND}`, MouseButton.RIGHT);
    expect(h.inventory.merc.description.open).toBe(true);
    await h.click('mercDone');
    expect([h.inventory.merc.open, h.inventory.merc.description.open]).toEqual([false, false]);
  });
});
