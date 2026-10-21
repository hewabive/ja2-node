import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approachUntilCombat, BATTLE_SANDBOX_SEED, untilOurTurn } from '../../../../tests/support/save-scenarios.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { type TacticalUiKit, type TacticalUiTest, tacticalUiKit, tacticalUiTest } from '../../../../tests/support/tactical-ui.ts';
import type { DoorMenuOption } from '../../../protocol/hints.ts';
import type { DrawItem } from '../../draw-list.ts';
import { KeyModifier, MouseButton } from '../../input/events.ts';
import { UiMode } from './input/ui-events.ts';

const SLOW_MS = 120_000;
const HOLD_MS = 400;
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

let kit: StubSectorKit;
let ui: TacticalUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await tacticalUiKit(kit);
}, SLOW_MS);

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
  it(
    'walks the selected merc to a clicked tile in real time and draws the cursor marker there',
    async () => {
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
    },
    SLOW_MS,
  );

  it(
    'sends the stance, stealth and weapon mode keys for the selected merc',
    async () => {
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
    },
    SLOW_MS,
  );

  it(
    'toggles the tree tops and the wireframes with their messages',
    async () => {
      const f = await tacticalUiTest(kit, ui);
      const trees = f.display.treeTops;
      f.key('t');
      f.key('w');
      await f.settle();
      expect(f.display.treeTops).toBe(!trees);
      expect(f.screen.messageLines.some((l) => /Treetops/.test(l))).toBe(true);
      expect(f.screen.messageLines.some((l) => /Wireframes/.test(l))).toBe(true);
    },
    SLOW_MS,
  );

  it(
    'opens the movement menu on a held right button and crouches with the sneak button',
    async () => {
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
    },
    SLOW_MS,
  );

  it(
    'opens the door menu from the doorMenu event and sends the chosen action',
    async () => {
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
    },
    SLOW_MS,
  );

  it(
    'opens the overhead map with Insert, centres the view on a click and closes',
    async () => {
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
    },
    SLOW_MS,
  );

  it(
    'scrolls the view at the screen edge after the pending step',
    async () => {
      const f = await tacticalUiTest(kit, ui);
      pointer(f, 'pointerMove', 2, 100, MouseButton.LEFT);
      for (let i = 0; i < 5; i++) f.t.frame(20);
      expect(f.world.scrolled.length).toBeGreaterThan(0);
      expect(f.world.scrolled[0]).toEqual({ dx: -40, dy: 0 });
    },
    SLOW_MS,
  );

  it(
    'shows the path and the AP cost on the first click in combat and moves on the confirming click',
    async () => {
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
    },
    SLOW_MS,
  );

  it(
    'switches to the action cursor over a seen enemy, confirms the aim while the pointer rests and fires on a click',
    async () => {
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
      await f.clickAt(aim.x, aim.y);
      expect(commandsOf(f, 'attack').at(-1)).toMatchObject({ soldier: 0, target: enemy.gridNo });
    },
    SLOW_MS,
  );
});
