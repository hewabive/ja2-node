import { beforeAll, describe, expect, it } from 'vitest';
import { FakeMercs, loadStrategicTestContent, testContext } from '../../../../tests/support/strategic.ts';
import { parseSectorString, type Sector, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import { initStrategicLayerMap } from '../map/init.ts';
import { EnemyKnowledge, whatPlayerKnowsAboutEnemiesInSector } from '../map/knowledge.ts';
import { sectorInfo } from '../map/sectors.ts';
import { Assignment, SectorFlag } from './constants.ts';
import { getGroup } from './groups.ts';
import type { StrategicContext } from './ports.ts';
import {
  cancelPathForCharacter,
  clearPathAfterThisSectorForCharacter,
  confirmPathForCharacter,
  PathEdit,
  plotPathForCharacter,
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
