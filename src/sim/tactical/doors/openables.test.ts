import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Orientation } from '../../../content/formats/jsd.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { has, StructureFlags } from '../../../content/world/structures.ts';
import { syntheticStructure } from '../../../content/world/synthetic.ts';
import { createItem } from '../../items/object.ts';
import type { TacticalContent } from '../content.ts';
import { openableStatuses, openContainerGridNos, setOpenableStructStatus } from '../doors.ts';
import { type Soldier, Team } from '../soldier.ts';
import type { TacticalState } from '../state.ts';
import { addItemToPool, Visibility } from '../world-items.ts';
import { handleOpenableStruct } from './door-actions.ts';
import { HandleDoor } from './door-table.ts';
import { handleStructChangeFromGridNo } from './openables.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const CRATE = gridNo(81, 80);
const MATERIAL_THICKER_METAL = 22;

function crateFile(flags = 0) {
  const closed = {
    ...syntheticStructure(StructureFlags.OPENABLE | flags, Orientation.NONE, { armour: MATERIAL_THICKER_METAL }),
    partnerDelta: 1,
  };
  const open = {
    ...syntheticStructure(StructureFlags.OPENABLE | StructureFlags.OPEN | flags, Orientation.NONE, { armour: MATERIAL_THICKER_METAL }),
    number: 1,
    partnerDelta: -1,
  };
  return { closed, file: { structureCount: 2, auxData: null, tileLocations: [], structures: [closed, open] } };
}

function crateBeside(items: readonly string[], team: number = Team.OUR): { t: TacticalState; opener: Soldier } {
  const sim = newCombatSim(content);
  const t = sim.state;
  const { closed, file } = crateFile();
  t.world.structures.add(CRATE, 0, closed, undefined, file);
  for (const name of items)
    addItemToPool(t, CRATE, createItem(content.items, content.items.byName.get(name)?.index ?? 0, 100), Visibility.HIDDEN_IN_OBJECT, 0);
  const opener = spawnSoldier(sim, team === Team.OUR ? 0 : 60, team, gridNo(80, 80), Direction.EAST);
  t.events.length = 0;
  return { t, opener };
}

const crateOpen = (t: TacticalState) => has(t.world.structures.find(CRATE, StructureFlags.OPENABLE)?.flags ?? 0, StructureFlags.OPEN);
const visibility = (t: TacticalState) => t.worldItems.filter((wi) => wi.gridNo === CRATE).map((wi) => wi.visible);
const exclamations = (t: TacticalState) => t.events.flatMap((e) => (e.type === 'contentsExclaimed' ? [e.sound] : []));

describe('HandleStructChangeFromGridNo', () => {
  it('opens a crate, shows what it holds with a HUMM and hides it again when closed', () => {
    const { t, opener } = crateBeside(['FIRSTAIDKIT']);
    handleStructChangeFromGridNo(t, opener, CRATE);
    expect(crateOpen(t)).toBe(true);
    expect(visibility(t)).toEqual([Visibility.VISIBLE]);
    expect(openContainerGridNos(t)).toEqual([CRATE]);
    expect(t.events.find((e) => e.type === 'contentsExclaimed')).toMatchObject({ soldier: 0, sound: 'HUMM' });
    expect(t.events.some((e) => e.type === 'itemsRevealed')).toBe(true);
    t.events.length = 0;
    handleStructChangeFromGridNo(t, opener, CRATE);
    expect(crateOpen(t)).toBe(false);
    expect(visibility(t)).toEqual([Visibility.HIDDEN_IN_OBJECT]);
    expect(openContainerGridNos(t)).toEqual([]);
    expect(exclamations(t)).toEqual([]);
  });

  it('cheers three items, sighs at an empty crate and keeps a stranger quiet over a small find', () => {
    const rich = crateBeside(['FIRSTAIDKIT', 'FIRSTAIDKIT', 'FIRSTAIDKIT']);
    handleStructChangeFromGridNo(rich.t, rich.opener, CRATE);
    expect(exclamations(rich.t)).toEqual(['COOL1']);
    const empty = crateBeside([]);
    handleStructChangeFromGridNo(empty.t, empty.opener, CRATE);
    expect(exclamations(empty.t)).toEqual(['NOTHING']);
    const stranger = crateBeside(['FIRSTAIDKIT'], Team.ENEMY);
    handleStructChangeFromGridNo(stranger.t, stranger.opener, CRATE);
    expect(exclamations(stranger.t)).toEqual([]);
    expect(visibility(stranger.t)).toEqual([Visibility.VISIBLE]);
    expect(stranger.t.events.some((e) => e.type === 'itemsRevealed')).toBe(false);
  });

  it('is what HandleOpenableStruct does once a merc opens a crate without a door record', () => {
    const { t, opener } = crateBeside(['FIRSTAIDKIT']);
    const crate = t.world.structures.find(CRATE, StructureFlags.OPENABLE);
    if (!crate) throw new Error('no crate');
    opener.doorHandleCode = HandleDoor.OPEN;
    expect(handleOpenableStruct(t, opener, CRATE, crate)).toBe(true);
    expect(crateOpen(t)).toBe(true);
    expect(t.events.filter((e) => e.type === 'doorChanged')).toEqual([]);
  });

  it('lets a merc walk up to a crate with the door command, open it and refuse to open it twice', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const { closed, file } = crateFile();
    t.world.structures.add(CRATE, 0, closed, undefined, file);
    addItemToPool(
      t,
      CRATE,
      createItem(content.items, content.items.byName.get('FIRSTAIDKIT')?.index ?? 0, 100),
      Visibility.HIDDEN_IN_OBJECT,
      0,
    );
    const merc = spawnSoldier(sim, 0, Team.OUR, gridNo(76, 80), Direction.EAST);
    expect(sim.dispatch({ type: 'door', soldier: merc.id, gridNo: CRATE, action: 'open' })).toMatchObject({
      ok: true,
      data: { walking: true },
    });
    runUntilIdle(sim);
    expect(crateOpen(t)).toBe(true);
    expect(visibility(t)).toEqual([Visibility.VISIBLE]);
    expect(sim.openContainers()).toEqual([CRATE]);
    expect(sim.openDoors()).toEqual([]);
    expect(sim.dispatch({ type: 'door', soldier: merc.id, gridNo: CRATE, action: 'open' })).toMatchObject({
      ok: false,
      data: { refusal: 'alreadyOpen' },
    });
    expect(sim.dispatch({ type: 'door', soldier: merc.id, gridNo: CRATE, action: 'unlock' })).toMatchObject({
      ok: false,
      data: { refusal: 'noDoor' },
    });
    expect(sim.dispatch({ type: 'door', soldier: merc.id, gridNo: CRATE, action: 'close' })).toMatchObject({ ok: true });
    runUntilIdle(sim);
    expect(crateOpen(t)).toBe(false);
    expect(sim.openContainers()).toEqual([]);
  });

  it('records the status of every openable tile and puts a reloaded crate back as it was, contents included', () => {
    const { t, opener } = crateBeside(['FIRSTAIDKIT']);
    expect(openableStatuses(t)).toEqual([{ gridNo: CRATE, open: false }]);
    handleStructChangeFromGridNo(t, opener, CRATE);
    expect(openableStatuses(t)).toEqual([{ gridNo: CRATE, open: true }]);
    setOpenableStructStatus(t, CRATE, false);
    expect(crateOpen(t)).toBe(false);
    expect(visibility(t)).toEqual([Visibility.HIDDEN_IN_OBJECT]);
    setOpenableStructStatus(t, CRATE, true);
    expect(visibility(t)).toEqual([Visibility.VISIBLE]);
  });
});
