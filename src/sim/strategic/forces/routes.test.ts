import { beforeAll, describe, expect, it } from 'vitest';
import { FakeMercs, loadStrategicTestContent, testContext } from '../../../../tests/support/strategic.ts';
import { parseSectorString, type Sector, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import { initStrategicLayerMap } from '../map/init.ts';
import { EnemyKnowledge, whatPlayerKnowsAboutEnemiesInSector } from '../map/knowledge.ts';
import { sectorInfo } from '../map/sectors.ts';
import { EventKind } from '../time/constants.ts';
import { Assignment, SectorFlag } from './constants.ts';
import { getGroup } from './groups.ts';
import type { StrategicContext } from './ports.ts';
import {
  cancelPathForCharacter,
  cancelPathOfCharacterWithRoute,
  clearPathAfterThisSectorForCharacter,
  confirmPathForCharacter,
  copyPathToAllSelectedCharacters,
  PathEdit,
  pathStoreOf,
  plotPathForCharacter,
  rebuildWayPointsForAllSelectedCharsGroups,
} from './routes.ts';
import { addCharacterToSquad } from './squads.ts';

let content: StrategicContent;

beforeAll(async () => {
  content = await loadStrategicTestContent();
});

const S = (name: string): Sector => parseSectorString(name);
const route = (...names: string[]) => names.map((n) => strategicIndex(S(n)));

function squadInA9(): { ctx: StrategicContext; mercs: FakeMercs } {
  const mercs = new FakeMercs();
  const ctx = testContext({ content, mercs });
  initStrategicLayerMap(ctx);
  for (const id of [0, 1]) {
    mercs.add({ id, sector: S('A9') });
    addCharacterToSquad(ctx, id, 0);
  }
  return { ctx, mercs };
}

describe('route commands', () => {
  it('plots from the end of the current path, shares the path with the squad and departs on confirmation', () => {
    const { ctx, mercs } = squadInA9();
    expect(plotPathForCharacter(ctx, 0, S('C9'))).toBe(true);
    expect(mercs.get(0)?.path).toEqual(route('A9', 'B9', 'C9'));
    expect(plotPathForCharacter(ctx, 0, S('C10'))).toBe(true);
    expect(mercs.get(1)?.path).toEqual(route('A9', 'B9', 'C9', 'C10'));
    confirmPathForCharacter(ctx, 0);
    const g = getGroup(ctx, ctx.state.forces.squadGroupIds[0] ?? 0);
    expect(g).toMatchObject({ betweenSectors: true, next: S('B9'), waypoints: [S('C9'), S('C10')] });
  });

  it('refuses invalid destinations, mercs in transit and mercs underground', () => {
    const { ctx, mercs } = squadInA9();
    expect(plotPathForCharacter(ctx, 0, { x: 0, y: 1, z: 0 })).toBe(false);
    const m = mercs.get(0);
    if (m) m.assignment = Assignment.IN_TRANSIT;
    expect(plotPathForCharacter(ctx, 0, S('C9'))).toBe(false);
    if (m) Object.assign(m, { assignment: 0, sector: { ...S('A9'), z: 1 } });
    expect(plotPathForCharacter(ctx, 0, S('C9'))).toBe(false);
  });

  it('shortens the path after a sector on it, cancels it from the current sector and turns again on a second cancel', () => {
    const { ctx, mercs } = squadInA9();
    plotPathForCharacter(ctx, 0, S('D9'));
    expect(clearPathAfterThisSectorForCharacter(ctx, 0, S('B9'))).toBe(PathEdit.PATH_SHORTENED);
    expect(mercs.get(1)?.path).toEqual(route('A9', 'B9'));
    expect(clearPathAfterThisSectorForCharacter(ctx, 0, S('F9'))).toBe(PathEdit.ABORT_PLOTTING);
    confirmPathForCharacter(ctx, 0);
    ctx.state.clock.seconds += 20 * 60;
    expect(clearPathAfterThisSectorForCharacter(ctx, 0, S('A9'))).toBe(PathEdit.PATH_CLEARED);
    const g = getGroup(ctx, ctx.state.forces.squadGroupIds[0] ?? 0);
    expect(g).toMatchObject({ sector: S('B9'), next: S('A9'), betweenSectors: true });
    expect(mercs.get(1)?.path).toEqual([]);
    cancelPathForCharacter(ctx, 1);
    expect(g).toMatchObject({ sector: S('A9'), next: S('B9') });
  });
});

describe('plotting on an underground traversal (Map_Screen_Interface_Map.cc PlotPathForCharacter)', () => {
  it('builds no path and names each merc, or his squad, who cannot get travel orders underground', () => {
    const emitted: unknown[] = [];
    const mercs = new FakeMercs();
    const ctx = testContext({ content, mercs, helicopter: { emit: (e) => emitted.push(e) } });
    initStrategicLayerMap(ctx);
    const below = { ...S('A9'), z: 1 };
    mercs.add({ id: 0, sector: below });
    addCharacterToSquad(ctx, 0, 0);
    mercs.add({ id: 1, sector: below, assignment: Assignment.ON_DUTY });
    expect(plotPathForCharacter(ctx, 0, S('A10'), { tacticalTraversal: true })).toBe(false);
    expect(plotPathForCharacter(ctx, 1, S('A10'), { tacticalTraversal: true })).toBe(false);
    expect(mercs.get(0)?.path).toEqual([]);
    expect(emitted).toEqual([
      { type: 'noTravelOrdersUnderground', who: { kind: 'squad', squad: 0 } },
      { type: 'noTravelOrdersUnderground', who: { kind: 'merc', soldier: 1 } },
    ]);
  });
});

describe('cancelling the routes of the selected mercs (MapScreen.cc CancelPathsOfAllSelectedCharacters)', () => {
  it('cancels only a merc with a route, so a second cancel leaves a returning squad on its way back', () => {
    const { ctx } = squadInA9();
    plotPathForCharacter(ctx, 0, S('C9'));
    confirmPathForCharacter(ctx, 0);
    ctx.state.clock.seconds += 20 * 60;
    expect(cancelPathOfCharacterWithRoute(ctx, 0)).toBe(true);
    const g = getGroup(ctx, ctx.state.forces.squadGroupIds[0] ?? 0);
    expect(g).toMatchObject({ sector: S('B9'), next: S('A9'), betweenSectors: true });
    expect(cancelPathOfCharacterWithRoute(ctx, 1)).toBe(false);
    expect(g).toMatchObject({ sector: S('B9'), next: S('A9'), betweenSectors: true });
  });
});

describe('what the player knows about enemies', () => {
  it('counts enemies where mercs or nearby militia scout and only notes presence in visited sectors', () => {
    const { ctx, mercs } = squadInA9();
    expect(whatPlayerKnowsAboutEnemiesInSector(ctx, S('A9'))).toBe(EnemyKnowledge.HOW_MANY);
    expect(whatPlayerKnowsAboutEnemiesInSector(ctx, S('C9'))).toBe(EnemyKnowledge.NOTHING);
    sectorInfo(ctx.state.map, S('D10')).militia[1] = 2;
    expect(whatPlayerKnowsAboutEnemiesInSector(ctx, S('C9'))).toBe(EnemyKnowledge.HOW_MANY);
    sectorInfo(ctx.state.map, S('D10')).militia[1] = 0;
    sectorInfo(ctx.state.map, S('C9')).flags |= SectorFlag.ALREADY_VISITED | SectorFlag.SKYRIDER_NOTICED_ENEMIES_HERE;
    expect(whatPlayerKnowsAboutEnemiesInSector(ctx, S('C9'))).toBe(EnemyKnowledge.THEYRE_THERE);
    sectorInfo(ctx.state.map, S('C9')).flags &= ~SectorFlag.ALREADY_VISITED;
    expect(whatPlayerKnowsAboutEnemiesInSector(ctx, S('C9'))).toBe(EnemyKnowledge.NOTHING);
    expect(sectorInfo(ctx.state.map, S('C9')).flags & SectorFlag.SKYRIDER_NOTICED_ENEMIES_HERE).toBe(0);
    const m = mercs.get(0);
    if (m) Object.assign(m, { asleep: true });
    expect(whatPlayerKnowsAboutEnemiesInSector(ctx, S('A9'))).toBe(EnemyKnowledge.HOW_MANY);
  });
});

describe('the selected list at a plotting click and at the confirm (MapScreen.cc CopyPathToAllSelectedCharacters, RebuildWayPointsForAllSelectedCharsGroups)', () => {
  function twoSquadsInA9() {
    const world = squadInA9();
    world.mercs.add({ id: 2, sector: S('A9') });
    addCharacterToSquad(world.ctx, 2, 1);
    return world;
  }

  const squadGroup = (ctx: StrategicContext, squad: number) => getGroup(ctx, ctx.state.forces.squadGroupIds[squad] ?? 0);
  const aboutToArrive = (ctx: StrategicContext, group: number | undefined) =>
    ctx.state.queue.events.filter((e) => e.kind === EventKind.GROUP_ABOUT_TO_ARRIVE && e.param === group).length;

  it('rebuilds each selected group once, one on foot with the plotting merc path though its own differs (MapScreen.cc:5609-5660)', () => {
    const { ctx, mercs } = twoSquadsInA9();
    plotPathForCharacter(ctx, 2, S('A11'));
    plotPathForCharacter(ctx, 0, S('C9'));
    const plotter = mercs.get(0);
    if (!plotter) throw new Error('no plotting merc');
    rebuildWayPointsForAllSelectedCharsGroups(ctx, plotter, [0, 1, 2]);
    expect(squadGroup(ctx, 0)).toMatchObject({ betweenSectors: true, next: S('B9'), waypoints: [S('C9')] });
    expect(aboutToArrive(ctx, squadGroup(ctx, 0)?.id)).toBe(1);
    expect(squadGroup(ctx, 1)).toMatchObject({ betweenSectors: true, next: S('B9'), waypoints: [S('C9')] });
    expect(mercs.get(2)?.path).toEqual(route('A9', 'A10', 'A11'));
  });

  it("copies the plotting merc's path to the others selected, his own path left as it is", () => {
    const { ctx, mercs } = twoSquadsInA9();
    plotPathForCharacter(ctx, 0, S('C9'));
    const plotter = mercs.get(0);
    if (!plotter) throw new Error('no plotting merc');
    copyPathToAllSelectedCharacters(ctx, [2, 0], pathStoreOf(plotter), route('A9', 'B9'));
    expect(mercs.get(2)?.path).toEqual(route('A9', 'B9'));
    expect(plotter.path).toEqual(route('A9', 'B9', 'C9'));
    expect(squadGroup(ctx, 1)?.betweenSectors).toBe(false);
  });
});
