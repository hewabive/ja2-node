import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaignInA10 } from '../../../../tests/support/a10-campaign.ts';
import { tacticalOf } from '../../../../tests/support/save-scenarios.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { type TacticalUiKit, type TacticalUiTest, tacticalUiKit, tacticalUiTest } from '../../../../tests/support/tactical-ui.ts';
import { FontColor } from '../../../content/text/font-colors.ts';
import type { ViewFrame } from '../../../protocol/view.ts';
import { handleSoldierDeath } from '../../../sim/tactical/combat/death.ts';
import { EXTERN_CURSOR, VIDEO_NO_CURSOR } from '../../cursors/cursor-ids.ts';
import type { DrawItem } from '../../draw-list.ts';
import { KeyModifier, keyDownEvents, keyUpEvents, MouseButton, type RawKey } from '../../input/events.ts';
import { INV_INTERFACE_HEIGHT } from '../../layout/frames.ts';
import type { Screen } from '../../screen.ts';

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

function pointerTo(f: TacticalUiTest, x: number, y: number): void {
  f.t.runtime.input({ kind: 'pointerMove', x, y, button: MouseButton.LEFT, buttons: 0, wheel: 0, modifiers: 0 });
  f.t.frame(SCROLL_STEP_MS);
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
    await f.click('teamFaceRegion1');
    expect(f.attention).toEqual([1]);
    expect(f.world.located.length).toBeGreaterThan(0);
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

  it('cleans up the stack with CTRL+click, also with an object of the same item from the cursor', async () => {
    const f = await tacticalUiTest(kit, ui);
    await smPanelOf(f, 0);
    await f.click(`slot${BIG_POCKET}`, MouseButton.LEFT, KeyModifier.CTRL);
    expect(f.client.commands.at(-1)?.cmd).toEqual({ type: 'combineStack', soldier: 0, slot: BIG_POCKET });
    expect(f.screen.inventory.cursor).toBeNull();
    await f.click(`slot${BIG_POCKET}`);
    await f.click(`slot${NEXT_BIG_POCKET}`);
    await f.click(`slot${BIG_POCKET}`);
    await f.click(`slot${NEXT_BIG_POCKET}`, MouseButton.LEFT, KeyModifier.CTRL);
    expect(f.client.commands.at(-1)?.cmd).toEqual({ type: 'combineStack', soldier: 0, slot: NEXT_BIG_POCKET, from: BIG_POCKET, index: 0 });
    expect(f.client.commands.at(-1)?.reply.ok).toBe(true);
    expect(f.screen.inventory.cursor).toBeNull();
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
