import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tacticalOf } from '../../../../tests/support/save-scenarios.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { type TacticalUiKit, type TacticalUiTest, tacticalUiKit, tacticalUiTest } from '../../../../tests/support/tactical-ui.ts';
import { addStubTank, PROF_HUMMER, stubCampaignAtTheHummer } from '../../../../tests/support/vehicles.ts';
import { FontColor } from '../../../content/text/font-colors.ts';
import { Direction, gridNo, WORLD_COLS } from '../../../content/world/grid.ts';
import type { PreviewAction } from '../../../protocol/hints.ts';
import type { SoldierView } from '../../../protocol/view.ts';
import type { CampaignSession } from '../../../server/campaign-session.ts';
import { Session } from '../../../server/session.ts';
import { createItem } from '../../../sim/items/object.ts';
import { FACT_OK_USE_HUMMER } from '../../../sim/strategic/forces/helicopter.ts';
import { setFact } from '../../../sim/strategic/narrative/facts.ts';
import { InvSlot } from '../../../sim/tactical/inventory.ts';
import { Body, Team } from '../../../sim/tactical/soldier.ts';
import { whoIsThere } from '../../../sim/tactical/state.ts';
import { enterCombatMode } from '../../../sim/tactical/turns/turns.ts';
import { rgb } from '../../draw-list.ts';
import { MouseButton } from '../../input/events.ts';
import { FontName } from '../../text/fonts.ts';
import { glyphRun } from '../../text/print.ts';
import { UiEvent, UiMode } from './input/ui-events.ts';
import { LocateFlag } from './overlays.ts';

const SEED = 31;
const SETTLE_PAST_THE_REST = 8;
const WALK_BUDGET = 20_000;
const FULL_STATUS = 100;
const TANK_AT = gridNo(66 + 10, 66 + 14);
const CELL = 10;
const ROWS_SOUTH_OF_THE_HUMMER = 3;
const COLUMNS_WEST_OF_THE_HUMMER = 3;
const ASSIGNMENT_EMPTY = 34;
const VEHICLE_CANT_MOVE_IN_TACTICAL = 128;
const VEHICLE_NAME = 'Hummer';
const TANK_NAME = 'Tank';
const TANK_LIFE = 61;
const TANK_FUEL = 73;
const BAR_WIDTH = 16;
const FULL = 100;
const BOX_LIFE = rgb(200, 0, 0);
const BOX_BREATH = rgb(100, 100, 220);

let kit: StubSectorKit;
let ui: TacticalUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await tacticalUiKit(kit);
});

afterAll(async () => {
  await kit.dispose();
});

interface Point {
  readonly x: number;
  readonly y: number;
}

async function atTheHummer(allowed: boolean): Promise<TacticalUiTest> {
  const campaign = await stubCampaignAtTheHummer(kit, SEED, 'plain');
  setFact(campaign.campaign.state.narrative, FACT_OK_USE_HUMMER, allowed);
  const f = await tacticalUiTest(kit, ui, SEED, new Session('hummer', campaign));
  f.deliver();
  const at = hummer(f).gridNo;
  f.world.camera = { centerX: (at % WORLD_COLS) * CELL + CELL / 2, centerY: Math.floor(at / WORLD_COLS) * CELL + CELL / 2 };
  await f.settle();
  return f;
}

function hummer(f: TacticalUiTest): SoldierView {
  const s = f.client.view.soldiers.find((v) => v.profile === PROF_HUMMER);
  if (!s) throw new Error('no Hummer in view');
  return s;
}

function selected(f: TacticalUiTest): SoldierView {
  const s = f.client.view.soldiers.find((v) => v.id === f.screen.selected);
  if (!s) throw new Error('nobody selected');
  return s;
}

function commandsOf(f: TacticalUiTest, type: string) {
  return f.client.commands.filter((c) => c.cmd.type === type).map((c) => c.cmd);
}

function onThePicture(f: TacticalUiTest, id: number): Point {
  const box = f.world.soldierBox(id);
  if (!box) throw new Error(`no picture of ${id}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function onThePictureOffItsTiles(f: TacticalUiTest, id: number): Point {
  const box = f.world.soldierBox(id);
  const t = tacticalOf(f.session).state;
  if (!box) throw new Error(`no picture of ${id}`);
  for (let y = box.y; y < box.y + box.height; y++)
    for (let x = box.x; x < box.x + box.width; x++) {
      const tile = f.world.gridNoAt(x, y);
      if (tile !== null && whoIsThere(t, tile, 0)?.id !== id) return { x, y };
    }
  throw new Error(`the picture of ${id} lies on its tiles only`);
}

async function pointAt(f: TacticalUiTest, at: Point): Promise<void> {
  f.t.runtime.input({ kind: 'pointerMove', x: at.x, y: at.y, button: MouseButton.LEFT, buttons: 0, wheel: 0, modifiers: 0 });
  await f.settle(SETTLE_PAST_THE_REST);
}

function holdInHand(f: TacticalUiTest, item: string): void {
  const t = tacticalOf(f.session).state;
  const merc = t.soldiers[selected(f).id];
  const index = t.content.items.byName.get(item)?.index;
  if (!merc || index === undefined) throw new Error(`no ${item} for the selected merc`);
  merc.inv[InvSlot.HAND] = createItem(t.content.items, index, FULL_STATUS);
  f.client.refresh();
}

async function boardTheHummer(f: TacticalUiTest): Promise<number> {
  const merc = selected(f).id;
  const at = onThePicture(f, hummer(f).id);
  await f.clickAt(at.x, at.y);
  f.session.advance({ idle: true }, WALK_BUDGET);
  f.deliver();
  await f.settle();
  return merc;
}

function besideTheHummer(f: TacticalUiTest): Point {
  return f.world.pickPoint(hummer(f).gridNo + ROWS_SOUTH_OF_THE_HUMMER * WORLD_COLS - COLUMNS_WEST_OF_THE_HUMMER);
}

function campaignOf(f: TacticalUiTest): CampaignSession {
  return f.session.sim as CampaignSession;
}

function drawnAboveGuy(f: TacticalUiTest, text: string): number[] {
  const font = f.t.runtime.fonts.get(FontName.TINYFONT1);
  const wanted = glyphRun(font, text, 0, 0)
    .glyphs.map((g) => g.index)
    .join();
  return f.draw().items.flatMap((i) => (i.kind === 'glyphs' && i.glyphs.map((g) => g.index).join() === wanted ? [i.foreground] : []));
}

describe('boarding a vehicle with the cursor (Handle_UI.cc UIHandleInteractiveTilesAndItemsOnTerrain, Turn_Based_Input.cc CheckForAndHandleHandleVehicleInteractiveClick)', () => {
  it('shows the enter cursor by hand over the Hummer whether it may be used or not, and boards it on the click only once it may', async () => {
    for (const allowed of [false, true]) {
      const f = await atTheHummer(allowed);
      const merc = selected(f).id;
      f.screen.controls.toggleHandCursor();
      await f.settle();
      expect(f.screen.controls.input.mode).toBe(UiMode.HANDCURSOR_MODE);
      const at = onThePicture(f, hummer(f).id);
      await pointAt(f, at);
      expect(f.screen.controls.input.uiCursor).toBe('ENTER_VEHICLE_UICURSOR');
      await f.clickAt(at.x, at.y);
      const boarding = { type: 'enterVehicle', soldier: merc, vehicle: hummer(f).id, cursor: 'hand' };
      expect(commandsOf(f, 'enterVehicle')).toEqual(allowed ? [boarding] : []);
    }
  });

  it('turns the move cursor over the Hummer to cannot-move while it may not be used, and to enter once it may, and only then does the click board it', async () => {
    const cursors: string[] = [];
    const boardings: number[] = [];
    for (const allowed of [false, true]) {
      const f = await atTheHummer(allowed);
      const at = onThePicture(f, hummer(f).id);
      await pointAt(f, at);
      cursors.push(f.screen.controls.input.uiCursor);
      await f.clickAt(at.x, at.y);
      boardings.push(commandsOf(f, 'enterVehicle').length);
      expect(commandsOf(f, 'move')).toEqual([]);
    }
    expect([cursors, boardings.map((n) => n > 0)]).toEqual([
      ['CANNOT_MOVE_UICURSOR', 'ENTER_VEHICLE_UICURSOR'],
      [false, true],
    ]);
  });

  it('orders the boarding at the press of a real-time move click and again at its release, which the press does not intercept (Real_Time_Input.cc QueryRTLeftButton)', async () => {
    const f = await atTheHummer(true);
    const merc = selected(f).id;
    const at = onThePicture(f, hummer(f).id);
    await pointAt(f, at);
    const boarding = { type: 'enterVehicle', soldier: merc, vehicle: hummer(f).id, cursor: 'move' };
    f.t.runtime.input({ kind: 'pointerDown', x: at.x, y: at.y, button: MouseButton.LEFT, buttons: 0, wheel: 0, modifiers: 0 });
    await f.settle(1);
    expect(commandsOf(f, 'enterVehicle')).toEqual([boarding]);
    f.t.runtime.input({ kind: 'pointerUp', x: at.x, y: at.y, button: MouseButton.LEFT, buttons: 0, wheel: 0, modifiers: 0 });
    await f.settle(1);
    expect(commandsOf(f, 'enterVehicle')).toEqual([boarding, boarding]);
  });

  it('names no enterable vehicle under the pointer, as UIHandleOnMerc leaves gSelectedGuy alone', async () => {
    const f = await atTheHummer(true);
    await pointAt(f, onThePicture(f, hummer(f).id));
    expect(drawnAboveGuy(f, hummer(f).name)).toEqual([]);
  });
});

describe('a merc aboard a vehicle on the tactical screen', () => {
  it('shows the floating X with the vehicle selected and says it cannot move on a click (UIHandleMOnTerrain, HandleMoveModeInteractiveClick)', async () => {
    const f = await atTheHummer(true);
    await boardTheHummer(f);
    expect(selected(f).bodyType).toBe(Body.HUMVEE);
    const beside = besideTheHummer(f);
    await pointAt(f, beside);
    expect(f.screen.controls.input.uiCursor).toBe('FLOATING_X_UICURSOR');
    await f.clickAt(beside.x, beside.y);
    expect(f.screen.messageLines.at(-1)).toBe(f.text.string('TacticalStr', VEHICLE_CANT_MOVE_IN_TACTICAL));
    expect(commandsOf(f, 'move')).toEqual([]);
  });

  it("names the vehicle's life and fuel in the driver's first hand and takes him out through his second hand (TMClickSecondHandInvCallbackPrimary)", async () => {
    const f = await atTheHummer(true);
    const merc = await boardTheHummer(f);
    const vehicle = selected(f);
    const tooltip = (id: string) => f.t.runtime.regions.regions.find((r) => r.id === id)?.tooltip;
    expect(tooltip('teamFirstHand0')).toBe(`Health: ${vehicle.life}/${vehicle.lifeMax}\nFuel: ${vehicle.breath}/${vehicle.breathMax}`);
    expect(tooltip('teamSecondHand0')).toBe('Exit Vehicle');
    await f.click('teamSecondHand0');
    expect(commandsOf(f, 'exitVehicle')).toEqual([{ type: 'exitVehicle', soldier: merc }]);
    expect(f.client.view.soldiers.find((s) => s.id === merc)?.vehicle ?? null).toBeNull();
  });

  it('names a vehicle of ours in white while somebody is aboard, and in grey under its Empty assignment in yellow once empty (Interface.cc DrawSelectedUIAboveGuy)', async () => {
    const f = await atTheHummer(true);
    const merc = await boardTheHummer(f);
    const vehicle = selected(f);
    const empty = `(${f.text.string('pAssignmentStrings', ASSIGNMENT_EMPTY)})`;
    expect([drawnAboveGuy(f, VEHICLE_NAME), drawnAboveGuy(f, empty)]).toEqual([[FontColor.MCOLOR_WHITE], []]);
    await f.click('teamSecondHand0');
    f.deliver();
    f.screen.select(merc, false);
    f.screen.locate(vehicle.id, LocateFlag.SETLOCATOR);
    await f.settle();
    expect([drawnAboveGuy(f, VEHICLE_NAME), drawnAboveGuy(f, empty)]).toEqual([[FontColor.GRAY4], [FontColor.YELLOW]]);
  });
});

describe('the toolkit and the gas can over a vehicle (UI_Cursors.cc HandleRepairCursor, HandleRefuelCursor)', () => {
  it("turns good anywhere on the Hummer's picture, by the Hummer's tile, and stays bad elsewhere; the click orders the repair or the refuel at the Hummer", async () => {
    const cursors: string[] = [];
    for (const [item, order] of [
      ['TOOLKIT', 'repair'],
      ['GAS_CAN', 'refuel'],
    ] as const) {
      const f = await atTheHummer(true);
      holdInHand(f, item);
      f.screen.controls.input.override(UiEvent.M_CHANGE_TO_ACTION);
      await pointAt(f, besideTheHummer(f));
      cursors.push(f.screen.controls.input.uiCursor);
      const at = onThePictureOffItsTiles(f, hummer(f).id);
      await pointAt(f, at);
      cursors.push(f.screen.controls.input.uiCursor);
      await f.clickAt(at.x, at.y);
      expect(commandsOf(f, order)).toEqual([{ type: order, soldier: selected(f).id, gridNo: hummer(f).gridNo }]);
    }
    expect(cursors).toEqual(['BAD_REPAIR_UICURSOR', 'GOOD_REPAIR_UICURSOR', 'REFUEL_GREY_UICURSOR', 'REFUEL_RED_UICURSOR']);
  });

  it('draws the walk, the move grid and the AP in combat, and turns good over an enemy tank as well', async () => {
    const f = await atTheHummer(true);
    const t = tacticalOf(f.session).state;
    addStubTank(t, { body: Body.TANK_NW, team: Team.ENEMY, gridNo: TANK_AT, direction: Direction.SOUTH });
    campaignOf(f).campaign.tactical?.lookAround();
    enterCombatMode(t, Team.OUR);
    holdInHand(f, 'TOOLKIT');
    f.deliver();
    f.screen.controls.input.override(UiEvent.M_CHANGE_TO_ACTION);
    const target = hummer(f);
    const preview = await f.client.hintNow({ type: 'previewAction', soldier: selected(f).id, gridNo: target.gridNo, kind: 'repair' });
    const data = preview.data as PreviewAction;
    await pointAt(f, onThePicture(f, target.id));
    expect(f.screen.controls.input.uiCursor).toBe('GOOD_REPAIR_UICURSOR');
    expect(f.screen.controls.input.mouseText()?.actionPoints).toMatchObject({ value: data.apCost });
    expect(f.world.markers.some((m) => m.tile.startsWith('FOOTPRINTS'))).toBe(true);
    expect(f.world.markers.find((m) => m.tile.startsWith('FIRSTPOINTERS'))?.gridNo).toBe(data.actionGridNo);
    const tank = f.client.view.soldiers.find((s) => s.bodyType === Body.TANK_NW);
    if (!tank) throw new Error('the tank is not in view');
    await pointAt(f, onThePicture(f, tank.id));
    expect(f.screen.controls.input.uiCursor).toBe('GOOD_REPAIR_UICURSOR');
  });
});

describe('the name and bars of a vehicle (Vehicles.cc SetVehicleValuesIntoSoldierType, Interface.cc DrawSelectedUIAboveGuy)', () => {
  it('names the Hummer by zVehicleName of its type, whatever name its soldier carries, above it and on the overhead map', async () => {
    const f = await atTheHummer(true);
    expect(hummer(f).name).not.toBe(VEHICLE_NAME);
    await boardTheHummer(f);
    expect(selected(f).bodyType).toBe(Body.HUMVEE);
    expect(drawnAboveGuy(f, VEHICLE_NAME)).toEqual([FontColor.MCOLOR_WHITE]);
    f.world.overhead = {
      render: (list, x, y) => list.fill(x, y, x + 10, y + 10, 0),
      pointOf: (gridNo) => ({ x: (gridNo % WORLD_COLS) * 2, y: Math.floor(gridNo / WORLD_COLS) }),
      gridNoAt: () => null,
      soldierGridNoAt: () => null,
    };
    f.key('Insert');
    expect(f.screen.controls.overhead.open).toBe(true);
    expect(drawnAboveGuy(f, VEHICLE_NAME)).toEqual([FontColor.MCOLOR_WHITE]);
  });

  it('draws the life and fuel bars of an enemy tank under the pointer where another soldier not ours shows his health word, its name grey as nobody is aboard', async () => {
    const f = await atTheHummer(true);
    const t = tacticalOf(f.session).state;
    const tank = addStubTank(t, { body: Body.TANK_NW, team: Team.ENEMY, gridNo: TANK_AT, direction: Direction.SOUTH });
    Object.assign(tank, { life: TANK_LIFE, breath: TANK_FUEL });
    campaignOf(f).campaign.tactical?.lookAround();
    f.deliver();
    await f.settle();
    const seen = f.client.view.soldiers.find((s) => s.id === tank.id);
    if (!seen) throw new Error('the tank is not in view');
    expect(seen).toMatchObject({ life: TANK_LIFE, breath: TANK_FUEL });
    await pointAt(f, onThePicture(f, tank.id));
    const lines = f.draw().items.flatMap((i) => (i.kind === 'rectangle' ? [i] : []));
    const drawn = (color: number, value: number) =>
      lines.some((l) => l.color === color && l.x2 === Math.trunc(l.x1 + (value / FULL) * BAR_WIDTH));
    expect([drawnAboveGuy(f, TANK_NAME), drawnAboveGuy(f, f.text.string('zHealthStr', seen.healthIndex ?? 0) ?? '')]).toEqual([
      [FontColor.GRAY4],
      [],
    ]);
    expect([drawn(BOX_LIFE, TANK_LIFE), drawn(BOX_BREATH, TANK_FUEL)]).toEqual([true, true]);
  });
});
