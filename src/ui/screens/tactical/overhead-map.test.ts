import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tacticalOf } from '../../../../tests/support/save-scenarios.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { type TacticalUiKit, type TacticalUiTest, tacticalUiKit, tacticalUiTest } from '../../../../tests/support/tactical-ui.ts';
import { FontColor } from '../../../content/text/font-colors.ts';
import { WORLD_COLS, WORLD_MAX } from '../../../content/world/grid.ts';
import { createItem, emptyObject } from '../../../sim/items/object.ts';
import { InvSlot } from '../../../sim/tactical/inventory.ts';
import { addItemToPool, flatRoofAboveGridNo, Visibility } from '../../../sim/tactical/world-items.ts';
import { rgb } from '../../draw-list.ts';
import { MouseButton } from '../../input/events.ts';
import type { OverheadMapView } from './environment.ts';
import { COMPATIBLE_HILIGHT, WHITE_HILIGHT } from './faces.ts';

const SMALL_FONT = 'smallfont1';
const TINY_FONT = 'tinyfont1';
const CABINET_HEIGHT = 40;
const ITEM_Y = 6;
const ROOF_LIST_LIFT = 5;
const BIG_POCKET = 7;
const FAR_AWAY = 0;
const POINTER_IN_MAP = { x: 100, y: 100 };
const RED = rgb(255, 0, 0);
const TEAM_BUTTONS = ['teamSquad', 'teamMapScreen', 'teamFirstHand0', 'teamSecondHand0', 'teamEnemyIndicator0'];

let kit: StubSectorKit;
let ui: TacticalUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await tacticalUiKit(kit);
});

afterAll(async () => {
  await kit.dispose();
});

interface Pointer {
  items: number;
  soldiers: number;
}

function fakeMap(pointer: Pointer): OverheadMapView {
  return {
    render: () => undefined,
    pointOf: (gridNo) => ({ x: (gridNo % WORLD_COLS) * 2, y: Math.floor(gridNo / WORLD_COLS) }),
    gridNoAt: () => pointer.items,
    soldierGridNoAt: () => pointer.soldiers,
  };
}

function merc(f: TacticalUiTest, id: number) {
  const s = f.client.view.soldiers.find((v) => v.id === id);
  if (!s) throw new Error(`no merc ${id}`);
  return s;
}

function placeItem(f: TacticalUiTest, tile: number, item: string, level = 0, zHeight?: number): void {
  const t = tacticalOf(f.session).state;
  const def = t.content.items.byName.get(item);
  if (!def) throw new Error(`no item ${item}`);
  addItemToPool(t, tile, createItem(t.content.items, def.index, 100), Visibility.VISIBLE, level, 0, zHeight);
  f.advance(1);
}

async function openOverOverheadMap(f: TacticalUiTest, pointer: Pointer): Promise<void> {
  f.world.overhead = fakeMap(pointer);
  f.key('Insert');
  const map = f.widget('overheadMap').rect;
  f.t.move(map.x + POINTER_IN_MAP.x, map.y + POINTER_IN_MAP.y);
  await f.settle();
}

function poolListRows(f: TacticalUiTest): number[] {
  const rows = f
    .draw()
    .items.flatMap((i) =>
      i.kind === 'glyphs' && i.font === SMALL_FONT && i.foreground === FontColor.MCOLOR_DKGRAY ? [i.glyphs[0]?.y ?? -1] : [],
    );
  return rows.sort((a, b) => a - b);
}

function dotColours(f: TacticalUiTest, gridNo: number): number[] {
  const map = f.widget('overheadMap').rect;
  const x = map.x + (gridNo % WORLD_COLS) * 2;
  const y = map.y + Math.floor(gridNo / WORLD_COLS) + ITEM_Y;
  return f.draw().items.flatMap((i) => (i.kind === 'fill' && i.x === x && i.y === y && i.width === 1 && i.height === 1 ? [i.color] : []));
}

function facesFramed(f: TacticalUiTest, colour: number): number[] {
  const lit = f.draw().items.filter((i) => i.kind === 'rectangle' && i.color === colour);
  return f.screen.teamSlots.flatMap((id, slot) => {
    const face = f.widget(`teamFace${slot}`).rect;
    const framed = lit.some((r) => r.kind === 'rectangle' && r.x1 === face.x - 2 && r.y1 === face.y - 1);
    return framed && id !== null ? [id] : [];
  });
}

function tinyWhiteNames(f: TacticalUiTest): number {
  return f.draw().items.filter((i) => i.kind === 'glyphs' && i.font === TINY_FONT && i.foreground === FontColor.MCOLOR_WHITE).length;
}

function teamButtonsEnabled(f: TacticalUiTest): boolean[] {
  return TEAM_BUTTONS.map((id) => f.widget(id).enabled);
}

describe('the overhead map on the tactical screen', () => {
  it('asks the world for a new picture at every entry, as GoIntoOverheadMap sets gfOverheadMapDirty', async () => {
    const f = await tacticalUiTest(kit, ui);
    await openOverOverheadMap(f, { items: FAR_AWAY, soldiers: FAR_AWAY });
    f.key('Escape');
    f.key('Insert');
    expect([f.screen.controls.overhead.open, f.world.overheadRedraws]).toEqual([true, 2]);
  });

  it("lists the pool nearest the pointer and dots it red, its items on a structure only with the pointer on their cell: GetZLevelOfItemPoolGivenStructure reads the pointer's cell", async () => {
    const f = await tacticalUiTest(kit, ui);
    const tile = merc(f, 0).gridNo + 3;
    placeItem(f, tile, 'GLOCK_17');
    placeItem(f, tile, 'KEVLAR_VEST');
    placeItem(f, tile, 'CANTEEN', 0, CABINET_HEIGHT);
    const pointer = { items: tile + 1, soldiers: FAR_AWAY };
    await openOverOverheadMap(f, pointer);
    expect([poolListRows(f).length, dotColours(f, tile)]).toEqual([2, [RED, RED, RED]]);
    pointer.items = tile;
    await f.settle();
    expect([poolListRows(f).length, dotColours(f, tile)]).toEqual([1, [RED, RED, RED]]);
    pointer.items = tile + 2;
    await f.settle();
    expect(poolListRows(f)).toEqual([]);
    expect(dotColours(f, tile)).not.toContain(RED);
  });

  it("lists the nearest roof pool's floor items 5 pixels above the ground pool's and dots the roof pool red, the one listed last", async () => {
    const f = await tacticalUiTest(kit, ui);
    const t = tacticalOf(f.session).state;
    const roofed = Array.from({ length: WORLD_MAX }, (_, g) => g).find((g) => g % WORLD_COLS > 0 && flatRoofAboveGridNo(t, g));
    if (roofed === undefined) throw new Error('no flat roof on the stub map');
    const tile = roofed - 1;
    placeItem(f, tile, 'GLOCK_17');
    placeItem(f, roofed, 'KEVLAR_VEST', 1);
    expect(f.client.view.items?.find((i) => i.gridNo === roofed)?.level).toBe(1);
    await openOverOverheadMap(f, { items: tile, soldiers: FAR_AWAY });
    const rows = poolListRows(f);
    expect(rows.map((y) => y - (rows[0] ?? 0))).toEqual([0, ROOF_LIST_LIFT]);
    expect(dotColours(f, roofed)).toEqual([RED]);
    expect(dotColours(f, tile)).not.toContain(RED);
  });

  it('lights the faces of the squad mates carrying something compatible with an item it lists, as DrawItemPoolList does', async () => {
    const f = await tacticalUiTest(kit, ui);
    const t = tacticalOf(f.session).state;
    const clip = t.content.items.byName.get('CLIP9_15')?.index ?? 0;
    for (const s of t.soldiers) {
      if (s?.team !== 0) continue;
      for (let slot = 0; slot < s.inv.length; slot++) s.inv[slot] = emptyObject();
    }
    const loader = t.soldiers.find((s) => s?.id === 2);
    if (!loader) throw new Error('no merc 2');
    loader.inv[InvSlot.SMALLPOCK1] = createItem(t.content.items, clip, 100);
    const tile = merc(f, 0).gridNo + 3;
    placeItem(f, tile, 'GLOCK_17');
    const pointer = { items: tile, soldiers: FAR_AWAY };
    await openOverOverheadMap(f, pointer);
    expect(facesFramed(f, COMPATIBLE_HILIGHT)).toEqual([2]);
    pointer.items = tile + 2;
    await f.settle();
    expect(facesFramed(f, COMPATIBLE_HILIGHT)).toEqual([]);
  });

  it('names the soldier nearest the full soldier cell under the pointer, eight rows below the item cell, and lights his face white (gSelectedGuy)', async () => {
    const f = await tacticalUiTest(kit, ui);
    const pointer = { items: FAR_AWAY, soldiers: FAR_AWAY };
    await openOverOverheadMap(f, pointer);
    const names = tinyWhiteNames(f);
    pointer.soldiers = merc(f, 1).gridNo + 1;
    await f.settle();
    expect([tinyWhiteNames(f) - names, facesFramed(f, WHITE_HILIGHT)]).toEqual([1, [1]]);
  });

  it('selects a merc from his face without locating him and opens no panel on a right click (MercFacePanelCallbackPrimary, MercFacePanelCallbackSecondary)', async () => {
    const f = await tacticalUiTest(kit, ui);
    f.display = { ...f.display, oldSelectionMethod: true };
    await openOverOverheadMap(f, { items: FAR_AWAY, soldiers: FAR_AWAY });
    const located = f.world.located.length;
    await f.click('teamFaceRegion1');
    expect([f.screen.selected, f.world.located.length, f.attention]).toEqual([1, located, [1]]);
    await f.click('teamFaceRegion1', MouseButton.RIGHT);
    await f.settle();
    expect(f.screen.panel).toBe('team');
  });

  it('disables the team panel buttons and hands while it is up and enables them as it closes, even under the item cursor that disabled them before (DisableTacticalTeamPanelButtons)', async () => {
    const f = await tacticalUiTest(kit, ui);
    const pointer = { items: FAR_AWAY, soldiers: FAR_AWAY };
    expect(teamButtonsEnabled(f)).toEqual([true, true, true, true, true]);
    await openOverOverheadMap(f, pointer);
    expect(teamButtonsEnabled(f)).toEqual([false, false, false, false, false]);
    f.key('Escape');
    await f.settle();
    expect(teamButtonsEnabled(f)).toEqual([true, true, true, true, true]);
    await f.click('teamFaceRegion0', MouseButton.RIGHT);
    await f.settle();
    await f.click(`slot${BIG_POCKET}`);
    expect(f.screen.inventory.cursor).not.toBeNull();
    await openOverOverheadMap(f, pointer);
    expect([f.screen.panel, ...teamButtonsEnabled(f)]).toEqual(['team', false, false, false, false, false]);
    f.key('Escape');
    await f.settle();
    expect([f.screen.inventory.cursor !== null, ...teamButtonsEnabled(f)]).toEqual([true, true, true, true, true, true]);
  });

  it('opens with a right click on the radar and closes with a left click there, which centres the view only while it is closed (RadarRegionButtonCallbackPrimary, RadarRegionButtonCallbackSecondary)', async () => {
    const f = await tacticalUiTest(kit, ui);
    f.world.overhead = fakeMap({ items: FAR_AWAY, soldiers: FAR_AWAY });
    await f.click('radarRegion', MouseButton.RIGHT);
    expect([f.screen.controls.overhead.open, f.screen.panel, f.world.overheadRedraws]).toEqual([true, 'team', 1]);
    await f.click('radarRegion');
    expect([f.screen.controls.overhead.open, f.world.radarCentred.length]).toEqual([false, 0]);
    await f.click('radarRegion', MouseButton.RIGHT);
    await f.click('radarRegion', MouseButton.RIGHT);
    expect(f.screen.controls.overhead.open).toBe(false);
    await f.click('radarRegion');
    expect([f.screen.controls.overhead.open, f.world.radarCentred.length]).toEqual([false, 1]);
  });
});
