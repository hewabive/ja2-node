import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaignInA10 } from '../../../../tests/support/a10-campaign.ts';
import { approachUntilCombat, BATTLE_SANDBOX_SEED, untilOurTurn } from '../../../../tests/support/save-scenarios.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { type TacticalUiKit, type TacticalUiTest, tacticalUiKit, tacticalUiTest } from '../../../../tests/support/tactical-ui.ts';
import { Body } from '../../../content/anim/body-types.ts';
import { WORLD_COLS } from '../../../content/world/grid.ts';
import type { SoldierView } from '../../../protocol/view.ts';
import { MouseButton } from '../../input/events.ts';
import { OKLIFE } from './faces.ts';
import { CLICK_HOLD_MS } from './input/tactical-input.ts';

const SEED = 4;
const CELL = 10;
const ASSIGN_MENU_ON_DUTY = 'assignmentMenu.line0';
const ASSIGN_MENU_TRAIN = 'assignmentMenu.line5';
const TRAIN_SELF = 'trainingMenu.line0';
const FIRST_STAT = 'attributeMenu.line0';
const ASSIGN_MENU_CANCEL = 'assignmentMenu.line6';
const ON_THE_SECOND_SQUAD = 'squadMenu.line1';
const SECOND_SQUAD = 1;
const ON_ANOTHER_ASSIGNMENT = 21;
const BOX_RIGHT_OF_MERC = 30;
const SCREEN_WIDTH = 640;
const NEAR_THE_RIGHT_EDGE = 600;
const BOX_BACK_NEAR_EDGE = 90;
const BELOW_THE_VIEWPORT = 345;

let kit: StubSectorKit;
let ui: TacticalUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await tacticalUiKit(kit);
});

afterAll(async () => {
  await kit.dispose();
});

async function inCampaign(): Promise<{ f: TacticalUiTest; merc: number }> {
  const a10 = await campaignInA10(kit, SEED);
  const merc = a10.mercs[0];
  if (merc === undefined) throw new Error('no merc in A10');
  const f = await tacticalUiTest(kit, ui, SEED, a10.session);
  lookAt(f, merc);
  await f.settle();
  return { f, merc };
}

function lookAt(f: TacticalUiTest, id: number): void {
  const at = soldier(f, id).gridNo;
  f.world.camera = { centerX: (at % WORLD_COLS) * CELL + CELL / 2, centerY: Math.floor(at / WORLD_COLS) * CELL + CELL / 2 };
}

function soldier(f: TacticalUiTest, id: number): SoldierView {
  const s = f.client.view.soldiers.find((v) => v.id === id);
  if (!s) throw new Error(`no soldier ${id}`);
  return s;
}

function pointAt(f: TacticalUiTest, id: number): { x: number; y: number } {
  const box = f.world.soldierBox(id);
  if (!box) throw new Error(`no box for ${id}`);
  return { x: box.x + Math.floor(box.width / 2), y: box.y + Math.floor(box.height / 2) };
}

function pointer(f: TacticalUiTest, kind: 'pointerMove' | 'pointerDown' | 'pointerUp', at: { x: number; y: number }, button: number): void {
  f.t.runtime.input({ kind, x: at.x, y: at.y, button, buttons: 0, wheel: 0, modifiers: 0 });
}

async function holdRight(f: TacticalUiTest, at: { x: number; y: number }): Promise<void> {
  pointer(f, 'pointerMove', at, MouseButton.LEFT);
  f.t.frame();
  f.t.frame();
  pointer(f, 'pointerDown', at, MouseButton.RIGHT);
  f.t.frame();
  f.t.frame(CLICK_HOLD_MS + 1);
  f.t.frame();
  await f.settle();
  pointer(f, 'pointerUp', at, MouseButton.RIGHT);
  await f.settle();
}

async function leftClick(f: TacticalUiTest, at: { x: number; y: number }): Promise<void> {
  pointer(f, 'pointerMove', at, MouseButton.LEFT);
  f.t.frame();
  f.t.frame();
  pointer(f, 'pointerDown', at, MouseButton.LEFT);
  f.t.frame();
  f.t.frame();
  pointer(f, 'pointerUp', at, MouseButton.LEFT);
  f.t.frame();
  await f.settle();
}

function commandsOf(f: TacticalUiTest, type: string) {
  return f.client.commands.filter((c) => c.cmd.type === type).map((c) => c.cmd);
}

function recordOpenings(f: TacticalUiTest): number[] {
  const opened: number[] = [];
  f.screen.assignmentMenu.openFor = (s) => {
    opened.push(s.id);
    return true;
  };
  return opened;
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

describe('the assignment menu on the tactical screen (PopupAssignmentMenuInTactical)', () => {
  it('opens beside the merc on a right hold in real time and assigns him alone', async () => {
    const { f, merc } = await inCampaign();
    const box = f.world.soldierBox(merc);
    if (!box) throw new Error('no box');
    await holdRight(f, pointAt(f, merc));
    expect([f.screen.assignmentMenu.open, f.screen.assignmentMenu.soldier]).toEqual([true, merc]);
    expect(f.screen.controls.movementMenu.open).toBe(false);
    expect(f.widget('assignmentMenu').rect).toMatchObject({ x: box.x + BOX_RIGHT_OF_MERC, y: box.y });
    await f.click(ASSIGN_MENU_TRAIN);
    await f.settle();
    await f.click(TRAIN_SELF);
    await f.settle();
    await f.click(FIRST_STAT);
    await f.settle();
    expect(commandsOf(f, 'assign').at(-1)).toMatchObject({ soldiers: [merc], to: { kind: 'trainSelf', stat: 0 } });
    expect(f.screen.assignmentMenu.open).toBe(false);
  });

  it('opens the squad list and puts the merc on the squad chosen', async () => {
    const { f, merc } = await inCampaign();
    await holdRight(f, pointAt(f, merc));
    await f.click(ASSIGN_MENU_ON_DUTY);
    await f.settle();
    const main = f.widget('assignmentMenu').rect;
    expect(f.widget('squadMenu').rect).toMatchObject({ x: main.x + main.width, y: main.y });
    await f.click(ON_THE_SECOND_SQUAD);
    await f.settle();
    expect(commandsOf(f, 'assignSquad').at(-1)).toMatchObject({ soldier: merc, squad: SECOND_SQUAD });
  });

  it('closes on its cancel line and on the second click outside, the first being the one that opened it', async () => {
    const { f, merc } = await inCampaign();
    const at = pointAt(f, merc);
    await holdRight(f, at);
    await f.click(ASSIGN_MENU_CANCEL);
    expect(f.screen.assignmentMenu.open).toBe(false);
    await holdRight(f, at);
    await f.clickAt(5, 5);
    expect(f.screen.assignmentMenu.open).toBe(true);
    await f.clickAt(5, 5);
    expect(f.screen.assignmentMenu.open).toBe(false);
    expect(commandsOf(f, 'assign')).toEqual([]);
  });

  it('keeps the box and its squad list on the screen and above the panel (CheckAndUpdateTacticalAssignmentPopUpPositions)', async () => {
    const { f, merc } = await inCampaign();
    f.world.soldierBox = () => ({ x: NEAR_THE_RIGHT_EDGE, y: BELOW_THE_VIEWPORT, width: 20, height: 40 });
    const bottom = f.widget('tacticalViewport').rect.height;
    f.screen.assignmentMenu.openFor(soldier(f, merc));
    await f.settle();
    const main = f.widget('assignmentMenu').rect;
    expect(main.x).toBe(NEAR_THE_RIGHT_EDGE + BOX_RIGHT_OF_MERC - BOX_BACK_NEAR_EDGE);
    expect(main.y + main.height).toBeLessThanOrEqual(bottom);
    await f.click(ASSIGN_MENU_ON_DUTY);
    await f.settle();
    const moved = f.widget('assignmentMenu').rect;
    const squads = f.widget('squadMenu').rect;
    expect(squads.x).toBe(moved.x + moved.width);
    expect(squads.x + squads.width).toBeLessThanOrEqual(SCREEN_WIDTH);
    expect(squads.y + squads.height).toBeLessThanOrEqual(bottom);
  });

  it('opens with a left click on a merc on another assignment instead of selecting him in real time', async () => {
    const { f, merc } = await inCampaign();
    const other = f.screen.teamSlots.find((id) => id !== null && id !== merc);
    if (other === undefined || other === null) throw new Error('a second merc expected');
    f.screen.select(merc, false);
    f.t.frame();
    const opened = recordOpenings(f);
    Object.assign(soldier(f, other), { squad: null });
    Object.assign(f.client.view.strategic?.mercs.find((m) => m.id === other) ?? {}, { assignment: ON_ANOTHER_ASSIGNMENT });
    lookAt(f, other);
    await leftClick(f, pointAt(f, other));
    expect(opened).toEqual([other]);
    expect(f.screen.selected).toBe(merc);
  });

  it('falls back to the movement menu with no campaign, whose assignments do not exist', async () => {
    const f = await tacticalUiTest(kit, ui);
    const merc = f.screen.selected;
    if (merc === null) throw new Error('nobody selected');
    await holdRight(f, pointAt(f, merc));
    expect([f.screen.assignmentMenu.open, f.screen.controls.movementMenu.open]).toEqual([false, true]);
  });

  it('opens in combat on a right hold over our merc, but not over a dying one or a vehicle (QueryTBRightButton)', async () => {
    const f = await inCombat();
    const opened = recordOpenings(f);
    const [first, second, third] = f.screen.teamSlots.filter((id): id is number => id !== null);
    if (first === undefined || second === undefined || third === undefined) throw new Error('three mercs expected');
    await holdRight(f, pointAt(f, first));
    expect(opened).toEqual([first]);
    Object.assign(soldier(f, second), { life: OKLIFE - 1 });
    await holdRight(f, pointAt(f, second));
    expect(opened).toEqual([first]);
    expect(f.screen.controls.movementMenu.open).toBe(true);
    f.screen.controls.movementMenu.close(null);
    await f.settle();
    Object.assign(soldier(f, third), { bodyType: Body.HUMVEE, passengers: [first] });
    await holdRight(f, pointAt(f, third));
    expect(opened).toEqual([first]);
  });

  it('opens in combat on a left click on a merc on another assignment, which selects nobody (QueryTBLeftButton)', async () => {
    const f = await inCombat();
    const opened = recordOpenings(f);
    const other = f.screen.teamSlots.find((id) => id !== null && id !== f.screen.selected);
    if (other === undefined || other === null) throw new Error('a second merc expected');
    const selected = f.screen.selected;
    Object.assign(soldier(f, other), { squad: null });
    await leftClick(f, pointAt(f, other));
    expect([opened, f.screen.selected]).toEqual([[other], selected]);
  });
});
