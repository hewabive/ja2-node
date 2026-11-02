import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaignInA10, STUB_NPC } from '../../../../tests/support/a10-campaign.ts';
import { approachUntilCombat, BATTLE_SANDBOX_SEED, tacticalOf, untilOurTurn } from '../../../../tests/support/save-scenarios.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import {
  type TacticalUiKit,
  type TacticalUiTest,
  TEST_GAME_OPTIONS,
  TEST_VERSION,
  tacticalUiKit,
  tacticalUiTest,
} from '../../../../tests/support/tactical-ui.ts';
import { Body } from '../../../content/anim/body-types.ts';
import { WeaponClass } from '../../../content/items/items.ts';
import { FontColor } from '../../../content/text/font-colors.ts';
import { WORLD_COLS } from '../../../content/world/grid.ts';
import type { DoorMenuOption } from '../../../protocol/hints.ts';
import type { SoldierView } from '../../../protocol/view.ts';
import { MercKind } from '../../../sim/campaign/roster.ts';
import type { BulletImpactEffect } from '../../../sim/events.ts';
import { createItem, emptyObject } from '../../../sim/items/object.ts';
import { soldierCollapse } from '../../../sim/tactical/combat/hit.ts';
import { WeaponMode } from '../../../sim/tactical/combat/types.ts';
import { InvSlot } from '../../../sim/tactical/inventory.ts';
import { setSoldierPosition } from '../../../sim/tactical/movement.ts';
import { Orders } from '../../../sim/tactical/soldier.ts';
import { addItemToPool, Visibility } from '../../../sim/tactical/world-items.ts';
import { VIDEO_NO_CURSOR } from '../../cursors/cursor-ids.ts';
import type { DrawItem } from '../../draw-list.ts';
import { KeyModifier, MouseButton } from '../../input/events.ts';
import { MAX_DISPLAY_SIZE, MIN_DISPLAY_SIZE } from '../../settings.ts';
import { gameSettingsLines } from '../game-settings.ts';
import { UiEvent, UiMode } from './input/ui-events.ts';
import { LOCATOR_FRAME_MS, SHOW_LOCATOR_FAST_CYCLES, SHOW_LOCATOR_NORMAL_CYCLES } from './overlays.ts';

const STANCE_MODES = { run: 'run', stand: 'walk', crouch: 'swat', prone: 'crawl' } as const;
const HOLD_MS = 400;
const SMALL_FONT = 'smallfont1';
const BIG_POCKET = 7;
const HAND_SLOT = 5;
const ITEMS_OVER_MS = 1500;
const COMA_LIFE = 5;
const CROW_HIT_LOCATION_STR = 105;
const PICTURE_TOP_PX = 5;
const NOBODY = -1;
const MALE = 0;
const FEMALE = 1;
const RADIO = 'interface/radio.sti';
const HOSTILE_RADIO = 'interface/radio2.sti';
const LOCATOR_FRAMES = 5;
const NORMAL_LOCATOR_MS = (SHOW_LOCATOR_NORMAL_CYCLES - 1) * LOCATOR_FRAMES * LOCATOR_FRAME_MS;
const FAST_LOCATOR_MS = (SHOW_LOCATOR_FAST_CYCLES - 1) * LOCATOR_FRAMES * LOCATOR_FRAME_MS;
const LONGEST_LOCATOR_MS = 10_000;
const EXCHANGE_CURSOR_SAMPLE_MS = 100;
const SCROLL_STEP_MS = 20;
const EXCHANGE_CURSOR_SAMPLES = 30;
const OPEN_DOOR_OPTIONS: readonly DoorMenuOption[] = [
  { action: 'openManually', ap: 0, enabled: true },
  { action: 'unlock', ap: 0, enabled: false, reason: 'noKey' },
  { action: 'crowbar', ap: 0, enabled: false, reason: 'noCrowbar' },
  { action: 'pickLock', ap: 0, enabled: false, reason: 'noLockpickKit' },
  { action: 'explode', ap: 0, enabled: false, reason: 'noShapedCharge' },
  { action: 'examine', ap: 0, enabled: true },
  { action: 'force', ap: 0, enabled: true },
  { action: 'untrap', ap: 0, enabled: true },
];

const CLOSING_DOOR_OPTIONS: readonly DoorMenuOption[] = [
  { action: 'closeManually', ap: 0, enabled: true },
  ...(['unlock', 'crowbar', 'pickLock', 'explode', 'examine', 'force', 'untrap'] as const).map((action) => ({
    action,
    ap: 0,
    enabled: false,
    reason: 'doorOpen',
  })),
];

let kit: StubSectorKit;
let ui: TacticalUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await tacticalUiKit(kit);
});

afterAll(async () => {
  await kit.dispose();
});

function merc(f: TacticalUiTest, id: number) {
  const s = f.client.view.soldiers.find((v) => v.id === id);
  if (!s) throw new Error(`no merc ${id}`);
  return s;
}

const LADDER = 10314;
const LADDER_OPTIONS = {
  result: 2,
  minutes: 0,
  invalidTraversal: false,
  loneEpc: false,
  abandonedEpcs: 0,
  uncontrolledRobot: false,
  enemyInSector: false,
  menu: {
    loadOffered: true,
    allMoveDisabled: false,
    singleMoveDisabled: false,
    multipleSquads: false,
    peopleOnSquad: 4,
    singleMove: false,
    allMove: true,
    gotoSector: true,
    gotoSectorDisabled: true,
  },
};

function centreOn(f: TacticalUiTest, gridNo: number): void {
  f.world.camera = { centerX: (gridNo % WORLD_COLS) * 10 + 5, centerY: Math.floor(gridNo / WORLD_COLS) * 10 + 5 };
}

function itemNameLines(f: TacticalUiTest): number {
  return f.draw().items.filter((i) => i.kind === 'glyphs' && i.font === SMALL_FONT && i.foreground === FontColor.MCOLOR_DKGRAY).length;
}

function placeItem(f: TacticalUiTest, tile: number, item: string, flags = 0, zHeight?: number): void {
  const t = tacticalOf(f.session).state;
  const def = t.content.items.byName.get(item);
  if (!def) throw new Error(`no item ${item}`);
  addItemToPool(t, tile, createItem(t.content.items, def.index, 100), Visibility.VISIBLE, 0, flags, zHeight);
  f.advance(1);
}

function commandsOf(f: TacticalUiTest, type: string) {
  return f.client.commands.filter((c) => c.cmd.type === type).map((c) => c.cmd);
}

function pointer(f: TacticalUiTest, kind: 'pointerMove' | 'pointerDown' | 'pointerUp', x: number, y: number, button: number) {
  f.t.runtime.input({ kind, x, y, button, buttons: 0, wheel: 0, modifiers: 0 });
}

function hover(f: TacticalUiTest, gridNo: number) {
  const at = f.world.pickPoint(gridNo);
  pointer(f, 'pointerMove', at.x, at.y, MouseButton.LEFT);
}

function aboveTheFeetOf(f: TacticalUiTest, id: number): { x: number; y: number } {
  const box = f.world.soldierBox(id);
  if (!box) throw new Error(`no box for ${id}`);
  const at = { x: box.x + box.width / 2, y: box.y + PICTURE_TOP_PX };
  if (f.world.gridNoAt(at.x, at.y) === merc(f, id).gridNo) throw new Error(`the top of ${id}'s picture is on his tile`);
  return at;
}

function fallIntoComa(f: TacticalUiTest, id: number) {
  const t = tacticalOf(f.session).state;
  const s = t.soldiers.find((v) => v?.id === id);
  if (!s) throw new Error(`no soldier ${id}`);
  s.life = COMA_LIFE;
  soldierCollapse(t, s);
  f.session.advance({ ticks: 1 });
  f.client.refresh();
  f.frames(f.client.takeFrames());
}

async function playOut(f: TacticalUiTest): Promise<void> {
  f.session.advance({ idle: true });
  f.client.refresh();
  f.frames(f.client.takeFrames());
  await f.settle();
}

function imagesOf(f: TacticalUiTest, asset: string): DrawItem[] {
  return f.draw().items.filter((i) => i.kind === 'image' && i.asset === asset);
}

function locatorMs(f: TacticalUiTest, asset: string): number {
  let ms = 0;
  while (imagesOf(f, asset).length > 0 && ms < LONGEST_LOCATOR_MS) {
    f.t.frame(LOCATOR_FRAME_MS);
    ms += LOCATOR_FRAME_MS;
  }
  return ms;
}

async function inCombat(): Promise<TacticalUiTest> {
  const f = await tacticalUiTest(kit, ui, BATTLE_SANDBOX_SEED);
  approachUntilCombat(f.session, false);
  untilOurTurn(f.session);
  f.client.refresh();
  await f.settle();
  f.screen.select(0, false);
  await f.settle();
  return f;
}

describe('the tactical input on the tactical screen', () => {
  it('walks the selected merc to a clicked tile in real time and draws the cursor marker there', async () => {
    const f = await tacticalUiTest(kit, ui);
    const s = merc(f, 0);
    const tile = s.gridNo + 3;
    const at = f.world.pickPoint(tile);
    pointer(f, 'pointerMove', at.x, at.y, MouseButton.LEFT);
    await f.settle(4);
    expect(f.screen.controls.input.mode).toBe(UiMode.MOVE_MODE);
    expect(f.world.markers.some((m) => m.gridNo === tile)).toBe(true);
    await f.clickAt(at.x, at.y);
    expect(commandsOf(f, 'move').at(-1)).toMatchObject({ soldier: 0, to: tile });
  });

  it('selects the next squad mate when the selected merc falls into a coma under the cursor', async () => {
    const f = await tacticalUiTest(kit, ui);
    const s = merc(f, 0);
    hover(f, s.gridNo);
    await f.settle(4);
    expect(f.screen.controls.input.uiCursor).toBe('NO_UICURSOR');
    fallIntoComa(f, 0);
    const tile = s.gridNo + 3;
    hover(f, tile);
    await f.settle(4);
    expect(f.screen.selected).toBe(1);
    expect(f.world.markers.some((m) => m.gridNo === tile)).toBe(true);
  });

  it('finds our merc under the pointer by his tile only without the smart cursor, by his picture with it', async () => {
    const f = await tacticalUiTest(kit, ui);
    const at = aboveTheFeetOf(f, 1);
    pointer(f, 'pointerMove', at.x, at.y, MouseButton.LEFT);
    await f.settle(4);
    expect(f.screen.controls.input.mode).toBe(UiMode.MOVE_MODE);
    expect([f.screen.controls.input.hover.target?.id, f.world.hovered]).toEqual([undefined, null]);
    f.display = { ...f.display, smartCursor: true };
    await f.settle(4);
    expect([f.screen.controls.input.hover.target?.id, f.world.hovered]).toEqual([1, 1]);
  });

  it('finds our merc by his picture in an action mode the player chose, not in one the pointer over an enemy brought', async () => {
    const f = await inCombat();
    const enemy = f.client.view.soldiers.find((v) => v.team !== 0 && v.hostile === true);
    if (!enemy) throw new Error('no enemy in sight');
    const t = tacticalOf(f.session).state;
    const mate = t.soldiers.find((v) => v?.id === 1);
    if (!mate) throw new Error('no merc 1');
    setSoldierPosition(t, mate, enemy.gridNo + 2 * WORLD_COLS);
    f.client.refresh();
    f.world.camera = { centerX: (enemy.gridNo % 160) * 10 + 5, centerY: Math.floor(enemy.gridNo / 160) * 10 + 5 };
    const over = f.world.pickPoint(enemy.gridNo);
    pointer(f, 'pointerMove', over.x, over.y - 5, MouseButton.LEFT);
    f.t.frame();
    f.t.frame();
    expect(f.screen.controls.input.mode).toBe(UiMode.ACTION_MODE);
    const at = aboveTheFeetOf(f, 1);
    pointer(f, 'pointerMove', at.x, at.y, MouseButton.LEFT);
    f.t.frame();
    expect(f.screen.controls.input.hover.target?.id).not.toBe(1);
    await f.settle(4);
    expect(f.screen.controls.input.mode).toBe(UiMode.MOVE_MODE);
    f.screen.controls.input.override(UiEvent.M_CHANGE_TO_ACTION);
    await f.settle(4);
    expect(f.screen.controls.input.mode).toBe(UiMode.ACTION_MODE);
    expect(f.screen.controls.input.hover.target?.id).toBe(1);
  });

  it('moves the view to the miss of our team gun bullet with show misses, on the ground or off the map', async () => {
    const f = await tacticalUiTest(kit, ui);
    const tick = f.client.view.tick;
    const gun = ui.catalogue.items.find((i) => i.weapon?.weaponClass === WeaponClass.HANDGUN);
    const knife = f.media.item('THROWING_KNIFE');
    const other = f.client.view.soldiers.find((v) => v.team !== 0)?.id ?? NOBODY;
    if (!gun || !knife) throw new Error('no handgun or throwing knife in the catalogue');
    const shot = (soldier: number, item: number) => ({ tick, type: 'shotFired' as const, soldier, item });
    const impact = (soldier: number, gridNo: number, effect: BulletImpactEffect) => ({
      tick,
      type: 'bulletImpact' as const,
      soldier,
      gridNo,
      x: 0,
      y: 0,
      z: 0,
      effect,
    });
    const offMap = (soldier: number, gridNo: number) => ({
      tick,
      type: 'bulletStopped' as const,
      soldier,
      gridNo,
      reason: 'offMap' as const,
    });
    const misses = [101, 102, 103, 104, 105, 106];
    const located = () => f.world.located.filter((g) => misses.includes(g));
    f.frames([{ tick, changed: [], removed: [], events: [shot(0, gun.index), impact(0, 101, 'dust')] }]);
    expect(located()).toEqual([]);
    f.display = { ...f.display, showMisses: true };
    f.frames([
      {
        tick,
        changed: [],
        removed: [],
        events: [
          impact(0, 101, 'dust'),
          impact(0, 102, 'splash'),
          impact(0, 103, 'miniboom'),
          offMap(0, 104),
          shot(1, knife.index),
          offMap(1, 105),
          shot(other, gun.index),
          impact(other, 106, 'dust'),
        ],
      },
    ]);
    expect(located()).toEqual([101, 102, 104]);
  });

  it('moves the view to the window where the simulation located a bullet of the friendly side, with show misses only', async () => {
    const f = await tacticalUiTest(kit, ui);
    const tick = f.client.view.tick;
    const notOurTeam = f.client.view.soldiers.find((v) => v.team !== 0)?.id ?? NOBODY;
    const atWindow = (soldier: number, gridNo: number) => ({ tick, type: 'bulletLocated' as const, soldier, gridNo });
    const windows = [201, 202];
    const located = () => f.world.located.filter((g) => windows.includes(g));
    f.frames([{ tick, changed: [], removed: [], events: [atWindow(0, 201)] }]);
    expect(located()).toEqual([]);
    f.display = { ...f.display, showMisses: true };
    f.frames([{ tick, changed: [], removed: [], events: [atWindow(notOurTeam, 202)] }]);
    expect(located()).toEqual([202]);
  });

  it('sends the stance, stealth and weapon mode keys for the selected merc', async () => {
    const f = await tacticalUiTest(kit, ui);
    f.key('c');
    f.key('z');
    f.key('z', KeyModifier.ALT);
    f.key('b');
    await f.settle();
    expect(commandsOf(f, 'stance').at(-1)).toMatchObject({ soldier: 0, stance: 'crouch' });
    expect(commandsOf(f, 'stealth')[0]).toMatchObject({ soldiers: [0] });
    expect(commandsOf(f, 'stealth')[1]).toMatchObject({ squad: true });
    expect(commandsOf(f, 'weaponMode').at(-1)).toMatchObject({ soldier: 0 });
  });

  it('sends the stance key of a multi-selection as multiSelected orders, which leave the selected merc selected', async () => {
    const f = await tacticalUiTest(kit, ui);
    f.key('=');
    await f.settle();
    f.key('c');
    await f.settle();
    expect(commandsOf(f, 'stance')).toEqual(
      [0, 1, 2, 3].map((soldier) => ({ type: 'stance', soldier, stance: 'crouch', multiSelected: true })),
    );
    expect([f.screen.selected, tacticalOf(f.session).state.turn.selected]).toEqual([0, 0]);
  });

  it('toggles the tree tops and the wireframes with their messages', async () => {
    const f = await tacticalUiTest(kit, ui);
    const trees = f.display.treeTops;
    f.key('t');
    f.key('w');
    await f.settle();
    expect(f.display.treeTops).toBe(!trees);
    expect(f.screen.messageLines.some((l) => /Treetops/.test(l))).toBe(true);
    expect(f.screen.messageLines.some((l) => /Wireframes/.test(l))).toBe(true);
  });

  it('lists the version and the game options of DisplayGameSettings with v', async () => {
    const f = await tacticalUiTest(kit, ui);
    f.key('v');
    const lines = gameSettingsLines(f.text, TEST_VERSION, TEST_GAME_OPTIONS);
    await f.settle(lines.length + 1);
    expect(lines).toHaveLength(5);
    expect(f.screen.messageLines.toReversed().slice(-lines.length)).toEqual(lines);
  });

  it('lowers the music by 20 with ALT+-, never below 0', async () => {
    const f = await tacticalUiTest(kit, ui);
    f.settings = { ...f.settings, volumes: { ...f.settings.volumes, music: 45 } };
    for (let i = 0; i < 3; i++) f.key('-', KeyModifier.ALT);
    expect(f.settings.volumes.music).toBe(0);
    f.settings = { ...f.settings, volumes: { ...f.settings.volumes, music: 45 } };
    f.key('-', KeyModifier.ALT);
    expect(f.settings.volumes.music).toBe(25);
  });

  it('sizes the cover display with Delete and the sight display with End held, within 4 to 11', async () => {
    const f = await tacticalUiTest(kit, ui);
    const hold = (key: string, kind: 'keyDown' | 'keyUp') => f.t.runtime.input({ kind, key, code: '', modifiers: 0 });
    hold('Delete', 'keyDown');
    for (let i = 0; i < MAX_DISPLAY_SIZE; i++) f.key('=');
    hold('Delete', 'keyUp');
    hold('End', 'keyDown');
    f.key('-');
    hold('End', 'keyUp');
    expect([f.settings.coverSize, f.settings.losSize]).toEqual([MAX_DISPLAY_SIZE, MIN_DISPLAY_SIZE]);
    expect(f.screen.controls.input.multiSelected.size).toBe(0);
  });

  it('flips the red item glow with * and ,', async () => {
    const f = await tacticalUiTest(kit, ui);
    f.key('*');
    expect(f.redItemGlow).toBe(true);
    f.key(',');
    expect(f.redItemGlow).toBe(false);
  });

  it('switches the head gear of the squad with CTRL+N, night first, then day', async () => {
    const f = await tacticalUiTest(kit, ui);
    f.key('n', KeyModifier.CTRL);
    f.key('n', KeyModifier.CTRL);
    await f.settle();
    const squad = f.client.view.soldiers.filter((s) => s.team === 0 && (s.squad ?? 0) === 0).map((s) => s.id);
    expect(commandsOf(f, 'switchHeadGear')).toEqual([
      { type: 'switchHeadGear', soldiers: squad, gear: 'night' },
      { type: 'switchHeadGear', soldiers: squad, gear: 'day' },
    ]);
  });

  it('quick saves with ALT+S, boxing a refusal, and quick loads with ALT+L', async () => {
    const f = await tacticalUiTest(kit, ui);
    f.key('s', KeyModifier.ALT);
    f.key('l', KeyModifier.ALT);
    await f.settle();
    expect(f.flow).toEqual(['quickSave', 'quickLoad']);
    expect(f.t.runtime.host.modal).toBeNull();
    f.quickSaves.failure = 'You cannot save during combat when using the Iron Man option.';
    f.key('s', KeyModifier.ALT);
    await f.settle();
    expect(f.widget('messageBox').text).toBe(f.quickSaves.failure);
  });

  it('opens the movement menu on a held right button and crouches with the sneak button', async () => {
    const f = await tacticalUiTest(kit, ui);
    const s = merc(f, 0);
    const at = f.world.pickPoint(s.gridNo + 2);
    pointer(f, 'pointerMove', at.x, at.y, MouseButton.RIGHT);
    f.t.frame();
    pointer(f, 'pointerDown', at.x, at.y, MouseButton.RIGHT);
    f.t.frame();
    f.t.frame(HOLD_MS);
    f.t.frame();
    expect(f.screen.controls.movementMenu.open).toBe(true);
    expect(f.find('menuSneak')).toBeDefined();
    pointer(f, 'pointerUp', at.x, at.y, MouseButton.RIGHT);
    f.t.frame();
    await f.click('menuSneak');
    await f.settle();
    expect(f.screen.controls.movementMenu.open).toBe(false);
    expect(commandsOf(f, 'stance').at(-1)).toMatchObject({ soldier: 0, stance: 'crouch' });
  });

  it('takes the run, sneak and crawl buttons of the movement menu from the movementOptions hint', async () => {
    const f = await tacticalUiTest(kit, ui);
    const asked: unknown[] = [];
    const hintNow = f.client.hintNow.bind(f.client);
    f.client.hintNow = async (request) => {
      if (request.type !== 'movementOptions') return hintNow(request);
      asked.push(request);
      return { ok: true, data: { run: false, sneak: true, crawl: false } };
    };
    const s = merc(f, 0);
    const at = f.world.pickPoint(s.gridNo + 2);
    pointer(f, 'pointerMove', at.x, at.y, MouseButton.RIGHT);
    f.t.frame();
    pointer(f, 'pointerDown', at.x, at.y, MouseButton.RIGHT);
    f.t.frame();
    f.t.frame(HOLD_MS);
    f.t.frame();
    await f.settle();
    expect(asked).toEqual([{ type: 'movementOptions', soldier: 0 }]);
    const enabled = (id: string) => f.t.runtime.buttons.buttons.find((b) => b.id === id)?.enabled;
    expect([enabled('menuRun'), enabled('menuSneak'), enabled('menuCrawl'), enabled('menuWalk')]).toEqual([false, true, false, true]);
  });

  it('opens the door menu from the doorMenu event and sends the chosen action', async () => {
    const f = await tacticalUiTest(kit, ui);
    const s = merc(f, 0);
    f.frames([
      {
        tick: f.client.view.tick,
        changed: [],
        removed: [],
        events: [{ type: 'doorMenu', tick: f.client.view.tick, soldier: 0, gridNo: s.gridNo + 1, options: OPEN_DOOR_OPTIONS }],
      },
    ]);
    expect(f.screen.controls.doorMenu.open).toBe(true);
    expect(f.t.runtime.buttons.buttons.find((b) => b.id === 'doorUnlock')?.enabled).toBe(false);
    expect(imagesOf(f, 'interface/button_frame.sti')).toHaveLength(1);
    await f.click('doorOpen');
    expect(f.screen.controls.doorMenu.open).toBe(false);
    expect(commandsOf(f, 'door').at(-1)).toMatchObject({ soldier: 0, gridNo: s.gridNo + 1, action: 'openManually' });
  });

  it('puts the held item back as the door menu opens, as InitDoorOpenMenu erases the interface menus', async () => {
    const f = await tacticalUiTest(kit, ui);
    const s = merc(f, 0);
    await f.click('teamFaceRegion0', MouseButton.RIGHT);
    await f.settle();
    await f.click(`slot${BIG_POCKET}`);
    expect(f.screen.inventory.cursor).not.toBeNull();
    f.frames([
      {
        tick: f.client.view.tick,
        changed: [],
        removed: [],
        events: [{ type: 'doorMenu', tick: f.client.view.tick, soldier: 0, gridNo: s.gridNo + 1, options: OPEN_DOOR_OPTIONS }],
      },
    ]);
    expect([f.screen.controls.doorMenu.open, f.screen.inventory.cursor]).toEqual([true, null]);
  });

  it('asks to travel to the surface before the exit menu of a creature lair: yes warps, no opens the menu', async () => {
    const f = await tacticalUiTest(kit, ui);
    const hintNow = f.client.hintNow.bind(f.client);
    f.client.hintNow = async (request) => {
      if (request.type !== 'exitSectorOptions') return hintNow(request);
      return { ok: true, data: { ...LADDER_OPTIONS, surfaceWarp: 'D13' } };
    };
    const asked = f.screen.controls.openExitDialog('exitGrid', LADDER);
    await f.settle();
    expect(f.screen.controls.exitDialog.open).toBe(false);
    await f.click('messageBox.yes');
    await asked;
    await f.settle();
    expect(commandsOf(f, 'exitSector').at(-1)).toMatchObject({ soldier: 0, exitGrid: LADDER, warp: true });
    const declined = f.screen.controls.openExitDialog('exitGrid', LADDER);
    await f.settle();
    await f.click('messageBox.no');
    await declined;
    expect(f.screen.controls.exitDialog.open).toBe(true);
    expect(commandsOf(f, 'exitSector')).toHaveLength(1);
  });

  it('turns the open button into the close button in the closing menu of an open door', async () => {
    const f = await tacticalUiTest(kit, ui);
    const s = merc(f, 0);
    const options = CLOSING_DOOR_OPTIONS;
    f.frames([
      {
        tick: f.client.view.tick,
        changed: [],
        removed: [],
        events: [{ type: 'doorMenu', tick: f.client.view.tick, soldier: 0, gridNo: s.gridNo + 1, options, closing: true }],
      },
    ]);
    const buttons = f.t.runtime.buttons.buttons;
    expect(buttons.some((b) => b.id === 'doorOpen')).toBe(false);
    expect(buttons.find((b) => b.id === 'doorExamine')?.enabled).toBe(false);
    await f.click('doorClose');
    expect(commandsOf(f, 'door').at(-1)).toMatchObject({ soldier: 0, gridNo: s.gridNo + 1, action: 'closeManually' });
  });

  it('opens the overhead map with Insert, centres the view on a click and closes', async () => {
    const f = await tacticalUiTest(kit, ui);
    f.world.overhead = {
      render: (list, x, y) => list.fill(x, y, x + 10, y + 10, 0x123456),
      pointOf: (gridNo) => ({ x: (gridNo % 160) * 2, y: Math.floor(gridNo / 160) }),
      gridNoAt: () => 12345,
    };
    f.key('Insert');
    expect(f.screen.controls.overhead.open).toBe(true);
    expect(f.screen.panel).toBe('team');
    expect(imagesOf(f, 'interface/map_bord.sti')).toHaveLength(1);
    expect(imagesOf(f, 'interface/persons.sti').length).toBeGreaterThan(0);
    await f.click('overheadMap');
    expect(f.screen.controls.overhead.open).toBe(false);
    expect(f.world.centred.at(-1)).toBe(12345);
    f.key('Insert');
    expect(f.screen.controls.overhead.open).toBe(true);
    f.key('Escape');
    expect(f.screen.controls.overhead.open).toBe(false);
  });

  it('gives the overhead map every key while it is up, as HandleOverheadUI dequeues them: ALT+x asks to leave the game, Backspace stops no line', async () => {
    const f = await tacticalUiTest(kit, ui);
    f.world.overhead = { render: () => undefined, pointOf: () => ({ x: 0, y: 0 }), gridNoAt: () => 12345 };
    const presenter = f.screen.dialogue.presenter;
    const m = merc(f, 0);
    const text = 'A line under the overhead map';
    presenter.enqueue({
      surface: 'tactical',
      profile: m.profile ?? 0,
      soldier: m.id,
      text,
      chars: text.length,
      voice: null,
      sector: null,
      keyWait: false,
    });
    f.key('Insert');
    f.key('Backspace');
    f.key('o');
    expect([f.screen.controls.overhead.open, presenter.busy, f.flow]).toEqual([true, true, []]);
    f.key('x', KeyModifier.ALT);
    expect([f.screen.controls.overhead.open, f.flow]).toEqual([true, ['exitGame']]);
    f.key('Escape');
    f.key('Backspace');
    expect([f.screen.controls.overhead.open, presenter.busy]).toEqual([false, false]);
  });

  it('lifts a person on the overhead map by a fifth of his drawn height and brightens him while it is not zero', async () => {
    const f = await tacticalUiTest(kit, ui);
    f.world.overhead = { render: () => undefined, pointOf: () => ({ x: 0, y: 0 }), gridNoAt: () => 12345 };
    const raised = tacticalOf(f.session).state.soldiers.find((v) => v?.id === 1);
    if (!raised) throw new Error('no merc 1');
    raised.heightAdjustment = 58;
    f.session.advance({ ticks: 1 });
    f.client.refresh();
    f.frames(f.client.takeFrames());
    f.key('Insert');
    const persons = imagesOf(f, 'interface/persons.sti').flatMap((i) => (i.kind === 'image' ? [i] : []));
    const ground = Math.max(...persons.map((i) => i.y));
    const lifted = persons.filter((i) => i.y !== ground);
    expect(lifted.map((i) => [ground - i.y, i.shade?.red])).toEqual([[11, 310]]);
  });

  it('points the diagnostics at the cell under the pointer, none over the panels, the overhead map cell while it is open', async () => {
    const f = await tacticalUiTest(kit, ui);
    const tile = merc(f, 0).gridNo + 3;
    const at = f.world.pickPoint(tile);
    f.t.move(at.x, at.y);
    f.t.frame();
    expect(f.screen.pointedCell()).toEqual({ gridNo: tile, level: 0, map: f.client.view.mapPath });
    const radar = f.widget('radarRegion').rect;
    f.t.move(radar.x + 1, radar.y + 1);
    f.t.frame();
    expect(f.screen.pointedCell().gridNo).toBeNull();
    f.world.overhead = { render: () => undefined, pointOf: () => ({ x: 0, y: 0 }), gridNoAt: () => 12345 };
    f.key('Insert');
    const map = f.widget('overheadMap').rect;
    f.t.move(map.x + 5, map.y + 5);
    f.t.frame();
    expect(f.screen.pointedCell().gridNo).toBe(12345);
  });

  it('locks our turn while a received frame that locks the interface or passes the turn waits for playback', async () => {
    const f = await inCombat();
    const tick = f.client.view.tick;
    const combat = f.client.view.combat;
    if (!combat) throw new Error('not in combat');
    const frame = (offset: number, change: Partial<typeof combat> | null) => ({
      tick: tick + offset,
      changed: [],
      removed: [],
      ...(change ? { combat: { ...combat, ...change } } : {}),
    });
    expect(f.screen.controls.lockState()).toBe('none');
    f.client.queued = [frame(60, null), frame(120, null)];
    expect(f.screen.controls.lockState()).toBe('none');
    f.client.queued = [frame(10, { uiLocked: true }), frame(200, { uiLocked: false })];
    expect(f.screen.controls.lockState()).toBe('ourTurn');
    f.client.queued = [frame(10, { team: 1 })];
    expect(f.screen.controls.lockState()).toBe('ourTurn');
    f.client.queued = [frame(10, { uiLocked: false })];
    expect(f.screen.controls.lockState()).toBe('none');
  });

  it('scrolls the view at the screen edge after the pending step', async () => {
    const f = await tacticalUiTest(kit, ui);
    pointer(f, 'pointerMove', 2, 100, MouseButton.LEFT);
    for (let i = 0; i < 5; i++) f.t.frame(20);
    expect(f.world.scrolled.length).toBeGreaterThan(0);
    expect(f.world.scrolled[0]).toEqual({ dx: -40, dy: 0 });
  });

  it('clears the tile cursor, the path, the mouse cursor and the fast help from the pending step until the scroll stops', async () => {
    const f = await inCombat();
    const tile = merc(f, 0).gridNo - 2;
    const at = f.world.pickPoint(tile);
    pointer(f, 'pointerMove', at.x, at.y, MouseButton.LEFT);
    await f.settle(8);
    await f.clickAt(at.x, at.y);
    await f.settle(8);
    expect(f.world.markers.some((m) => m.tile.startsWith('FOOTPRINTS'))).toBe(true);
    pointer(f, 'pointerMove', 2, at.y, MouseButton.LEFT);
    f.t.frame(SCROLL_STEP_MS);
    expect(f.world.scrolled).toEqual([]);
    expect([f.screen.controls.scrolling, f.world.markers, f.t.runtime.cursor.current, f.screen.rendersTooltips]).toEqual([
      true,
      [],
      VIDEO_NO_CURSOR,
      false,
    ]);
    expect(f.screen.controls.input.apNumber()).toBeNull();
    for (let i = 0; i < 3; i++) f.t.frame(SCROLL_STEP_MS);
    expect(f.world.scrolled.length).toBeGreaterThan(0);
    expect([f.world.markers, f.t.runtime.cursor.current]).toEqual([[], VIDEO_NO_CURSOR]);
    pointer(f, 'pointerMove', at.x, at.y, MouseButton.LEFT);
    await f.settle(4);
    expect([f.screen.controls.scrolling, f.screen.rendersTooltips]).toEqual([false, true]);
    expect(f.world.markers.some((m) => m.gridNo === tile)).toBe(true);
    expect(f.t.runtime.cursor.current).not.toBe(VIDEO_NO_CURSOR);
  });

  it('shows the path and the AP cost on the first click in combat and moves on the confirming click', async () => {
    const f = await inCombat();
    const s = merc(f, 0);
    const tile = s.gridNo - 2;
    const at = f.world.pickPoint(tile);
    pointer(f, 'pointerMove', at.x, at.y, MouseButton.LEFT);
    await f.settle(8);
    await f.clickAt(at.x, at.y);
    await f.settle(8);
    expect(commandsOf(f, 'move')).toHaveLength(0);
    expect(f.screen.controls.input.mode).toBe(UiMode.CONFIRM_MOVE_MODE);
    expect(f.world.markers.some((m) => m.tile.startsWith('FOOTPRINTS'))).toBe(true);
    expect(f.screen.controls.input.apNumber()?.value).toBeGreaterThan(0);
    await f.clickAt(at.x, at.y);
    expect(commandsOf(f, 'move').at(-1)).toMatchObject({ soldier: 0, to: tile });
  });

  it('runs after R in combat: the stance comes from the server and the confirming click sends no mode', async () => {
    const f = await inCombat();
    expect(merc(f, 0).stance).toBe('crouch');
    f.key('r');
    await f.settle();
    expect(commandsOf(f, 'stance').at(-1)).toMatchObject({ soldier: 0, stance: 'run' });
    await playOut(f);
    const s = merc(f, 0);
    expect(s.stance).toBe('run');
    expect(f.screen.controls.input.moveModeOf(s)).toBe('run');
    const at = f.world.pickPoint(s.gridNo - 2);
    pointer(f, 'pointerMove', at.x, at.y, MouseButton.LEFT);
    await f.settle(8);
    await f.clickAt(at.x, at.y);
    await f.settle(8);
    await f.clickAt(at.x, at.y);
    const move = commandsOf(f, 'move').at(-1);
    expect(move).toMatchObject({ soldier: 0, to: s.gridNo - 2 });
    expect(move).not.toHaveProperty('mode');
  });

  it('sends the mode cycled with a right click under the held left button with the next move only', async () => {
    const f = await inCombat();
    const s = merc(f, 0);
    const at = f.world.pickPoint(s.gridNo - 2);
    pointer(f, 'pointerMove', at.x, at.y, MouseButton.LEFT);
    await f.settle(8);
    pointer(f, 'pointerDown', at.x, at.y, MouseButton.LEFT);
    f.t.frame();
    for (const expected of ['run', 'walk', 'swat', 'crawl']) {
      pointer(f, 'pointerDown', at.x, at.y, MouseButton.RIGHT);
      f.t.frame();
      pointer(f, 'pointerUp', at.x, at.y, MouseButton.RIGHT);
      f.t.frame();
      expect(f.screen.controls.input.moveModeOf(merc(f, 0))).toBe(expected);
    }
    pointer(f, 'pointerUp', at.x, at.y, MouseButton.LEFT);
    f.t.frame();
    expect(commandsOf(f, 'move')).toHaveLength(0);
    expect(merc(f, 0).stance).toBe('crouch');
    await f.clickAt(at.x, at.y);
    await f.settle(8);
    await f.clickAt(at.x, at.y);
    await f.settle();
    expect(commandsOf(f, 'move').at(-1)).toMatchObject({ soldier: 0, to: s.gridNo - 2, mode: 'crawl' });
    expect(f.screen.controls.input.moveModeOf(merc(f, 0))).toBe(STANCE_MODES[merc(f, 0).stance ?? 'stand']);
  });

  it('orders the walk of the movement menu on a merc who already stands, which drops his run', async () => {
    const f = await tacticalUiTest(kit, ui);
    f.key('r');
    await f.settle();
    expect(merc(f, 0).stance).toBe('run');
    const s = merc(f, 0);
    const at = f.world.pickPoint(s.gridNo + 2);
    pointer(f, 'pointerMove', at.x, at.y, MouseButton.RIGHT);
    f.t.frame();
    pointer(f, 'pointerDown', at.x, at.y, MouseButton.RIGHT);
    f.t.frame();
    f.t.frame(HOLD_MS);
    f.t.frame();
    pointer(f, 'pointerUp', at.x, at.y, MouseButton.RIGHT);
    f.t.frame();
    await f.click('menuWalk');
    await f.settle();
    expect(commandsOf(f, 'stance').at(-1)).toMatchObject({ soldier: 0, stance: 'stand' });
    expect(merc(f, 0).stance).toBe('stand');
  });

  it('plots the path of a merc frozen mid-move for want of action points, as fNoAPToFinishMove counts as standing still', async () => {
    const f = await inCombat();
    const s = merc(f, 0);
    f.world.soldierMarkers.set(s.id, { stanceOffset: 0, hidden: false, moving: true, stationary: false });
    const hover = async (gridNo: number) => {
      const at = f.world.pickPoint(gridNo);
      pointer(f, 'pointerMove', at.x, at.y, MouseButton.LEFT);
      await f.settle(8);
      return f.world.markers.some((m) => m.tile.startsWith('FOOTPRINTS'));
    };
    expect(await hover(s.gridNo - 2)).toBe(false);
    const soldier = tacticalOf(f.session).state.soldiers.find((v) => v.id === s.id);
    if (!soldier) throw new Error('no merc 0 in the simulation');
    soldier.noAPToFinishMove = true;
    f.client.refresh();
    expect(await hover(s.gridNo - 3)).toBe(true);
  });

  it('switches to the action cursor over a seen enemy, confirms the aim while the pointer rests and fires on a click, locked from the click', async () => {
    const f = await inCombat();
    const enemy = f.client.view.soldiers.find((v) => v.team !== 0 && v.hostile === true);
    if (!enemy) throw new Error('no enemy in sight');
    f.world.camera = { centerX: (enemy.gridNo % 160) * 10 + 5, centerY: Math.floor(enemy.gridNo / 160) * 10 + 5 };
    const at = f.world.pickPoint(enemy.gridNo);
    const aim = { x: at.x, y: at.y - 5 };
    pointer(f, 'pointerMove', aim.x, aim.y, MouseButton.LEFT);
    f.t.frame();
    f.t.frame();
    expect(f.screen.controls.input.mode).toBe(UiMode.ACTION_MODE);
    await f.settle(6);
    expect(f.screen.controls.input.mode).toBe(UiMode.CONFIRM_ACTION_MODE);
    expect(f.screen.controls.input.uiCursor).toMatch(/TARGET/);
    let answer = () => {};
    f.client.hold = new Promise((resolve) => {
      answer = resolve;
    });
    await f.clickAt(aim.x, aim.y);
    expect(f.screen.controls.lockState()).toBe('ourTurn');
    expect(f.screen.controls.input.mode).toBe(UiMode.LOCKOURTURN_UI_MODE);
    expect(f.screen.controls.input.uiCursor).toMatch(/TARGET/);
    answer();
    await f.settle();
    expect(commandsOf(f, 'attack').at(-1)).toMatchObject({ soldier: 0, target: enemy.gridNo });
    expect(f.screen.controls.lockState()).toBe('ourTurn');
  });

  it('names the aim at a crow with the crow string and no body part, as HandleUIHitLocation does for CROW bodies', async () => {
    const f = await inCombat();
    const seen = f.client.view.soldiers.find((v) => v.team !== 0 && v.hostile === true);
    const enemy = tacticalOf(f.session).state.soldiers.find((v) => v?.id === seen?.id);
    if (!enemy) throw new Error('no enemy in sight');
    enemy.bodyType = Body.CROW;
    f.client.refresh();
    f.world.camera = { centerX: (enemy.gridNo % 160) * 10 + 5, centerY: Math.floor(enemy.gridNo / 160) * 10 + 5 };
    const at = f.world.pickPoint(enemy.gridNo);
    pointer(f, 'pointerMove', at.x, at.y - 5, MouseButton.LEFT);
    await f.settle(8);
    expect(f.screen.controls.input.uiCursor).toMatch(/TARGET/);
    expect(f.screen.controls.input.mouseText()?.location).toBe(f.text.string('TacticalStr', CROW_HIT_LOCATION_STR));
  });

  it('leaves the shot of an aim confirmed on an enemy to HandleItem, which denies a rocket rifle imprinted on someone else silently', async () => {
    const f = await inCombat();
    const enemy = f.client.view.soldiers.find((v) => v.team !== 0 && v.hostile === true);
    if (!enemy) throw new Error('no enemy in sight');
    const t = tacticalOf(f.session).state;
    const shooter = t.soldiers.find((v) => v?.id === 0);
    const rifle = t.content.items.byName.get('ROCKET_RIFLE');
    if (!shooter || !rifle) throw new Error('no merc 0 or rocket rifle');
    shooter.inv[InvSlot.HAND] = { ...createItem(t.content.items, rifle.index, 100), imprintId: shooter.profile + 1 };
    f.client.refresh();
    f.world.camera = { centerX: (enemy.gridNo % 160) * 10 + 5, centerY: Math.floor(enemy.gridNo / 160) * 10 + 5 };
    const at = f.world.pickPoint(enemy.gridNo);
    pointer(f, 'pointerMove', at.x, at.y - 5, MouseButton.LEFT);
    await f.settle(8);
    await f.clickAt(at.x, at.y - 5);
    await f.settle();
    f.deliver();
    expect(commandsOf(f, 'attack')).toHaveLength(1);
    expect(f.fingerprintsDenied).toHaveLength(0);
    expect(f.screen.feedbackText).toBeNull();
    expect(shooter.inv[InvSlot.HAND]?.imprintId).toBe(shooter.profile + 1);
  });

  it('refuses on the client the first click of a merc holding a rocket rifle imprinted on someone else, sending no attack', async () => {
    const f = await inCombat();
    const enemy = f.client.view.soldiers.find((v) => v.team !== 0 && v.hostile === true);
    if (!enemy) throw new Error('no enemy in sight');
    const t = tacticalOf(f.session).state;
    const shooter = t.soldiers.find((v) => v?.id === 0);
    const rifle = t.content.items.byName.get('ROCKET_RIFLE');
    if (!shooter || !rifle) throw new Error('no merc 0 or rocket rifle');
    shooter.inv[InvSlot.HAND] = { ...createItem(t.content.items, rifle.index, 100), imprintId: shooter.profile + 1 };
    f.client.refresh();
    f.world.camera = { centerX: (enemy.gridNo % 160) * 10 + 5, centerY: Math.floor(enemy.gridNo / 160) * 10 + 5 };
    const at = f.world.pickPoint(enemy.gridNo);
    pointer(f, 'pointerMove', at.x, at.y - 5, MouseButton.LEFT);
    f.t.frame();
    await f.settle(1);
    expect(f.screen.controls.input.mode).toBe(UiMode.ACTION_MODE);
    pointer(f, 'pointerDown', at.x, at.y - 5, MouseButton.LEFT);
    f.t.frame();
    pointer(f, 'pointerUp', at.x, at.y - 5, MouseButton.LEFT);
    f.t.frame();
    await f.settle(1);
    expect(f.fingerprintsDenied).toHaveLength(1);
    expect(f.screen.feedbackText).toMatch(/^".+"$/);
    expect(commandsOf(f, 'attack')).toHaveLength(0);
    expect(f.screen.controls.input.mode).toBe(UiMode.ACTION_MODE);
  });

  it('draws the walk up to a punch target out of reach, footsteps and the move grid at the tile he strikes from', async () => {
    const f = await inCombat();
    const enemy = f.client.view.soldiers.find((v) => v.team !== 0 && v.hostile === true);
    if (!enemy) throw new Error('no enemy in sight');
    const shooter = tacticalOf(f.session).state.soldiers.find((v) => v?.id === 0);
    if (!shooter) throw new Error('no merc 0 in the simulation');
    shooter.inv[InvSlot.HAND] = emptyObject();
    f.client.refresh();
    f.world.camera = { centerX: (enemy.gridNo % 160) * 10 + 5, centerY: Math.floor(enemy.gridNo / 160) * 10 + 5 };
    const at = f.world.pickPoint(enemy.gridNo);
    pointer(f, 'pointerMove', at.x, at.y - 5, MouseButton.LEFT);
    await f.settle(8);
    expect(f.screen.controls.input.uiCursor).toMatch(/PUNCH/);
    expect(f.world.markers.some((m) => m.tile.startsWith('FOOTPRINTS'))).toBe(true);
    const grid = f.world.markers.find((m) => m.tile.startsWith('FIRSTPOINTERS'));
    expect(grid?.gridNo).not.toBe(enemy.gridNo);
    expect(grid?.gridNo).not.toBe(merc(f, 0).gridNo);
  });

  it('shows the cost of the walk and the first aid with the first aid cursor over a squad mate in combat (HandleAidCursor)', async () => {
    const f = await inCombat();
    const t = tacticalOf(f.session).state;
    const medic = t.soldiers.find((v) => v?.id === 0);
    const kit = t.content.items.byName.get('FIRSTAIDKIT');
    if (!medic || !kit) throw new Error('no merc 0 or no first aid kit');
    medic.inv[InvSlot.HAND] = createItem(t.content.items, kit.index, 100);
    f.client.refresh();
    const mate = merc(f, 1);
    const preview = await f.client.hintNow({ type: 'previewAction', soldier: 0, gridNo: mate.gridNo, kind: 'aid', level: 0 });
    const apCost = (preview.data as { apCost: number }).apCost;
    expect(apCost).toBeGreaterThan(0);
    f.screen.controls.input.override(UiEvent.M_CHANGE_TO_ACTION);
    centreOn(f, mate.gridNo);
    hover(f, mate.gridNo);
    await f.settle(8);
    expect(f.screen.controls.input.uiCursor).toMatch(/FIRSTAID/);
    expect(f.screen.controls.input.mouseText()?.actionPoints).toMatchObject({ value: apCost, center: true });
  });

  it('names the items under every hand cursor, by CTRL, by the hand button or after the pointer rests (gfUIOverItemPoolGridNo)', async () => {
    const f = await tacticalUiTest(kit, ui);
    const tile = merc(f, 0).gridNo + 3;
    placeItem(f, tile, 'GLOCK_17');
    const at = f.world.pickPoint(tile);
    f.t.runtime.input({
      kind: 'pointerMove',
      x: at.x,
      y: at.y,
      button: MouseButton.LEFT,
      buttons: 0,
      wheel: 0,
      modifiers: KeyModifier.CTRL,
    });
    await f.settle(4);
    expect([f.screen.controls.input.mode, itemNameLines(f)]).toEqual([UiMode.HANDCURSOR_MODE, 1]);
    pointer(f, 'pointerMove', at.x, at.y, MouseButton.LEFT);
    await f.settle(4);
    expect([f.screen.controls.input.mode, itemNameLines(f)]).toEqual([UiMode.MOVE_MODE, 0]);
    f.screen.controls.toggleHandCursor();
    await f.settle(4);
    expect([f.screen.controls.input.mode, itemNameLines(f)]).toEqual([UiMode.HANDCURSOR_MODE, 1]);
    f.screen.controls.toggleHandCursor();
    await f.settle(4);
    f.t.frame(ITEMS_OVER_MS + 1);
    await f.settle(4);
    expect([f.screen.controls.input.mode, itemNameLines(f)]).toEqual([UiMode.HANDCURSOR_MODE, 1]);
  });

  it('shows the walk of a steal with the hand cursor over an enemy and steals on the click', async () => {
    const f = await inCombat();
    const seen = f.client.view.soldiers.find((v) => v.team !== 0 && v.hostile === true);
    const t = tacticalOf(f.session).state;
    const enemy = t.soldiers.find((v) => v?.id === seen?.id);
    if (!enemy) throw new Error('no enemy in sight');
    setSoldierPosition(t, enemy, merc(f, 0).gridNo + 3);
    f.client.refresh();
    f.world.camera = { centerX: (enemy.gridNo % 160) * 10 + 5, centerY: Math.floor(enemy.gridNo / 160) * 10 + 5 };
    f.screen.controls.toggleHandCursor();
    const at = f.world.pickPoint(enemy.gridNo);
    pointer(f, 'pointerMove', at.x, at.y - 5, MouseButton.LEFT);
    await f.settle(8);
    expect(f.screen.controls.input.uiCursor).toMatch(/HANDCURSOR/);
    expect(f.world.markers.some((m) => m.tile.startsWith('FOOTPRINTS'))).toBe(true);
    await f.clickAt(at.x, at.y - 5);
    expect(f.client.commands.at(-1)).toMatchObject({ cmd: { type: 'steal', soldier: 0, target: enemy.id }, reply: { ok: true } });
  });

  it('centres the view on the selected merc with / even when he is on screen and flashes the normal locator, as LocateSoldier(sel, 10) does', async () => {
    const f = await tacticalUiTest(kit, ui);
    const sel = merc(f, f.screen.selected ?? NOBODY);
    f.key('/');
    expect([f.world.centred, f.world.located]).toEqual([[sel.gridNo], []]);
    expect(locatorMs(f, RADIO)).toBe(NORMAL_LOCATOR_MS);
  });

  it('centres the view on the merc a sector entry located at the next update, even on screen, with the normal locator (TacticalScreenLocateToSoldier)', async () => {
    const f = await tacticalUiTest(kit, ui);
    const entered = merc(f, f.screen.selected ?? NOBODY);
    f.screen.locateOnEntry(entered.id);
    expect(f.world.centred).toEqual([]);
    f.t.frame();
    expect(f.world.centred).toEqual([entered.gridNo]);
    expect(locatorMs(f, RADIO)).toBe(NORMAL_LOCATOR_MS);
  });

  it('moves the view to a soldier the simulation locates only off screen, with the locator it names (soldierLocated)', async () => {
    const f = await tacticalUiTest(kit, ui);
    const tick = f.client.view.tick;
    const [first, second] = f.client.view.soldiers.filter((v) => v.team === 0);
    if (!first || !second) throw new Error('two mercs');
    const located = (soldier: number, locator: 'none' | 'fast') => ({ tick, type: 'soldierLocated' as const, soldier, locator });
    f.frames([{ tick, changed: [], removed: [], events: [located(first.id, 'none')] }]);
    expect([f.world.centred, f.world.located.at(-1), imagesOf(f, RADIO).length]).toEqual([[], first.gridNo, 0]);
    f.frames([{ tick, changed: [], removed: [], events: [located(second.id, 'fast')] }]);
    expect(f.world.located.at(-1)).toBe(second.gridNo);
    expect(locatorMs(f, RADIO)).toBe(FAST_LOCATOR_MS);
  });

  it('locates the next merc with space only off screen and flashes the normal locator, as LocateSoldier(SETLOCATOR) does', async () => {
    const f = await tacticalUiTest(kit, ui);
    const first = f.screen.selected;
    f.key(' ');
    const next = merc(f, f.screen.selected ?? NOBODY);
    expect(next.id).not.toBe(first);
    expect([f.world.centred, f.world.located.at(-1)]).toEqual([[], next.gridNo]);
    expect(locatorMs(f, RADIO)).toBe(NORMAL_LOCATOR_MS);
  });

  it('cycles the seen enemies by e and by the enemy indicator from one last enemy, stopping the other locators, as CycleVisibleEnemies does', async () => {
    const f = await inCombat();
    const selected = merc(f, f.screen.selected ?? 0);
    const enemy = (selected.sees ?? []).map((id) => merc(f, id)).find((v) => v.hostile === true);
    if (!enemy) throw new Error('no enemy in sight');
    const twin = { ...enemy, id: Math.max(...f.client.view.soldiers.map((v) => v.id)) + 1, gridNo: enemy.gridNo + 2 };
    (f.client.view.soldiers as SoldierView[]).push(twin);
    Object.assign(selected, { sees: [...(selected.sees ?? []), twin.id], opponents: 2 });
    f.key('/');
    expect(imagesOf(f, RADIO)).toHaveLength(1);
    f.key('e');
    expect(f.world.located.at(-1)).toBe(enemy.gridNo);
    expect([imagesOf(f, RADIO), imagesOf(f, HOSTILE_RADIO)].map((l) => l.length)).toEqual([0, 1]);
    await f.click(`teamEnemyIndicator${f.screen.teamSlots.indexOf(selected.id)}`);
    expect(f.world.located.at(-1)).toBe(twin.gridNo);
    expect(imagesOf(f, HOSTILE_RADIO)).toHaveLength(1);
    f.key('Enter');
    expect(f.world.located.at(-1)).toBe(enemy.gridNo);
    expect(locatorMs(f, HOSTILE_RADIO)).toBe(NORMAL_LOCATOR_MS);
  });

  it('locates the seen enemies with e and Enter and skips the ones whose life is gone while they fall', async () => {
    const f = await inCombat();
    const selected = merc(f, f.screen.selected ?? 0);
    const enemies = (selected.sees ?? [])
      .map((id) => merc(f, id))
      .filter((v) => v.hostile === true)
      .sort((a, b) => a.id - b.id);
    const first = enemies[0];
    if (!first) throw new Error('no enemy in sight');
    f.key('e');
    expect(f.world.located.at(-1)).toBe(first.gridNo);
    f.key('Enter');
    expect(f.world.located.at(-1)).toBe(first.gridNo);
    const t = tacticalOf(f.session).state;
    for (const s of t.soldiers) if (s && s.team !== 0 && !s.neutral) s.life = 0;
    f.deliver();
    expect(f.screen.feedbackText).toBeNull();
    const located = f.world.located.length;
    f.key('Enter');
    expect(f.world.located).toHaveLength(located);
    expect(f.screen.feedbackText).toBeTruthy();
  });

  it('shows the fists, not the lost gun, once the gun is gone from the hand of a merc left in burst mode', async () => {
    const f = await inCombat();
    const enemy = f.client.view.soldiers.find((v) => v.team !== 0 && v.hostile === true);
    if (!enemy) throw new Error('no enemy in sight');
    f.world.camera = { centerX: (enemy.gridNo % 160) * 10 + 5, centerY: Math.floor(enemy.gridNo / 160) * 10 + 5 };
    const at = f.world.pickPoint(enemy.gridNo);
    pointer(f, 'pointerMove', at.x, at.y - 5, MouseButton.LEFT);
    await f.settle(8);
    expect(f.screen.controls.input.uiCursor).toMatch(/TARGET|SHOOT/);
    const merc = tacticalOf(f.session).state.soldiers.find((v) => v.id === 0);
    if (!merc) throw new Error('no merc 0 in the simulation');
    merc.inv[InvSlot.HAND] = emptyObject();
    merc.weaponMode = WeaponMode.BURST;
    f.client.refresh();
    pointer(f, 'pointerMove', at.x + 1, at.y - 5, MouseButton.LEFT);
    await f.settle(8);
    expect(f.screen.controls.input.uiCursor).toMatch(/PUNCH/);
  });

  it('is back on the move cursor when the screen is entered again', async () => {
    const f = await tacticalUiTest(kit, ui);
    const at = f.world.pickPoint(merc(f, 0).gridNo + 3);
    pointer(f, 'pointerMove', at.x, at.y, MouseButton.LEFT);
    await f.settle(4);
    f.screen.exit();
    f.screen.enter();
    await f.settle(4);
    expect(f.screen.controls.input.mode).toBe(UiMode.MOVE_MODE);
  });

  it('runs the exit dialog: the radios follow SingleMoveAction and AllMoveAction and OK hands back who and load', async () => {
    const f = await tacticalUiTest(kit, ui);
    const fonts = f.t.runtime.fonts;
    const boxFonts = { text: fonts.get('FONT12ARIAL'), bold: fonts.get('FONT10ARIALBOLD') };
    const menu = {
      loadOffered: true,
      allMoveDisabled: false,
      singleMoveDisabled: false,
      multipleSquads: false,
      peopleOnSquad: 4,
      singleMove: false,
      allMove: true,
      gotoSector: true,
      gotoSectorDisabled: true,
    };
    const options = {
      result: 2,
      minutes: 3,
      invalidTraversal: false,
      loneEpc: false,
      abandonedEpcs: 0,
      uncontrolledRobot: false,
      enemyInSector: false,
      surfaceWarp: null,
      menu,
    };
    const choices: unknown[] = [];
    const dialog = f.screen.controls.exitDialog;
    const request = {
      direction: 'north' as const,
      exitGrid: null,
      options,
      selected: merc(f, 0),
      selectedFemale: false,
      selectedIsEpc: false,
      squadEpcs: [],
      viewportBottom: 340,
    };
    dialog.show(request, boxFonts, (c) => choices.push(c));
    f.t.frame();
    expect(f.t.runtime.buttons.buttons.find((b) => b.id === 'exitLoadCheck')?.enabled).toBe(false);
    expect(f.t.runtime.buttons.buttons.find((b) => b.id === 'exitAllRadio')?.clicked).toBe(true);
    await f.click('exitSingle');
    expect(dialog.menu).toMatchObject({ singleMove: true, allMove: false, gotoSectorDisabled: false, gotoSector: true });
    await f.click('exitLoad');
    expect(dialog.menu?.gotoSector).toBe(false);
    await f.click('exitOk');
    expect(dialog.open).toBe(false);
    expect(choices).toEqual([{ who: 'merc', load: false }]);
    dialog.show(request, boxFonts, (c) => choices.push(c));
    f.key('Enter');
    expect(choices.at(-1)).toEqual({ who: 'squad', load: true });
    dialog.show(request, boxFonts, (c) => choices.push(c));
    f.key('Escape');
    expect(choices.at(-1)).toBeNull();
  });
});

describe('the exit texts of a merc escorting someone, in a stub campaign', () => {
  async function escortingSquad(sex: number): Promise<{ f: TacticalUiTest; name: string; escort: string }> {
    const a10 = await campaignInA10(kit, 5);
    const f = await tacticalUiTest(kit, ui, 5, a10.session);
    const roster = a10.campaign.campaign.battle?.roster;
    const sel = f.screen.selected ?? NOBODY;
    const escort = roster?.get(a10.mercs.find((id) => id !== sel) ?? NOBODY);
    const leader = roster?.get(sel);
    if (!escort || !leader) throw new Error('no squad');
    Object.assign(escort.record, { kind: MercKind.EPC });
    Object.assign(a10.campaign.campaign.state.profiles.get(leader.soldier.profile) ?? {}, { sex });
    f.deliver();
    return { f, name: leader.soldier.name, escort: escort.soldier.name };
  }

  it("words the exit menu's single-move help by the selected merc's profile sex, not his body", async () => {
    const texts: string[] = [];
    for (const sex of [MALE, FEMALE]) {
      const { f, name, escort } = await escortingSquad(sex);
      f.client.hintNow = async () => ({
        ok: true,
        data: { ...LADDER_OPTIONS, surfaceWarp: null, menu: { ...LADDER_OPTIONS.menu, singleMoveDisabled: true } },
      });
      await f.screen.controls.openExitDialog('north', null);
      const help = f.t.runtime.regions.regions.find((r) => r.id === 'exitSingle')?.tooltip ?? '';
      texts.push(help.replace(name, '<merc>').replace(escort, '<escort>'));
    }
    expect(texts).toEqual([
      '<merc> cannot leave this sector alone as he is escorting <escort>.',
      '<merc> cannot leave this sector alone as she is escorting <escort>.',
    ]);
  });

  it("words the lone merc's refused exit by his profile sex, not his body", async () => {
    const texts: string[] = [];
    for (const sex of [MALE, FEMALE]) {
      const { f, name, escort } = await escortingSquad(sex);
      const hint = f.client.hint.bind(f.client);
      f.client.hint = (request) =>
        request.type === 'exitSector'
          ? { state: 'ready', answer: { ok: false, data: { refusal: 'abandonEPC' } }, source: 'local' }
          : hint(request);
      f.world.edges = { left: false, right: false, top: true, bottom: false };
      const { width } = f.t.runtime.geometry();
      const before = f.screen.messageLines.length;
      await f.clickAt(width / 2, 1);
      texts.push(f.screen.messageLines.toReversed().slice(before).join(' ').replace(name, '<merc>').replace(escort, '<escort>'));
    }
    expect(texts).toEqual([
      '<merc> cannot leave this sector alone as he is escorting <escort>.',
      '<merc> cannot leave this sector alone as she is escorting <escort>.',
    ]);
  });
});

describe('the exchange cursor over a talkable NPC next to the selected merc, in a stub campaign', () => {
  async function besideTheStubNpc(): Promise<{ f: TacticalUiTest; npc: SoldierView }> {
    const a10 = await campaignInA10(kit, 5);
    const f = await tacticalUiTest(kit, ui, 5, a10.session);
    const sim = tacticalOf(a10.session);
    const t = sim.state;
    const npc = t.soldiers.find((v) => v?.profile === STUB_NPC);
    const sel = t.soldiers.find((v) => v?.id === f.screen.selected);
    if (!npc || !sel) throw new Error('no stub NPC or no selected merc');
    npc.ai.orders = Orders.STATIONARY;
    setSoldierPosition(t, sel, npc.gridNo + 1);
    sim.lookAround();
    f.deliver();
    f.world.camera = { centerX: (npc.gridNo % WORLD_COLS) * 10 + 5, centerY: Math.floor(npc.gridNo / WORLD_COLS) * 10 + 5 };
    return { f, npc: merc(f, npc.id) };
  }

  it('alternates every second with the talk cursor, the exchange cursor first', async () => {
    const { f, npc } = await besideTheStubNpc();
    hover(f, npc.gridNo);
    const cursors: string[] = [];
    for (let i = 0; i < EXCHANGE_CURSOR_SAMPLES; i++) {
      f.t.frame(EXCHANGE_CURSOR_SAMPLE_MS);
      cursors.push(f.screen.controls.input.uiCursor);
    }
    expect([cursors[4], cursors[15], cursors[26]]).toEqual(['EXCHANGE_PLACES_UICURSOR', 'TALK_A_UICURSOR', 'EXCHANGE_PLACES_UICURSOR']);
  });

  it('puts the held item back as a conversation starts, as InternalInitTalkingMenu erases the interface menus', async () => {
    const { f } = await besideTheStubNpc();
    const talker = f.screen.selected ?? -1;
    await f.click('teamFaceRegion0', MouseButton.RIGHT);
    await f.settle();
    const pocket = merc(f, f.screen.smMerc ?? -1).inventory?.find((i) => i.slot !== HAND_SLOT);
    await f.click(`slot${pocket?.slot}`);
    expect(f.screen.inventory.cursor).not.toBeNull();
    expect((await f.client.command({ type: 'talk', soldier: talker, target: { npc: STUB_NPC } })).ok).toBe(true);
    f.deliver();
    expect([f.client.view.conversation === null, f.screen.inventory.cursor]).toEqual([false, null]);
  });

  it('prints that the NPC refuses to move on a click on the exchange cursor', async () => {
    const { f, npc } = await besideTheStubNpc();
    hover(f, npc.gridNo);
    f.t.frame(EXCHANGE_CURSOR_SAMPLE_MS);
    expect(f.screen.controls.input.uiCursor).toBe('EXCHANGE_PLACES_UICURSOR');
    const at = f.world.pickPoint(npc.gridNo);
    await f.clickAt(at.x, at.y);
    expect(f.client.commands.at(-1)).toMatchObject({
      cmd: { type: 'swapPlaces', with: npc.id, cursor: true },
      reply: { ok: false, data: { refusal: 'npcRefusesToMove', soldier: npc.id } },
    });
    f.deliver();
    expect(f.screen.messageLines.at(-1)).toBe(`${npc.name} refuses to move.`);
  });
});
