import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaignInA10, STUB_NPC } from '../../../../tests/support/a10-campaign.ts';
import { approachUntilCombat, BATTLE_SANDBOX_SEED, tacticalOf } from '../../../../tests/support/save-scenarios.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import {
  OFF_SCREEN_SLIDE,
  type TacticalUiKit,
  type TacticalUiTest,
  tacticalUiKit,
  tacticalUiTest,
} from '../../../../tests/support/tactical-ui.ts';
import { Body } from '../../../content/anim/body-types.ts';
import { FontColor } from '../../../content/text/font-colors.ts';
import type { SoldierView, ViewFrame } from '../../../protocol/view.ts';
import { createItem } from '../../../sim/items/object.ts';
import { handleSoldierDeath } from '../../../sim/tactical/combat/death.ts';
import { setSoldierPosition } from '../../../sim/tactical/movement.ts';
import { addItemToPool, Visibility } from '../../../sim/tactical/world-items.ts';
import { EXTERN_CURSOR, VIDEO_NO_CURSOR } from '../../cursors/cursor-ids.ts';
import type { DrawItem } from '../../draw-list.ts';
import { KeyModifier, keyDownEvents, keyUpEvents, MouseButton, type RawKey } from '../../input/events.ts';
import { INV_INTERFACE_HEIGHT } from '../../layout/frames.ts';
import type { Screen } from '../../screen.ts';
import { civQuoteLifetime, FINAL_TALKING_DELAY_MS, type SpeechLineRequest, textDelay } from '../../speech.ts';
import { COMPATIBLE_HILIGHT, FaceShade } from './faces.ts';
import { UiMode } from './input/ui-events.ts';
import { MAX_AGE } from './message-log.ts';

const HAND = 5;
const BIG_POCKET = 7;
const NEXT_BIG_POCKET = 8;
const SMALL_POCKET = 11;
const STAT_FLASH_MS = 60_000;
const FRAME_MS = 16;
const PANEL_FRAME_MS = 160;
const SKULL_ANIMATION_FRAMES = 13;
const SKULL_TICKS = 400;
const DYING_LIFE = 10;
const DEAD_FACE_FRAME = 5;
const FONT_RED = 162;
const FONT_MCOLOR_LTYELLOW = 144;
const MARKSMANSHIP = 'smStat6';
const AGILITY = 'smStat0';
const TINY_FONT = 'tinyfont1';
const ABOVE_GUY_HEIGHT = 62;
const ABOVE_GUY_HALF_WIDTH = 40;
const ABOVE_GUY_LINE = 10;
const LOG_LINES = 8;
const SCROLL_STEP_MS = 20;
const SCREEN_EDGE_X = 2;
const VIEW_ROW_Y = 100;
const CIV_TEAM = 4;
const HEALTHY_INDEX = 6;
const CROW_ID = 150;
const NAMED_CIVILIAN_ID = 151;
const CROW_TILE = 100 * 160 + 100;
const NAMED_CIVILIAN_TILE = 104 * 160 + 104;
const NAMED_CIVILIAN_DOT = '#5555ff';
const OVERHEAD_MAP = { render: () => undefined, pointOf: () => ({ x: 0, y: 0 }), gridNoAt: () => 12345 };
const GROUND_PICTURE = { path: 'tiles/ground-item.sti', frame: 3 };
const MSG_DROP = 36;
const PATHFIND_REST_MS = 100;
const PAST_DOUBLE_CLICK_MS = 400;
const MSG_THROW = 37;
const PICKUP_PAGE_ROWS = 6;
const RADIO = 'interface/radio.sti';

let kit: StubSectorKit;
let ui: TacticalUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await tacticalUiKit(kit);
});

afterAll(async () => {
  await kit.dispose();
});

const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

function line(item: DrawItem): string {
  switch (item.kind) {
    case 'image':
      return `image ${item.asset}#${item.frame} ${item.x},${item.y}${item.shade ? ' shaded' : ''}${item.effect ? ` ${item.effect.kind}` : ''}`;
    case 'glyphs': {
      const first = item.glyphs[0];
      return `glyphs ${item.font} ${first ? `${first.x},${first.y}` : '-'} n=${item.glyphs.length} fg=${item.foreground} sh=${item.shadow} bg=${item.background}`;
    }
    case 'fill':
      return `fill ${item.x},${item.y} ${item.width}x${item.height} ${hex(item.color)}`;
    case 'shadow':
      return `shadow ${item.x},${item.y} ${item.width}x${item.height} ${item.factor}`;
    case 'hatch':
      return `hatch ${item.pattern} ${item.x},${item.y} ${item.width}x${item.height}`;
    case 'line':
    case 'rectangle':
      return `${item.kind} ${item.x1},${item.y1} ${item.x2},${item.y2} ${hex(item.color)}`;
    case 'clipPush':
      return `clip ${item.x},${item.y} ${item.width}x${item.height}`;
    default:
      return item.kind;
  }
}

function snapshot(f: TacticalUiTest): string {
  return `${f.draw().items.map(line).join('\n')}\n`;
}

function images(f: TacticalUiTest, asset: string): DrawItem[] {
  return f.draw().items.filter((i) => i.kind === 'image' && i.asset === asset);
}

function namedAboveHead(f: TacticalUiTest): number[] {
  const runs = f.draw().items.filter((i) => i.kind === 'glyphs' && i.font === TINY_FONT && i.foreground === FontColor.MCOLOR_WHITE);
  return f.client.view.soldiers
    .filter((s) => {
      const pos = f.world.soldierTrueScreenPosition(s.id);
      const nameTop = (pos?.y ?? 0) - ABOVE_GUY_HEIGHT;
      return runs.some((run) => {
        const first = run.kind === 'glyphs' ? run.glyphs[0] : undefined;
        if (!pos || !first) return false;
        return Math.abs(first.x - pos.x) < ABOVE_GUY_HALF_WIDTH && first.y <= nameTop && first.y > nameTop - ABOVE_GUY_LINE;
      });
    })
    .map((s) => s.id);
}

function statColour(f: TacticalUiTest, id: string): number | null {
  const { rect } = f.widget(id);
  const run = f
    .draw()
    .items.find(
      (i) =>
        i.kind === 'glyphs' &&
        (i.glyphs[0]?.x ?? -1) >= rect.x &&
        (i.glyphs[0]?.x ?? -1) < rect.x + rect.width &&
        (i.glyphs[0]?.y ?? -1) >= rect.y - 2 &&
        (i.glyphs[0]?.y ?? -1) < rect.y + rect.height,
    );
  return run?.kind === 'glyphs' ? run.foreground : null;
}

function frame(tick: number, events: NonNullable<ViewFrame['events']>, messages: NonNullable<ViewFrame['messages']> = []): ViewFrame {
  return { tick, changed: [], removed: [], events, messages };
}

function otherScreen(id: string): Screen {
  return { id, enter: () => {}, exit: () => {}, update: () => {}, input: () => false, render: () => {} };
}

function logLines(tick: number, count: number): NonNullable<ViewFrame['messages']> {
  return Array.from({ length: count }, (_, k) => ({ tick, kind: 'interface', colour: FONT_RED, args: [{ text: `Line ${k}` }] }));
}

function pressKeypad(f: TacticalUiTest, key: string, code: string, numLock: boolean): void {
  const raw: RawKey = { key, code, repeat: false, shift: false, ctrl: false, alt: false, numLock };
  for (const event of [...keyDownEvents(raw), ...keyUpEvents(raw)]) f.t.runtime.input(event);
  f.t.frame();
}

function pressAlone(f: TacticalUiTest, key: string, code: string, held: Partial<RawKey>): void {
  const released: RawKey = { key, code, repeat: false, shift: false, ctrl: false, alt: false, numLock: true };
  for (const event of [...keyDownEvents({ ...released, ...held }), ...keyUpEvents(released)]) f.t.runtime.input(event);
  f.t.frame();
}

function pointerTo(f: TacticalUiTest, x: number, y: number): void {
  f.t.runtime.input({ kind: 'pointerMove', x, y, button: MouseButton.LEFT, buttons: 0, wheel: 0, modifiers: 0 });
  f.t.frame(SCROLL_STEP_MS);
}

function ownMerc(f: TacticalUiTest): SoldierView {
  const merc = f.client.view.soldiers.find((s) => s.team === 0);
  if (!merc) throw new Error('no merc of ours');
  return merc;
}

function mercLine(f: TacticalUiTest, text: string): SpeechLineRequest {
  const merc = ownMerc(f);
  return {
    surface: 'tactical',
    profile: merc.profile ?? 0,
    soldier: merc.id,
    text,
    chars: text.length,
    voice: null,
    sector: null,
    keyWait: false,
  };
}

function drawnRegion(f: TacticalUiTest, id: string): boolean {
  const { x, y, width, height } = f.widget(id).rect;
  return f.draw().items.some((i) => i.kind === 'clipPush' && i.x === x && i.y === y && i.width === width && i.height === height);
}

function centreOn(f: TacticalUiTest, gridNo: number): void {
  f.world.camera = { centerX: (gridNo % 160) * 10 + 5, centerY: Math.floor(gridNo / 160) * 10 + 5 };
}

function freeTileBeside(f: TacticalUiTest, gridNo: number): number {
  const free = (tile: number) => {
    const at = f.world.pickPoint(tile);
    return !f.client.view.soldiers.some((s) => s.gridNo === tile || f.world.soldierPictureAt(s.id, at.x, at.y));
  };
  const tile = [gridNo - 1, gridNo + 160, gridNo - 160, gridNo + 159, gridNo - 161].find(free);
  if (tile === undefined) throw new Error(`no free tile beside ${gridNo}`);
  return tile;
}

function holderOf(f: TacticalUiTest): SoldierView {
  const holder = f.client.view.soldiers.find((s) => s.id === f.screen.inventory.cursor?.source.soldier);
  if (!holder) throw new Error('no item held');
  return holder;
}

function besideTheHolder(f: TacticalUiTest, holder: SoldierView, tiles: number): SoldierView {
  const t = tacticalOf(f.session).state;
  const mate = t.soldiers.find((s) => s?.team === 0 && s.id !== holder.id && s.placed);
  if (!mate) throw new Error('no other merc of ours');
  setSoldierPosition(t, mate, holder.gridNo - tiles * 160);
  f.client.refresh();
  f.deliver();
  const view = f.client.view.soldiers.find((s) => s.id === mate.id);
  if (!view) throw new Error('the mate is not in the view');
  return view;
}

async function smPanelOf(f: TacticalUiTest, slot: number): Promise<void> {
  await f.click(`teamFaceRegion${slot}`, MouseButton.RIGHT);
  await f.settle();
}

function kill(f: TacticalUiTest, ...ids: number[]): ViewFrame[] {
  const t = tacticalOf(f.session).state;
  for (const id of ids) {
    const s = t.soldiers.find((v) => v?.id === id);
    if (!s) throw new Error(`no soldier ${id}`);
    s.life = 0;
    handleSoldierDeath(t, s);
  }
  f.session.advance({ ticks: 1 });
  f.client.refresh();
  const frames = f.client.takeFrames();
  f.frames(frames);
  return frames;
}

function playSkullAnimation(f: TacticalUiTest): void {
  for (let i = 0; i < SKULL_ANIMATION_FRAMES; i++) f.t.frame(PANEL_FRAME_MS);
}

function selects(f: TacticalUiTest) {
  return f.client.commands.filter((c) => c.cmd.type === 'select').map((c) => c.cmd);
}

function squadCommands(f: TacticalUiTest) {
  return f.client.commands.filter((c) => c.cmd.type === 'selectSquad').map((c) => c.cmd);
}

async function twoSquadsInA10(): Promise<{ readonly ui: TacticalUiTest; readonly ids: readonly number[] }> {
  const a10 = await campaignInA10(kit, 5, 3);
  const driven = await tacticalUiTest(kit, ui, 5, a10.session);
  expect(await driven.session.prepareAndDispatch({ type: 'assignSquad', soldier: a10.mercs[2], squad: 'new' })).toMatchObject({ ok: true });
  driven.deliver();
  return { ui: driven, ids: a10.mercs };
}

function inventory(f: TacticalUiTest, soldier: number) {
  return f.client.view.soldiers.find((s) => s.id === soldier)?.inventory ?? [];
}

describe('the tactical screen over a stub sandbox session', () => {
  it('fills the team panel with the squad, selects through the faces and opens the single merc panel', async () => {
    const f = await tacticalUiTest(kit, ui);
    expect(f.screen.teamSlots.filter((s) => s !== null)).toHaveLength(4);
    expect(f.screen.selected).toBe(0);
    expect(f.widget('teamName1').text).toBe('Merc 2');
    await f.click('teamFaceRegion1');
    expect(f.screen.selected).toBe(1);
    expect(f.attention).toEqual([1]);
    f.world.slideViewOf = () => OFF_SCREEN_SLIDE;
    await f.click('teamFaceRegion1');
    expect(f.attention).toEqual([1]);
    expect(f.screen.controls.slideTarget).toBe(f.client.view.soldiers.find((s) => s.id === 1)?.gridNo);
    await smPanelOf(f, 1);
    expect(f.screen.panel).toBe('sm');
    expect(f.screen.smMerc).toBe(1);
    expect(f.widget('smName').text).toBe('Merc 2');
    expect(f.widget('smStat0').text).toBe(' 80');
    f.key('`');
    await f.settle();
    expect(f.screen.panel).toBe('team');
  });

  it('locates a merc at the first face click and selects him at the next under the old selection method, as HandleLocateSelectMerc does', async () => {
    const f = await tacticalUiTest(kit, ui);
    f.display = { ...f.display, oldSelectionMethod: true };
    const located = f.world.located.length;
    await f.click('teamFaceRegion1');
    expect([f.screen.selected, selects(f), f.world.located.length]).toEqual([0, [], located + 1]);
    await f.click('teamFaceRegion1');
    expect([f.screen.selected, selects(f)]).toEqual([1, [{ type: 'select', soldier: 1 }]]);
    expect(f.attention).toEqual([1]);
  });

  it('only locates with ALT and a face click, and selects with them under the old selection method', async () => {
    const f = await tacticalUiTest(kit, ui);
    await f.click('teamFaceRegion1', MouseButton.LEFT, KeyModifier.ALT);
    expect([f.screen.selected, selects(f)]).toEqual([0, []]);
    f.display = { ...f.display, oldSelectionMethod: true };
    await f.click('teamFaceRegion2', MouseButton.LEFT, KeyModifier.ALT);
    expect([f.screen.selected, selects(f)]).toEqual([2, [{ type: 'select', soldier: 2 }]]);
  });

  it('selects the merc of a slot with Shift and his F key as a face click does, and forces the selection with the F key alone', async () => {
    const f = await tacticalUiTest(kit, ui);
    f.key('F2', KeyModifier.SHIFT);
    await f.settle();
    expect([f.screen.selected, selects(f)]).toEqual([1, [{ type: 'select', soldier: 1 }]]);
    f.display = { ...f.display, oldSelectionMethod: true };
    f.key('F3', KeyModifier.SHIFT);
    await f.settle();
    expect(f.screen.selected).toBe(1);
    f.key('F4');
    await f.settle();
    expect([f.screen.selected, selects(f).at(-1)]).toEqual([3, { type: 'select', soldier: 3 }]);
  });

  it('drops the multi-selection at a face click, whatever the click does', async () => {
    const f = await tacticalUiTest(kit, ui);
    f.key('=');
    await f.settle();
    expect(f.screen.controls.input.multiSelected.size).toBe(4);
    await f.click('teamFaceRegion0');
    expect([f.screen.selected, f.screen.controls.input.multiSelected.size]).toEqual([0, 0]);
  });

  it('asks for real time every time the screen is entered, as the map screen hands the driver back in manual', async () => {
    const f = await tacticalUiTest(kit, ui);
    const first = f.client.starts;
    expect(first).toBeGreaterThan(0);
    f.screen.exit();
    f.screen.enter();
    expect(f.client.starts).toBe(first + 1);
  });

  it('takes one magazine with a click and the stack with Shift, and moves it with one moveItem', async () => {
    const f = await tacticalUiTest(kit, ui);
    await smPanelOf(f, 0);
    await f.click(`slot${BIG_POCKET}`);
    expect(f.screen.inventory.cursor).toMatchObject({ item: 'CLIP9_15' });
    await f.click(`slot${NEXT_BIG_POCKET}`);
    expect(f.client.commands.at(-1)?.cmd).toMatchObject({
      type: 'moveItem',
      soldier: 0,
      from: BIG_POCKET,
      to: NEXT_BIG_POCKET,
      count: 1,
    });
    expect(f.client.commands.at(-1)?.reply.ok).toBe(true);
    expect(f.screen.inventory.cursor).toBeNull();
    expect(inventory(f, 0).find((i) => i.slot === NEXT_BIG_POCKET)).toMatchObject({ item: 'CLIP9_15', count: 1 });
    await f.click(`slot${NEXT_BIG_POCKET}`, MouseButton.LEFT, 1);
    expect(f.screen.inventory.cursor).toMatchObject({ item: 'CLIP9_15' });
    await f.click(`slot${BIG_POCKET}`);
    expect(inventory(f, 0).find((i) => i.slot === BIG_POCKET)).toMatchObject({ item: 'CLIP9_15', count: 2 });
  });

  it('selects the owner of the item held over the map and moves the view to him once per object taken from a slot (DrawItemTileCursor)', async () => {
    const f = await tacticalUiTest(kit, ui);
    await smPanelOf(f, 0);
    await f.click(`slot${BIG_POCKET}`);
    const owner = f.client.view.soldiers.find((s) => s.id === f.screen.inventory.cursor?.source.soldier);
    const other = f.client.view.soldiers.find((s) => s.team === owner?.team && s.id !== owner.id);
    if (!owner || !other) throw new Error('two mercs');
    f.screen.select(other.id, false);
    const before = f.world.located.length;
    const { width } = f.t.runtime.geometry();
    pointerTo(f, width / 2, VIEW_ROW_Y);
    pointerTo(f, width / 2 + 1, VIEW_ROW_Y);
    expect([f.screen.selected, f.world.located.slice(before)]).toEqual([owner.id, [owner.gridNo]]);
    f.screen.select(other.id, false);
    pointerTo(f, width / 2, VIEW_ROW_Y);
    expect([f.screen.selected, f.world.located.slice(before)]).toEqual([owner.id, [owner.gridNo]]);
  });

  it('hides the held item over the view from the pending scroll step and shows it again once the scroll stops', async () => {
    const f = await tacticalUiTest(kit, ui);
    await smPanelOf(f, 0);
    await f.click(`slot${BIG_POCKET}`);
    expect(f.screen.inventory.cursor).toMatchObject({ item: 'CLIP9_15' });
    const { width } = f.t.runtime.geometry();
    pointerTo(f, width / 2, VIEW_ROW_Y);
    expect(f.t.runtime.cursor.current).toBe(EXTERN_CURSOR);
    pointerTo(f, SCREEN_EDGE_X, VIEW_ROW_Y);
    expect([f.screen.controls.scrolling, f.t.runtime.cursor.current]).toEqual([true, VIDEO_NO_CURSOR]);
    for (let i = 0; i < 3; i++) f.t.frame(SCROLL_STEP_MS);
    expect(f.world.scrolled.length).toBeGreaterThan(0);
    expect(f.t.runtime.cursor.current).toBe(VIDEO_NO_CURSOR);
    pointerTo(f, width / 2, VIEW_ROW_Y);
    expect([f.screen.controls.scrolling, f.t.runtime.cursor.current]).toEqual([false, EXTERN_CURSOR]);
    expect(f.screen.inventory.cursor).toMatchObject({ item: 'CLIP9_15' });
  });

  it('lets no message line in or out while the view scrolls and drops the lines aged meanwhile together as it stops, as ScrollString does', async () => {
    const f = await tacticalUiTest(kit, ui);
    const tick = f.client.view.tick;
    f.frames([frame(tick, [], logLines(tick, 2))]);
    await f.settle(2);
    const shown = f.screen.messageLines;
    expect(shown).toEqual(['Line 1', 'Line 0']);
    const { width } = f.t.runtime.geometry();
    pointerTo(f, SCREEN_EDGE_X, VIEW_ROW_Y);
    f.frames([frame(tick, [], [{ tick, kind: 'interface', colour: FONT_RED, args: [{ text: 'Late' }] }])]);
    f.t.frame(MAX_AGE);
    expect([f.screen.controls.scrolling, f.world.scrolled.length > 0, f.screen.messageLines]).toEqual([true, true, shown]);
    pointerTo(f, width / 2, VIEW_ROW_Y);
    expect([f.screen.controls.scrolling, f.screen.messageLines]).toEqual([false, ['Late']]);
  });

  it('lets no message line in or out while the overhead map is up and drops the lines aged meanwhile together as it closes, as MainGameScreenHandle returns before ScrollString', async () => {
    const f = await tacticalUiTest(kit, ui);
    f.world.overhead = OVERHEAD_MAP;
    const tick = f.client.view.tick;
    f.frames([frame(tick, [], logLines(tick, 2))]);
    await f.settle(2);
    const shown = f.screen.messageLines;
    expect(shown).toEqual(['Line 1', 'Line 0']);
    f.key('Insert');
    f.frames([frame(tick, [], [{ tick, kind: 'interface', colour: FONT_RED, args: [{ text: 'Late' }] }])]);
    f.t.frame(MAX_AGE);
    expect([f.screen.controls.overhead.open, f.screen.messageLines]).toEqual([true, shown]);
    f.key('Escape');
    expect([f.screen.controls.overhead.open, f.screen.messageLines]).toEqual([false, ['Late']]);
  });

  it('plays the line it opens over to its end without its subtitle box and starts the next only as the overhead map closes, as MainGameScreenHandle leaves out ExecuteVideoOverlays and HandleDialogue', async () => {
    const f = await tacticalUiTest(kit, ui);
    f.world.overhead = OVERHEAD_MAP;
    const presenter = f.screen.dialogue.presenter;
    const first = presenter.enqueue(mercLine(f, 'Said as the map opens'));
    f.t.frame();
    expect(drawnRegion(f, 'speechTextBox')).toBe(true);
    f.key('Insert');
    const second = presenter.enqueue(mercLine(f, 'Said once it closes'));
    expect([f.screen.controls.overhead.open, presenter.current?.line.id, drawnRegion(f, 'speechTextBox')]).toEqual([true, first.id, false]);
    f.t.frame(textDelay(first.chars) + FINAL_TALKING_DELAY_MS);
    expect([presenter.current, presenter.queued.map((l) => l.id), f.find('speechTextBox')]).toEqual([null, [second.id], undefined]);
    f.key('Escape');
    expect([presenter.current?.line.id, drawnRegion(f, 'speechTextBox')]).toEqual([second.id, true]);
  });

  it('keeps a civilian quote past its lifetime under the overhead map without drawing it and closes it as the map closes, as HandleCivQuote runs in HandleDialogue', async () => {
    const f = await tacticalUiTest(kit, ui);
    f.world.overhead = OVERHEAD_MAP;
    const presenter = f.screen.dialogue.presenter;
    const quote = { soldier: ownMerc(f).id, text: 'Go away', chars: 7, hint: false };
    presenter.showCivQuote(quote, f.t.runtime.clock.ja2Now);
    f.t.frame();
    expect(drawnRegion(f, 'civQuoteBox')).toBe(true);
    f.key('Insert');
    f.t.frame(civQuoteLifetime(quote.chars));
    expect([presenter.civQuote?.text, drawnRegion(f, 'civQuoteBox')]).toEqual([quote.text, false]);
    f.key('Escape');
    expect([presenter.civQuote, f.find('civQuoteBox')]).toEqual([null, undefined]);
  });

  it('goes back to move mode once the held item is dropped beside the merc, as the click posts A_CHANGE_TO_MOVE', async () => {
    const f = await tacticalUiTest(kit, ui);
    await smPanelOf(f, 0);
    await f.click(`slot${BIG_POCKET}`);
    const owner = f.client.view.soldiers.find((s) => s.id === f.screen.inventory.cursor?.source.soldier);
    if (!owner) throw new Error('no owner');
    centreOn(f, owner.gridNo);
    const at = f.world.pickPoint(freeTileBeside(f, owner.gridNo));
    pointerTo(f, at.x, at.y);
    pointerTo(f, at.x + 1, at.y);
    expect(f.screen.controls.input.mode).toBe(UiMode.ACTION_MODE);
    await f.clickAt(at.x, at.y);
    expect(f.client.commands.at(-1)).toMatchObject({
      cmd: { type: 'drop', soldier: owner.id, slot: BIG_POCKET, gridNo: freeTileBeside(f, owner.gridNo) },
      reply: { ok: true },
    });
    pointerTo(f, at.x, at.y);
    expect([f.screen.inventory.cursor, f.screen.controls.input.mode]).toEqual([null, UiMode.MOVE_MODE]);
  });

  it('holds the item’s ground picture in the throw crosshair over the map, Drop beside the merc and Throw farther (DrawItemTileCursor)', async () => {
    const f = await tacticalUiTest(kit, ui);
    f.world.itemTileOf = () => GROUND_PICTURE;
    await smPanelOf(f, 0);
    await f.click(`slot${BIG_POCKET}`);
    const owner = holderOf(f);
    centreOn(f, owner.gridNo);
    const cursors = f.t.runtime.cursor;
    const beside = f.world.pickPoint(freeTileBeside(f, owner.gridNo));
    pointerTo(f, beside.x, beside.y);
    expect([cursors.current, cursors.mouseText?.tile]).toEqual([
      cursors.idOf('CURSOR_ITEM_GOOD_THROW'),
      f.text.string('pMessageStrings', MSG_DROP),
    ]);
    const far = f.world.pickPoint(owner.gridNo - 6 * 160);
    pointerTo(f, far.x, far.y);
    expect([cursors.current, cursors.mouseText?.tile]).toEqual([
      cursors.idOf('CURSOR_ITEM_GOOD_THROW'),
      f.text.string('pMessageStrings', MSG_THROW),
    ]);
    expect(cursors.compose(f.t.runtime.clock.ja2Now)?.images.some((i) => i.asset === GROUND_PICTURE.path)).toBe(true);
    f.t.frame(PATHFIND_REST_MS);
    await f.settle();
    f.t.frame(SCROLL_STEP_MS);
    expect(f.world.markers.some((m) => m.tile === 'FIRSTPOINTERS8')).toBe(true);
  });

  it('passes the held item to a merc of ours within 3 tiles; a right click swaps to the give, a real-time double click does not swap back', async () => {
    const f = await tacticalUiTest(kit, ui);
    await smPanelOf(f, 0);
    await f.click(`slot${BIG_POCKET}`);
    f.world.itemTileOf = () => GROUND_PICTURE;
    const owner = holderOf(f);
    const mate = besideTheHolder(f, owner, 2);
    centreOn(f, mate.gridNo);
    const at = f.world.pickPoint(mate.gridNo);
    pointerTo(f, at.x, at.y);
    expect(f.screen.controls.input.itemTile.catcher).toEqual({ soldier: mate.id, kind: 'pass' });
    await f.clickAt(at.x, at.y, MouseButton.RIGHT);
    pointerTo(f, at.x, at.y);
    expect(f.screen.controls.input.itemTile.catcher).toEqual({ soldier: mate.id, kind: 'give' });
    expect(f.t.runtime.cursor.current).toBe(f.t.runtime.cursor.idOf('CURSOR_ITEM_GIVE'));
    await f.clickAt(at.x, at.y, MouseButton.RIGHT);
    pointerTo(f, at.x, at.y);
    expect(f.screen.controls.input.itemTile.catcher?.kind).toBe('give');
    f.t.frame(PAST_DOUBLE_CLICK_MS);
    await f.clickAt(at.x, at.y, MouseButton.RIGHT);
    pointerTo(f, at.x, at.y);
    expect(f.screen.controls.input.itemTile.catcher?.kind).toBe('pass');
    await f.clickAt(at.x, at.y);
    expect(f.client.commands.at(-1)).toMatchObject({
      cmd: { type: 'pass', soldier: owner.id, slot: BIG_POCKET, target: mate.id },
      reply: { ok: true, data: { passed: true } },
    });
    pointerTo(f, at.x, at.y);
    expect(f.screen.inventory.cursor).toBeNull();
  });

  it('goes back to move mode once the held item, carried over the map, goes into a slot (UIHandleItemPlacement)', async () => {
    const f = await tacticalUiTest(kit, ui);
    await smPanelOf(f, 0);
    await f.click(`slot${BIG_POCKET}`);
    const { width } = f.t.runtime.geometry();
    pointerTo(f, width / 2, VIEW_ROW_Y);
    pointerTo(f, width / 2 + 1, VIEW_ROW_Y);
    expect(f.screen.controls.input.mode).toBe(UiMode.ACTION_MODE);
    await f.click(`slot${NEXT_BIG_POCKET}`);
    expect(f.client.commands.at(-1)).toMatchObject({
      cmd: { type: 'moveItem', from: BIG_POCKET, to: NEXT_BIG_POCKET },
      reply: { ok: true },
    });
    pointerTo(f, width / 2, VIEW_ROW_Y);
    expect([f.screen.inventory.cursor, f.screen.controls.input.mode]).toEqual([null, UiMode.MOVE_MODE]);
  });

  it('keeps the held item through Esc and a right click on the map until it goes back into its slot, with no command', async () => {
    const f = await tacticalUiTest(kit, ui);
    await smPanelOf(f, 0);
    await f.click(`slot${BIG_POCKET}`);
    const held = f.screen.inventory.cursor;
    f.key('Escape');
    const { width } = f.t.runtime.geometry();
    await f.clickAt(width / 2, VIEW_ROW_Y, MouseButton.RIGHT);
    expect(f.screen.inventory.cursor).toBe(held);
    const sent = f.client.commands.length;
    await f.click(`slot${BIG_POCKET}`);
    pointerTo(f, width / 2, VIEW_ROW_Y);
    expect([f.screen.inventory.cursor, f.client.commands.length, f.screen.controls.input.mode]).toEqual([null, sent, UiMode.MOVE_MODE]);
  });

  it('puts the held item back when combat starts, as CommonEnterCombatModeCode cancels the item pointer', async () => {
    const f = await tacticalUiTest(kit, ui, BATTLE_SANDBOX_SEED);
    await smPanelOf(f, 0);
    await f.click(`slot${BIG_POCKET}`);
    const item = inventory(f, f.screen.smMerc ?? -1).find((i) => i.slot === BIG_POCKET)?.item;
    expect(f.screen.inventory.cursor?.item).toBe(item);
    approachUntilCombat(f.session, false);
    f.deliver();
    expect(f.screen.inventory.cursor).toBeNull();
    expect(inventory(f, f.screen.smMerc ?? -1).find((i) => i.slot === BIG_POCKET)?.item).toBe(item);
  });

  it('ends the cursor once its object is gone from the holder, as a death or a drop ends the item pointer', async () => {
    const f = await tacticalUiTest(kit, ui);
    await smPanelOf(f, 0);
    await f.click(`slot${BIG_POCKET}`);
    const holder = f.screen.inventory.cursor?.source.soldier ?? -1;
    expect((await f.client.command({ type: 'drop', soldier: holder, slot: BIG_POCKET })).ok).toBe(true);
    f.advance(200);
    expect(f.screen.inventory.cursor).toBeNull();
  });

  it('cleans up the stack with CTRL+click, pours the cursor object into it and keeps what is left in the cursor', async () => {
    const f = await tacticalUiTest(kit, ui);
    const t = tacticalOf(f.session).state;
    const merc = t.soldiers[0];
    const clip = t.content.items.byName.get('CLIP9_15')?.index ?? 0;
    if (!merc) throw new Error('no merc 0');
    const magazines = (status: readonly number[]) => ({
      ...createItem(t.content.items, clip, 0),
      count: status.length,
      status: [...status],
    });
    merc.inv[BIG_POCKET] = magazines([15, 3]);
    merc.inv[NEXT_BIG_POCKET] = magazines([10]);
    f.client.refresh();
    await smPanelOf(f, 0);
    await f.click(`slot${BIG_POCKET}`, MouseButton.LEFT, KeyModifier.CTRL);
    expect(f.client.commands.at(-1)?.cmd).toEqual({ type: 'combineStack', soldier: 0, slot: BIG_POCKET });
    expect(f.screen.inventory.cursor).toBeNull();
    expect(merc.inv[BIG_POCKET]?.status.slice(0, 1)).toEqual([15]);
    merc.inv[BIG_POCKET] = magazines([15, 3]);
    f.client.refresh();
    await f.click(`slot${BIG_POCKET}`);
    await f.click(`slot${NEXT_BIG_POCKET}`, MouseButton.LEFT, KeyModifier.CTRL);
    expect(f.client.commands.at(-1)?.cmd).toEqual({ type: 'combineStack', soldier: 0, slot: NEXT_BIG_POCKET, from: BIG_POCKET, index: 0 });
    expect(f.client.commands.at(-1)?.reply).toMatchObject({ ok: true, data: { combined: true, left: 1 } });
    expect(f.screen.inventory.cursor?.source).toMatchObject({ kind: 'slot', slot: BIG_POCKET, index: 0 });
    expect(merc.inv[NEXT_BIG_POCKET]?.status.slice(0, 1)).toEqual([15]);
    merc.inv[NEXT_BIG_POCKET] = magazines([5]);
    f.client.refresh();
    await f.click(`slot${NEXT_BIG_POCKET}`, MouseButton.LEFT, KeyModifier.CTRL);
    expect(f.client.commands.at(-1)?.reply).toMatchObject({ ok: true, data: { combined: true, left: 0 } });
    expect(f.screen.inventory.cursor).toBeNull();
    expect(merc.inv[NEXT_BIG_POCKET]?.status.slice(0, 1)).toEqual([15]);
  });

  it('drops keys taken off the key ring at the merc’s feet with a click on his tile', async () => {
    const f = await tacticalUiTest(kit, ui);
    const merc = tacticalOf(f.session).state.soldiers[0];
    const ring = merc?.keyRing ?? [];
    ring[1] = { keyId: 1, count: 2 };
    f.client.refresh();
    await smPanelOf(f, 0);
    await f.click('smKeyRing');
    f.t.runtime.input({ kind: 'keyDown', key: 'Shift', code: 'ShiftLeft', modifiers: KeyModifier.SHIFT });
    await f.click('keyRingCell1', MouseButton.LEFT, KeyModifier.SHIFT);
    f.t.runtime.input({ kind: 'keyUp', key: 'Shift', code: 'ShiftLeft', modifiers: 0 });
    expect(f.screen.inventory.cursor?.source).toEqual({ kind: 'keyRing', soldier: 0, position: 1, count: 'all' });
    const area = f.widget('keyRingArea').rect;
    await f.clickAt(area.x + 2, area.y + 2);
    const at = f.world.pickPoint(merc?.gridNo ?? 0);
    await f.clickAt(at.x, at.y);
    expect(f.client.commands.at(-1)).toMatchObject({ cmd: { type: 'drop', soldier: 0, slot: { ring: 1 } }, reply: { ok: true } });
    expect(f.screen.inventory.cursor).toBeNull();
    f.advance(400);
    expect(ring[1]?.count).toBe(0);
    expect(f.client.view.items?.filter((i) => i.gridNo === merc?.gridNo && i.item === 'KEY_1')).toMatchObject([{ count: 2 }]);
  });

  it('takes a key off the key ring into a pocket and puts a pocket key back on another ring position', async () => {
    const f = await tacticalUiTest(kit, ui);
    const ring = tacticalOf(f.session).state.soldiers[0]?.keyRing ?? [];
    ring[0] = { keyId: 1, count: 2 };
    f.client.refresh();
    await smPanelOf(f, 0);
    await f.click('smKeyRing');
    expect(f.screen.keyRing.open).toBe(true);
    await f.click('keyRingCell0');
    expect(f.screen.inventory.cursor?.source).toEqual({ kind: 'keyRing', soldier: 0, position: 0, count: 1 });
    const area = f.widget('keyRingArea').rect;
    await f.clickAt(area.x + 2, area.y + 2);
    expect(f.screen.keyRing.open).toBe(false);
    await f.click(`slot${NEXT_BIG_POCKET}`);
    expect(f.client.commands.at(-1)).toMatchObject({
      cmd: { type: 'moveKey', soldier: 0, from: { ring: 0 }, to: NEXT_BIG_POCKET, count: 1 },
      reply: { ok: true },
    });
    expect(f.screen.inventory.cursor).toBeNull();
    expect(inventory(f, 0).find((i) => i.slot === NEXT_BIG_POCKET)).toMatchObject({ count: 1 });
    await f.click(`slot${NEXT_BIG_POCKET}`);
    await f.click('smKeyRing');
    await f.click('keyRingCell3');
    expect(f.client.commands.at(-1)).toMatchObject({
      cmd: { type: 'moveKey', soldier: 0, from: NEXT_BIG_POCKET, to: { ring: 3 }, count: 1 },
      reply: { ok: true },
    });
    expect(f.client.view.soldiers.find((s) => s.id === 0)?.keys).toMatchObject([
      { position: 0, count: 1 },
      { position: 3, count: 1 },
    ]);
    expect(f.screen.inventory.cursor).toBeNull();
  });

  it('attaches the silencer through the description box and shows it there', async () => {
    const f = await tacticalUiTest(kit, ui);
    await smPanelOf(f, 0);
    await f.click(`slot${SMALL_POCKET}`);
    expect(f.screen.inventory.cursor).toMatchObject({ item: 'SILENCER' });
    await f.click(`slot${HAND}`, MouseButton.RIGHT);
    expect(f.screen.description.item).toBe('GLOCK_17');
    await f.click('itemDescriptionAttachment0');
    expect(f.client.commands.at(-1)?.cmd).toMatchObject({ type: 'attach', soldier: 0, item: SMALL_POCKET, to: HAND });
    expect(
      inventory(f, 0)
        .find((i) => i.slot === HAND)
        ?.attachments?.map((a) => a.item),
    ).toEqual(['SILENCER']);
    await expect(snapshot(f)).toMatchFileSnapshot('__snapshots__/description-box.txt');
    f.key('Escape');
    expect(f.screen.description.open).toBe(false);
  });

  it('opens the pickup menu on a tile with two items and sends one pickUp with both', async () => {
    const f = await tacticalUiTest(kit, ui);
    const dropper = f.client.view.soldiers.find((s) => s.id === 3);
    if (!dropper) throw new Error('no merc 3');
    const tile = dropper.gridNo + 4;
    expect((await f.client.command({ type: 'move', soldier: 3, to: tile })).ok).toBe(true);
    f.advance(400);
    expect(f.client.view.soldiers.find((s) => s.id === 3)?.gridNo).toBe(tile);
    expect((await f.client.command({ type: 'drop', soldier: 3, slot: HAND })).ok).toBe(true);
    f.advance(200);
    expect((await f.client.command({ type: 'drop', soldier: 3, slot: BIG_POCKET })).ok).toBe(true);
    f.advance(200);
    expect((await f.client.command({ type: 'move', soldier: 3, to: tile + 4 })).ok).toBe(true);
    f.advance(400);
    expect(f.client.view.items?.filter((i) => i.gridNo === tile)).toHaveLength(2);
    const at = f.world.pickPoint(tile);
    f.screen.select(0, false);
    f.screen.controls.toggleHandCursor();
    f.t.frame();
    await f.clickAt(at.x, at.y);
    expect(f.screen.pickup.open).toBe(true);
    await f.click('pickupAll');
    await f.click('pickupOk');
    expect(f.client.commands.at(-1)?.cmd).toMatchObject({ type: 'pickUp', soldier: 0, gridNo: tile });
    expect(f.client.commands.at(-1)?.reply.ok).toBe(true);
    expect(f.screen.pickup.open).toBe(false);
    f.advance(2000);
    expect(inventory(f, 0).filter((i) => i.item === 'GLOCK_17')).toHaveLength(2);
  });

  it('slides to the selected merc as our turn starts and an interrupt ends, and to the soldier an interrupt stops (TeamTurns)', async () => {
    const f = await tacticalUiTest(kit, ui);
    f.world.slideViewOf = () => OFF_SCREEN_SLIDE;
    const view = f.client.view;
    const selected = view.soldiers.find((s) => s.id === view.selected);
    const other = view.soldiers.find((s) => s.team === 0 && s.id !== view.selected);
    if (!selected || !other) throw new Error('no squad');
    const tick = view.tick;
    const slidTo = (event: NonNullable<ViewFrame['events']>[number]) => {
      f.frames([frame(tick, [event])]);
      return f.screen.controls.slideTarget;
    };
    expect(slidTo({ tick, type: 'turnStarted', team: CIV_TEAM, round: 1 })).toBeNull();
    expect(slidTo({ tick, type: 'turnStarted', team: 0, round: 1 })).toBe(selected.gridNo);
    expect(slidTo({ tick, type: 'interrupt', team: 1, interrupter: other.id })).toBe(other.gridNo);
    const ours = { tick, type: 'interrupt', team: 0, soldiers: [other.id], selected: other.id, interrupted: selected.id } as const;
    expect(slidTo(ours)).toBe(selected.gridNo);
    expect(slidTo({ tick, type: 'interrupt', team: 1, interrupter: other.id })).toBe(other.gridNo);
    expect(slidTo({ tick, type: 'interruptEnded', team: 0 })).toBe(selected.gridNo);
  });

  it('slides to the items as their quote starts, and to a sighted soldier with his locator (SlideToLocation, OppList.cc SlideTo)', async () => {
    const f = await tacticalUiTest(kit, ui);
    f.world.slideViewOf = () => OFF_SCREEN_SLIDE;
    const view = f.client.view;
    const spotter = view.soldiers.find((s) => s.id === view.selected);
    const other = view.soldiers.find((s) => s.team === 0 && s.id !== view.selected);
    if (!spotter || !other) throw new Error('no squad');
    const tick = view.tick;
    const items = spotter.gridNo + 7;
    f.frames([frame(tick, [{ tick, type: 'itemsLocated', gridNo: items }])]);
    expect(f.screen.controls.slideTarget).toBe(items);
    f.frames([
      frame(tick, [
        { tick, type: 'soldierLocated', soldier: spotter.id, locator: 'normal' },
        { tick, type: 'soldierLocated', soldier: other.id, locator: 'normal', slide: true },
      ]),
    ]);
    expect([f.world.located.at(-1), f.screen.controls.slideTarget]).toEqual([spotter.gridNo, other.gridNo]);
    expect(images(f, RADIO)).toHaveLength(2);
  });

  it('flashes the portrait of a merc at the damage feedback of bleeding, gas or electricity (FlashSoldierPortrait)', async () => {
    const f = await tacticalUiTest(kit, ui);
    const view = f.client.view;
    const merc = view.soldiers.find((s) => s.id === view.selected);
    if (!merc) throw new Error('no merc');
    const shade = () => f.screen.faceOf(merc.id)?.shade(merc, false);
    expect(shade()).not.toBe(FaceShade.STARTSHADE);
    f.frames([frame(view.tick, [{ tick: view.tick, type: 'damageFeedback', soldier: merc.id }])]);
    expect(shade()).toBe(FaceShade.STARTSHADE);
  });

  it('outlines the picker’s slots and lights the faces for the pickup row under the pointer, checked as the pointer enters the row', async () => {
    const f = await tacticalUiTest(kit, ui);
    const dropper = f.client.view.soldiers.find((s) => s.id === 3);
    if (!dropper) throw new Error('no merc 3');
    const tile = dropper.gridNo + 4;
    expect((await f.client.command({ type: 'move', soldier: 3, to: tile })).ok).toBe(true);
    f.advance(400);
    expect((await f.client.command({ type: 'drop', soldier: 3, slot: HAND })).ok).toBe(true);
    f.advance(200);
    expect((await f.client.command({ type: 'drop', soldier: 3, slot: BIG_POCKET })).ok).toBe(true);
    f.advance(200);
    expect((await f.client.command({ type: 'move', soldier: 3, to: tile + 4 })).ok).toBe(true);
    f.advance(400);
    const at = f.world.pickPoint(tile);
    f.screen.select(0, false);
    f.screen.controls.toggleHandCursor();
    f.t.frame();
    await f.clickAt(at.x, at.y);
    expect(f.screen.pickup.open).toBe(true);
    const picker = f.client.view.soldiers.find((s) => s.id === 0);
    if (!picker) throw new Error('no merc 0');
    const lit = () => ({
      slots: [HAND, BIG_POCKET, SMALL_POCKET].filter((slot) => f.screen.inventory.outlineOf(picker, slot) !== null),
      faces: f.draw().items.filter((i) => i.kind === 'rectangle' && i.color === COMPATIBLE_HILIGHT).length,
    });
    const hoverRow = (row: number) => {
      const rect = f.widget(`pickupRow${row}`).rect;
      f.t.move(rect.x + 2, rect.y + 2);
      f.t.frame();
    };
    expect(lit()).toEqual({ slots: [], faces: 0 });
    hoverRow(0);
    expect(lit()).toEqual({ slots: [BIG_POCKET, SMALL_POCKET], faces: 1 });
    hoverRow(1);
    expect(lit()).toEqual({ slots: [HAND], faces: 1 });
    const menu = f.widget('pickupArea').rect;
    f.t.move(menu.x + menu.width + 20, menu.y);
    f.t.frame();
    expect(lit()).toEqual({ slots: [], faces: 0 });
  });

  it('keeps the outlines of the pickup row the pointer entered while the wheel turns the page under it (ItemPickMenuMouseMoveCallback’s bChecked)', async () => {
    const f = await tacticalUiTest(kit, ui);
    const t = tacticalOf(f.session).state;
    const picker = f.client.view.soldiers.find((s) => s.id === 0);
    if (!picker) throw new Error('no merc 0');
    const tile = picker.gridNo + 2;
    const itemOf = (name: string) => createItem(t.content.items, t.content.items.byName.get(name)?.index ?? -1, 100);
    for (let k = 0; k < PICKUP_PAGE_ROWS; k++) addItemToPool(t, tile, itemOf('KEVLAR_VEST'), Visibility.VISIBLE, 0);
    addItemToPool(t, tile, itemOf('CLIP9_15'), Visibility.VISIBLE, 0);
    f.advance(10);
    const at = f.world.pickPoint(tile);
    f.screen.select(0, false);
    f.screen.controls.toggleHandCursor();
    f.t.frame();
    await f.clickAt(at.x, at.y);
    expect(f.screen.pickup.open).toBe(true);
    const outlined = () => [HAND, BIG_POCKET, SMALL_POCKET].filter((slot) => f.screen.inventory.outlineOf(picker, slot) !== null);
    const row = f.widget('pickupRow0').rect;
    f.t.move(row.x + 2, row.y + 2);
    f.t.frame();
    expect(outlined()).toEqual([]);
    f.t.runtime.input({ kind: 'wheel', x: row.x + 2, y: row.y + 2, button: 0, buttons: 0, wheel: 1, modifiers: 0 });
    f.t.move(row.x + 3, row.y + 3);
    f.t.frame();
    expect(outlined()).toEqual([]);
    f.t.move(row.x + 2, row.y + row.height + 2);
    f.t.move(row.x + 2, row.y + 2);
    f.t.frame();
    expect(outlined()).toEqual([HAND]);
  });

  it('puts the input into GETTINGITEM_MODE while the pickup menu is up and back into move mode as it closes', async () => {
    const f = await tacticalUiTest(kit, ui);
    const dropper = f.client.view.soldiers.find((s) => s.id === 3);
    if (!dropper) throw new Error('no merc 3');
    const tile = dropper.gridNo + 4;
    expect((await f.client.command({ type: 'move', soldier: 3, to: tile })).ok).toBe(true);
    f.advance(400);
    expect((await f.client.command({ type: 'drop', soldier: 3, slot: HAND })).ok).toBe(true);
    f.advance(200);
    expect((await f.client.command({ type: 'drop', soldier: 3, slot: BIG_POCKET })).ok).toBe(true);
    f.advance(200);
    expect((await f.client.command({ type: 'move', soldier: 3, to: tile + 4 })).ok).toBe(true);
    f.advance(400);
    const at = f.world.pickPoint(tile);
    f.screen.select(0, false);
    f.screen.controls.toggleHandCursor();
    f.t.frame();
    await f.clickAt(at.x, at.y);
    f.t.frame();
    expect([f.screen.pickup.open, f.screen.controls.input.mode]).toEqual([true, UiMode.GETTINGITEM_MODE]);
    const sent = f.client.commands.length;
    f.key('c');
    await f.settle();
    expect(f.client.commands.length).toBe(sent);
    await f.click('pickupCancel');
    f.t.frame();
    expect([f.screen.pickup.open, f.screen.controls.input.mode]).toEqual([false, UiMode.MOVE_MODE]);
  });

  it('keeps the player paused through keypad 5 without NumLock, which the input layer drops, and unpauses at the typed 5', async () => {
    const f = await tacticalUiTest(kit, ui);
    f.key('Pause');
    expect(f.client.paused).toBe(true);
    pressKeypad(f, 'Clear', 'Numpad5', false);
    pressKeypad(f, 'Unidentified', 'Numpad5', false);
    expect(f.client.paused).toBe(true);
    pressKeypad(f, '5', 'Numpad5', true);
    expect(f.client.paused).toBe(false);
  });

  it('keeps the player paused through Shift, Ctrl, Alt, Print Screen and Scroll Lock pressed alone, which queue no key event', async () => {
    const f = await tacticalUiTest(kit, ui);
    f.key('Pause');
    pressAlone(f, 'Shift', 'ShiftLeft', { shift: true });
    pressAlone(f, 'Control', 'ControlLeft', { ctrl: true });
    pressAlone(f, 'Alt', 'AltLeft', { alt: true });
    pressAlone(f, 'AltGraph', 'AltRight', { ctrl: true, alt: true });
    pressAlone(f, 'PrintScreen', 'PrintScreen', {});
    pressAlone(f, 'ScrollLock', 'ScrollLock', {});
    expect(f.client.paused).toBe(true);
    pressKeypad(f, '5', 'Numpad5', true);
    expect(f.client.paused).toBe(false);
  });

  it('empties the shown message lines with F12, and the queued ones too with CTRL+F12 (ClearTacticalMessageQueue)', async () => {
    const f = await tacticalUiTest(kit, ui);
    f.frames([frame(f.client.view.tick, [], logLines(f.client.view.tick, LOG_LINES))]);
    await f.settle(2);
    f.key('F12');
    await f.settle(2);
    expect(f.screen.messageLines).not.toEqual([]);
    f.key('F12', KeyModifier.CTRL);
    expect(f.screen.messageLines).toEqual([]);
    await f.settle(LOG_LINES);
    expect(f.screen.messageLines).toEqual([]);
  });

  it('empties its shown and queued message lines at every entry to the screen, as EnterTacticalScreen does', async () => {
    const f = await tacticalUiTest(kit, ui);
    const tick = f.client.view.tick;
    f.frames([frame(tick, [], logLines(tick, LOG_LINES))]);
    await f.settle(2);
    expect(f.screen.messageLines).not.toEqual([]);
    f.t.runtime.host.push(otherScreen('options'));
    f.t.runtime.host.pop();
    expect(f.screen.messageLines).toEqual([]);
    await f.settle(LOG_LINES);
    expect(f.screen.messageLines).toEqual([]);
  });

  it('shows the message log, the feedback box, stat flashes and the death animation of a face', async () => {
    const f = await tacticalUiTest(kit, ui);
    f.frames([
      frame(
        1,
        [{ tick: 1, type: 'statChanged', soldier: 0, stat: 'marksmanship', change: 1 }],
        [
          { tick: 1, kind: 'interface', colour: FONT_RED, args: [{ text: 'Hello' }, { text: 'there' }] },
          { tick: 1, kind: 'uiFeedback', colour: FONT_MCOLOR_LTYELLOW, args: [{ text: 'Stop!' }] },
          { tick: 1, kind: 'dialog', colour: 0, textKey: { file: 'x', row: 0 } as never },
        ],
      ),
    ]);
    await f.settle(20);
    expect(f.screen.messageLines).toEqual(['Stop!', 'Hello there']);
    expect(f.screen.feedbackText).toBe('Stop!');
    await smPanelOf(f, 0);
    expect(f.widget(MARKSMANSHIP).text).toBe(' 80');
    expect(statColour(f, MARKSMANSHIP)).not.toBe(statColour(f, AGILITY));
    f.t.frame(STAT_FLASH_MS + FRAME_MS);
    expect(statColour(f, MARKSMANSHIP)).toBe(statColour(f, AGILITY));
    f.key('`');
    await f.settle();
    f.frames([frame(2, [{ tick: 2, type: 'soldierDied', soldier: 2, killer: null, gridNo: 0 }])]);
    const close = f.screen.teamSlots.indexOf(2);
    expect(close).toBeGreaterThanOrEqual(0);
    f.t.frame(PANEL_FRAME_MS);
    expect(images(f, 'interface/p_close.sti').length).toBeGreaterThan(0);
    for (let i = 0; i < 8; i++) f.t.frame(PANEL_FRAME_MS);
    expect(images(f, 'interface/p_dead.sti').length).toBeGreaterThan(0);
  });

  it('keeps the skull of a merc who died off the view in his slot until the panel is rebuilt', async () => {
    const f = await tacticalUiTest(kit, ui);
    const frames = kill(f, 2);
    expect(frames.flatMap((fr) => fr.events ?? []).some((e) => e.type === 'soldierDied' && e.soldier === 2)).toBe(true);
    expect(f.client.view.soldiers.some((s) => s.id === 2)).toBe(false);
    const slot = f.screen.teamSlots.indexOf(2);
    expect(slot).toBeGreaterThanOrEqual(0);
    f.t.frame(PANEL_FRAME_MS);
    expect(images(f, 'interface/p_close.sti').length).toBeGreaterThan(0);
    playSkullAnimation(f);
    expect(f.screen.teamSlots[slot]).toBe(2);
    const face = f.widget(`teamFace${slot}`).rect;
    const skull = images(f, 'interface/p_dead.sti').filter((i) => i.kind === 'image' && i.x === face.x && i.y === face.y);
    expect(skull.map((i) => (i.kind === 'image' ? i.frame : -1))).toEqual([DEAD_FACE_FRAME]);
    expect(f.widget(`teamName${slot}`).text).toBe('Merc 3');
    expect(f.screen.selected).toBe(0);
    f.screen.exit();
    f.screen.enter();
    f.t.frame();
    expect(f.screen.teamSlots).not.toContain(2);
  });

  it('darkens the face, then plays the close and skull frames, and only then shows the skull of a merc whose life ran out before his death', async () => {
    const f = await tacticalUiTest(kit, ui);
    const t = tacticalOf(f.session).state;
    const s = t.soldiers.find((v) => v?.id === 2);
    if (!s) throw new Error('no soldier 2');
    s.life = 0;
    f.session.advance({ ticks: 1 });
    f.client.refresh();
    f.frames(f.client.takeFrames());
    const slot = f.screen.teamSlots.indexOf(2);
    const face = f.widget(`teamFace${slot}`).rect;
    const skullAt = () => images(f, 'interface/p_dead.sti').filter((i) => i.kind === 'image' && i.x === face.x && i.y === face.y);
    f.t.frame();
    expect(images(f, 'interface/p_close.sti').filter((i) => i.kind === 'image' && i.x === face.x && i.y === face.y)).toHaveLength(1);
    expect(skullAt()).toHaveLength(0);
    playSkullAnimation(f);
    expect(skullAt().map((i) => (i.kind === 'image' ? i.frame : -1))).toEqual([DEAD_FACE_FRAME]);
  });

  it('keeps the dead merc selected through his skull and follows the server once it is done: the first able merc, then nobody', async () => {
    const f = await tacticalUiTest(kit, ui);
    expect(f.screen.selected).toBe(0);
    kill(f, 0);
    playSkullAnimation(f);
    expect(f.screen.selected).toBe(0);
    f.advance(SKULL_TICKS);
    expect(f.screen.selected).toBe(1);
    expect(f.screen.teamSlots).toContain(0);
    kill(f, 1, 2, 3);
    f.advance(SKULL_TICKS);
    playSkullAnimation(f);
    expect(f.screen.selected).toBeNull();
    expect(f.screen.teamSlots.filter((s) => s !== null)).toEqual([0, 1, 2, 3]);
    await f.settle();
    expect([f.screen.selected, selects(f)]).toEqual([null, []]);
  });

  it('sends select for a face click, not for the selections the server makes: the first one, the next after a skull, an interrupt', async () => {
    const f = await tacticalUiTest(kit, ui);
    expect([f.screen.selected, selects(f)]).toEqual([0, []]);
    await f.click('teamFaceRegion1');
    await f.click('teamFaceRegion1');
    expect(selects(f)).toEqual([{ type: 'select', soldier: 1 }]);
    expect(f.client.commands.filter((c) => c.cmd.type === 'select').every((c) => c.reply.ok)).toBe(true);
    expect(tacticalOf(f.session).state.turn.selected).toBe(1);
    kill(f, 1);
    f.advance(SKULL_TICKS);
    playSkullAnimation(f);
    expect([f.screen.selected, tacticalOf(f.session).state.turn.selected]).toEqual([0, 0]);
    f.frames([frame(f.client.view.tick, [{ tick: f.client.view.tick, type: 'interrupt', team: 0, soldiers: [3], selected: 3 }])]);
    await f.settle();
    expect([f.screen.selected, selects(f)]).toEqual([3, [{ type: 'select', soldier: 1 }]]);
  });

  it('sends selectSquad for a squad key and follows the current squad and the selection the server makes, sending no select', async () => {
    const f = await twoSquadsInA10();
    const [first, , third] = f.ids;
    expect([f.ui.screen.currentSquad, f.ui.screen.selected]).toEqual([0, first]);
    f.ui.key('2');
    await f.ui.settle();
    f.ui.deliver();
    expect(squadCommands(f.ui)).toEqual([{ type: 'selectSquad', squad: 1 }]);
    expect([f.ui.screen.currentSquad, f.ui.screen.selected, f.ui.screen.teamSlots.filter((id) => id !== null)]).toEqual([
      1,
      third,
      [third],
    ]);
    expect(selects(f.ui)).toEqual([]);
    f.ui.key('2');
    await f.ui.settle();
    expect(squadCommands(f.ui)).toHaveLength(1);
  });

  it('makes a squad on the map current from the squad list and shows the radar again', async () => {
    const f = await twoSquadsInA10();
    await f.ui.click('teamSquad');
    expect(f.ui.screen.radarShown).toBe(false);
    const line = f.ui.t.runtime.regions.regions.find((r) => r.id === 'squadLine1');
    if (!line) throw new Error('no squad line');
    await f.ui.clickAt(line.x1 + Math.floor(line.width / 2), line.y1 + Math.floor(line.height / 2));
    f.ui.deliver();
    expect([squadCommands(f.ui), f.ui.screen.radarShown, f.ui.screen.currentSquad]).toEqual([[{ type: 'selectSquad', squad: 1 }], true, 1]);
  });

  it('shows the squad the server makes current although its first merc cannot be selected and the selection stays elsewhere', async () => {
    const f = await twoSquadsInA10();
    const [first, , third] = f.ids;
    const dying = tacticalOf(f.ui.session).state.soldiers[third ?? -1];
    if (!dying) throw new Error('no third merc');
    dying.life = DYING_LIFE;
    expect(await f.ui.session.prepareAndDispatch({ type: 'selectSquad', squad: 1 })).toEqual({ ok: true });
    f.ui.deliver();
    expect([f.ui.screen.currentSquad, f.ui.screen.selected, f.ui.screen.teamSlots.filter((id) => id !== null)]).toEqual([
      1,
      first,
      [third],
    ]);
  });

  it('follows the current squad an agent makes current on the server and sends nothing for it', async () => {
    const f = await twoSquadsInA10();
    expect(await f.ui.session.prepareAndDispatch({ type: 'selectSquad', squad: 1 })).toEqual({ ok: true });
    f.ui.deliver();
    expect([f.ui.screen.currentSquad, f.ui.screen.selected, squadCommands(f.ui), selects(f.ui)]).toEqual([1, f.ids[2], [], []]);
  });

  it('follows the merc an order of the agent selects on the server and sends no select for him', async () => {
    const f = await tacticalUiTest(kit, ui);
    expect((await f.client.command({ type: 'turn', soldier: 2, direction: 0 })).ok).toBe(true);
    f.advance(1);
    expect([f.screen.selected, f.screen.currentSquad, selects(f)]).toEqual([2, 0, []]);
  });

  it('sends the end of a multi-selection as one select with the group, even when the chosen merc is selected already', async () => {
    const f = await tacticalUiTest(kit, ui);
    f.key('=');
    await f.settle();
    expect(selects(f).at(-1)).toEqual({ type: 'select', soldier: 0, group: [1, 2, 3] });
    expect(f.client.commands.at(-1)?.reply).toEqual({ ok: true, data: { woke: [] } });
  });

  it('shows its own unavailable line for a merc without a move in our interrupt and sends no select, so the line shows once', async () => {
    const f = await tacticalUiTest(kit, ui);
    const t = tacticalOf(f.session).state;
    const [first, second] = [t.soldiers[0], t.soldiers[1]];
    if (!first || !second) throw new Error('two mercs');
    t.inCombat = true;
    t.turn.currentTeam = 0;
    t.turn.intList.push(first);
    second.moved = true;
    f.client.refresh();
    const sent = selects(f).length;
    await f.click('teamFaceRegion1');
    await f.settle(4);
    expect([f.screen.selected, selects(f).length]).toEqual([0, sent]);
    expect(f.screen.messageLines.filter((l) => l.includes('Merc 2'))).toHaveLength(1);
  });

  it('names every multi-selected merc above his head, not only the selected one', async () => {
    const f = await tacticalUiTest(kit, ui);
    expect(namedAboveHead(f)).toEqual([0]);
    f.key('=');
    await f.settle();
    expect([...f.screen.controls.input.multiSelected].sort()).toEqual([0, 1, 2, 3]);
    expect(namedAboveHead(f)).toEqual([0, 1, 2, 3]);
  });

  it('draws no radar dot for a crow and the named-civilian dot for a civilian with a profile (Radar_Screen.cc:254, :274)', async () => {
    const f = await tacticalUiTest(kit, ui);
    const radar = f.widget('radar').rect;
    const dotColours = (gridNo: number) => {
      const dot = f.world.radarDot(gridNo);
      if (!dot) throw new Error('no radar dot');
      return f
        .draw()
        .items.flatMap((i) =>
          i.kind === 'rectangle' && i.x1 === radar.x + dot.x && i.y1 === radar.y + dot.y && i.x2 === i.x1 + 1 ? [hex(i.color)] : [],
        );
    };
    const soldiers = f.client.view.soldiers as SoldierView[];
    const base = soldiers[0];
    if (!base) throw new Error('no soldier');
    const civilian = { ...base, team: CIV_TEAM, hostile: false, healthIndex: HEALTHY_INDEX, level: 0 };
    soldiers.push({ ...civilian, id: CROW_ID, bodyType: Body.CROW, gridNo: CROW_TILE });
    soldiers.push({ ...civilian, id: NAMED_CIVILIAN_ID, bodyType: Body.REGMALE, gridNo: NAMED_CIVILIAN_TILE, profile: STUB_NPC });
    f.t.frame();
    expect([dotColours(CROW_TILE), dotColours(NAMED_CIVILIAN_TILE)]).toEqual([[], [NAMED_CIVILIAN_DOT]]);
  });

  it('blinks the faces from the client random and the face record', async () => {
    const f = await tacticalUiTest(kit, ui);
    const eyes = new Set<number>();
    for (let i = 0; i < 600; i++) {
      f.t.frame(FRAME_MS);
      eyes.add(f.screen.faceOf(0)?.eyeFrame ?? 0);
    }
    expect([...eyes].some((e) => e > 0)).toBe(true);
  });

  it('draws the team panel and the single merc panel', async () => {
    const f = await tacticalUiTest(kit, ui);
    await expect(snapshot(f)).toMatchFileSnapshot('__snapshots__/team-panel.txt');
    await smPanelOf(f, 0);
    await expect(snapshot(f)).toMatchFileSnapshot('__snapshots__/sm-panel.txt');
  });
});

describe('the tactical screen in a stub campaign', () => {
  it('drops its shown and queued message lines when compression starts on the map screen, as ClearTacticalMessageQueue does', async () => {
    const a10 = await campaignInA10(kit, 5);
    const f = await tacticalUiTest(kit, ui, 5, a10.session);
    const tick = f.client.view.tick;
    const lines = logLines(tick, LOG_LINES);
    f.frames([frame(tick, [], lines)]);
    await f.settle(2);
    expect(f.screen.messageLines).not.toEqual([]);
    f.t.runtime.host.push(otherScreen('map'));
    expect(await f.session.prepareAndDispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    expect(await f.session.prepareAndDispatch({ type: 'compressTime' })).toEqual({ ok: true });
    f.deliver();
    expect(f.screen.messageLines).toEqual([]);
  });

  it('names the loaded sector with its town or land type beside the radar, as RenderTownIDString does', async () => {
    const a10 = await campaignInA10(kit, 5);
    const f = await tacticalUiTest(kit, ui, 5, a10.session);
    f.t.frame();
    const shown = f.widget('sectorName').text ?? '';
    expect(shown).toMatch(/^A10: \S/);
  });

  it('queues no message line while time is compressed, as TacticalScreenMsg does', async () => {
    const a10 = await campaignInA10(kit, 5);
    const f = await tacticalUiTest(kit, ui, 5, a10.session);
    expect(await f.session.prepareAndDispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    expect(await f.session.prepareAndDispatch({ type: 'compressTime' })).toEqual({ ok: true });
    f.deliver();
    const tick = f.client.view.tick;
    f.frames([frame(tick, [], logLines(tick, 1))]);
    await f.settle(2);
    expect(f.screen.messageLines).toEqual([]);
    expect(await f.session.prepareAndDispatch({ type: 'stopTime' })).toEqual({ ok: true });
    f.deliver();
    f.frames([frame(tick, [], logLines(tick, 1))]);
    await f.settle(2);
    expect(f.screen.messageLines).toEqual(['Line 0']);
  });

  it('boxes a town the enemy took while in tactical, centred above the inventory panel', async () => {
    const a10 = await campaignInA10(kit, 5);
    const f = await tacticalUiTest(kit, ui, 5, a10.session);
    const tick = f.client.view.tick;
    f.frames([frame(tick, [{ type: 'sectorLost', tick, sector: 'C13', kind: 'town' }])]);
    await f.settle();
    const box = f.widget('messageBox');
    expect(box.text).toBe("Deidranna's forces have just taken over C13: Drassen.");
    const { height } = f.t.runtime.geometry();
    expect(box.rect.y * 2 + box.rect.height).toBeGreaterThanOrEqual(height - INV_INTERFACE_HEIGHT - 1);
    expect(box.rect.y * 2 + box.rect.height).toBeLessThanOrEqual(height - INV_INTERFACE_HEIGHT);
    f.key('Enter');
    await f.settle();
    expect(f.t.runtime.host.modal).toBeNull();
  });
});
