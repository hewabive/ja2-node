import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approachUntilCombat, BATTLE_SANDBOX_SEED, tacticalOf, untilOurTurn } from '../../../../tests/support/save-scenarios.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { type TacticalUiKit, type TacticalUiTest, tacticalUiKit, tacticalUiTest } from '../../../../tests/support/tactical-ui.ts';
import type { DoorMenuOption } from '../../../protocol/hints.ts';
import { createItem, emptyObject } from '../../../sim/items/object.ts';
import { soldierCollapse } from '../../../sim/tactical/combat/hit.ts';
import { WeaponMode } from '../../../sim/tactical/combat/types.ts';
import { InvSlot } from '../../../sim/tactical/inventory.ts';
import type { DrawItem } from '../../draw-list.ts';
import { KeyModifier, MouseButton } from '../../input/events.ts';
import { UiMode } from './input/ui-events.ts';

const STANCE_MODES = { run: 'run', stand: 'walk', crouch: 'swat', prone: 'crawl' } as const;
const HOLD_MS = 400;
const COMA_LIFE = 5;
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

async function inCombat(): Promise<TacticalUiTest> {
  const f = await tacticalUiTest(kit, ui, BATTLE_SANDBOX_SEED);
  approachUntilCombat(f.session, false);
  untilOurTurn(f.session);
  f.client.refresh();
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
      menu,
    };
    const choices: unknown[] = [];
    const dialog = f.screen.controls.exitDialog;
    const request = {
      direction: 'north' as const,
      exitGrid: null,
      options,
      selected: merc(f, 0),
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
