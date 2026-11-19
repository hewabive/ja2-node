import { beforeAll, describe, expect, it } from 'vitest';
import { FakeMercs, loadStrategicTestContent, ScriptedRolls, testContext } from '../../../tests/support/strategic.ts';
import { parseSectorId, parseSectorString, type Sector, strategicIndex } from '../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../content/strategic/strategic-content.ts';
import { createNewEnemyGroupDepartingFromSector, getGroup } from '../strategic/forces/groups.ts';
import type { StrategicContext } from '../strategic/forces/ports.ts';
import { cancelPathOfCharacterWithRoute } from '../strategic/forces/routes.ts';
import { addCharacterToSquad, initSquads } from '../strategic/forces/squads.ts';
import { initStrategicMovementCosts } from '../strategic/map/init.ts';
import { EventKind } from '../strategic/time/constants.ts';
import { plotRouteForCharacter } from './commands.ts';

let content: StrategicContent;

beforeAll(async () => {
  content = await loadStrategicTestContent();
});

const S = (name: string): Sector => parseSectorString(name);
const route = (...names: string[]) => names.map((n) => strategicIndex(S(n)));
const FRESH = { shortest: false, extend: false } as const;
const TRAVELLED_MINUTES = 20;

function squadInA9(rolls = new ScriptedRolls()): { ctx: StrategicContext; mercs: FakeMercs } {
  const mercs = new FakeMercs();
  const ctx = testContext({ content, mercs, random: rolls });
  initStrategicMovementCosts(ctx);
  initSquads(ctx);
  for (const id of [0, 1]) {
    mercs.add({ id, sector: S('A9') });
    addCharacterToSquad(ctx, id, 0);
  }
  return { ctx, mercs };
}

function squadGroup(ctx: StrategicContext) {
  const g = getGroup(ctx, ctx.state.forces.squadGroupIds[0] ?? 0);
  if (!g) throw new Error('no squad group');
  return g;
}

const aboutToArrive = (ctx: StrategicContext) => ctx.state.queue.events.filter((e) => e.kind === EventKind.GROUP_ABOUT_TO_ARRIVE).length;

describe('the route command', () => {
  it('plots a returning squad without a route from where it stands, turning it back only through its first waypoint', () => {
    const { ctx, mercs } = squadInA9();
    expect(plotRouteForCharacter(ctx, 0, [], S('D9'), FRESH)).toBeNull();
    ctx.state.clock.seconds += TRAVELLED_MINUTES * 60;
    cancelPathOfCharacterWithRoute(ctx, 0);
    const g = squadGroup(ctx);
    expect(g).toMatchObject({ sector: S('B9'), next: S('A9'), betweenSectors: true });
    const announced = aboutToArrive(ctx);
    expect(plotRouteForCharacter(ctx, 0, [], S('C9'), FRESH)).toBeNull();
    expect(g).toMatchObject({ sector: S('A9'), next: S('B9'), waypoints: [S('B9'), S('C9')] });
    expect(mercs.get(1)?.path).toEqual(route('A9', 'B9', 'C9'));
    expect(aboutToArrive(ctx)).toBe(announced + 1);
  });

  it('rebuilds the waypoints of an unchanged route confirmed again, posting another about-to-arrive event and delaying an enemy group that now crosses it (MapScreen.cc:5569)', () => {
    const rolls = new ScriptedRolls([4]);
    const { ctx } = squadInA9(rolls);
    expect(plotRouteForCharacter(ctx, 0, [], S('C9'), FRESH)).toBeNull();
    const g = squadGroup(ctx);
    const enemies = createNewEnemyGroupDepartingFromSector(ctx, parseSectorId('B9'), 0, 2, 0);
    Object.assign(enemies, { betweenSectors: true, next: S('A9'), arrivalTime: g.arrivalTime - 1 });
    expect(rolls.ranges).toEqual([]);
    const announced = aboutToArrive(ctx);
    expect(plotRouteForCharacter(ctx, 1, [], S('C9'), FRESH)).toBeNull();
    expect(aboutToArrive(ctx)).toBe(announced + 1);
    expect(rolls.ranges).toEqual([10]);
    expect(enemies.arrivalTime).toBe(g.arrivalTime + 5);
    expect(g).toMatchObject({ next: S('B9'), waypoints: [S('C9')] });
  });

  it('confirms the empty route of a returning squad at the sector it stands in by turning it again (MapScreen.cc:5542)', () => {
    const { ctx } = squadInA9();
    expect(plotRouteForCharacter(ctx, 0, [], S('C9'), FRESH)).toBeNull();
    ctx.state.clock.seconds += TRAVELLED_MINUTES * 60;
    cancelPathOfCharacterWithRoute(ctx, 0);
    const g = squadGroup(ctx);
    expect(g).toMatchObject({ sector: S('B9'), next: S('A9') });
    expect(plotRouteForCharacter(ctx, 0, [], S('B9'), FRESH)).toBeNull();
    expect(g).toMatchObject({ sector: S('A9'), next: S('B9'), waypoints: [] });
  });
});
