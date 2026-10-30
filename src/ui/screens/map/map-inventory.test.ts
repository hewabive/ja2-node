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
import type { CatalogueItem } from '../../../protocol/items.ts';
import type { InventoryQuery, StashEntryView } from '../../../protocol/map-inventory.ts';
import type { MessageEntry } from '../../../protocol/message-log.ts';
import type { CommandEnvelope } from '../../../protocol/messages.ts';
import type { InventoryItemView, PlayerView, StrategicMercView } from '../../../protocol/view.ts';
import type { HintAnswer, HintReply } from '../../game-client.ts';
import { KeyModifier, MouseButton } from '../../input/events.ts';
import type { LayoutModel } from '../../layout/model.ts';
import { messageBoxStyles, textBoxArt } from '../../layout/styles.ts';
import { ORIGINAL_SKIN } from '../../layout/types.ts';
import { CanvasMessageBoxes } from '../../message-boxes.ts';
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
  readonly paused = false;
  stash: StashEntryView[] = [];
  usable = true;
  reply: (cmd: CommandEnvelope) => MapCommandReply = () => ({ ok: true });

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

  hint(): HintReply {
    return { state: 'ready', answer: { ok: false, reason: 'noSector' }, source: 'local' };
  }

  async hintNow(): Promise<HintAnswer> {
    return { ok: false, reason: 'noSector' };
  }

  async query(request: CommandEnvelope): Promise<HintAnswer> {
    this.queries.push(request);
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
  widget(id: string): { readonly rect: { x: number; y: number; width: number; height: number }; readonly text: string | null };
}

function item(predicate: (i: CatalogueItem) => boolean): CatalogueItem {
  const found = ui.catalogue.items.find(predicate);
  if (!found) throw new Error('no such stub item');
  return found;
}

function view(slot: number, name: string, count = 1): InventoryItemView {
  return { slot, item: name, index: 0, count, status: Array.from({ length: count }, () => 88) };
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
    sounds: { glowClick: () => undefined, newMessageBeep: () => undefined, confirmRoute: () => undefined, vehicleEntered: () => undefined },
    random: () => 0,
    metric: () => true,
    notifySleepWake: () => true,
    battle: {} as BattleEnvironment,
    version: '',
    gameOptions: async () => null,
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
      soldiers: [{ id: MERC, team: 0, bodyType: 0, keys: [{ keyId: 1, count: 1, item: key.name }] }],
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
});
