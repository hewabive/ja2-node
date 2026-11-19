import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad } from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { FakeMercs, loadStrategicTestContent, ScriptedRolls, testContext } from '../../../tests/support/strategic.ts';
import { parseSectorId, parseSectorString, type Sector, strategicIndex } from '../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../content/strategic/strategic-content.ts';
import type { CrewMember } from '../strategic/economy/ports.ts';
import { createNewEnemyGroupDepartingFromSector, getGroup } from '../strategic/forces/groups.ts';
import type { StrategicContext } from '../strategic/forces/ports.ts';
import { cancelPathOfCharacterWithRoute } from '../strategic/forces/routes.ts';
import { addCharacterToSquad, initSquads } from '../strategic/forces/squads.ts';
import { initStrategicMovementCosts } from '../strategic/map/init.ts';
import { EventKind } from '../strategic/time/constants.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { plotRouteForCharacter } from './commands.ts';

let content: StrategicContent;
let kit: CampaignKit;

beforeAll(async () => {
  const [strategicContent, sectors, economy, army] = await Promise.all([
    loadStrategicTestContent(),
    loadStubSectorKit(),
    loadEconomyTestContent(),
    loadArmyTestContent(),
  ]);
  content = strategicContent;
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
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

  it('refuses a leg or a destination a merc cannot pass through, though a border opens onto it (MapScreen.cc:2307 SectorIsPassable)', () => {
    const { ctx } = squadInA9();
    const badSector = { ok: false, data: { refusal: 'badSector' } };
    expect(plotRouteForCharacter(ctx, 0, [], S('D1'), FRESH)).toMatchObject(badSector);
    expect(plotRouteForCharacter(ctx, 0, [S('D1')], S('C1'), FRESH)).toMatchObject(badSector);
    expect(squadGroup(ctx).betweenSectors).toBe(false);
    expect(plotRouteForCharacter(ctx, 0, [], S('C1'), FRESH)).toBeNull();
  });

  it('plots each leg with the Shift of its own click (Strategic_Pathing.cc:202-208)', () => {
    const plotted = (shortest: readonly boolean[]) => {
      const { ctx, mercs } = squadInA9();
      expect(plotRouteForCharacter(ctx, 0, [S('B9')], S('C5'), { shortest, extend: false })).toBeNull();
      return mercs.get(0)?.path;
    };
    expect(plotted([false, true])).toEqual(route('A9', 'B9', 'B8', 'B7', 'B6', 'B5', 'C5'));
    expect(plotted([true, false])).toEqual(route('A9', 'B9', 'C9', 'C8', 'C7', 'C6', 'C5'));
  });
});

describe('the route confirmed for the selected list (MapScreen.cc MAP_EVENT_PLOT_PATH, CheckIfClickOnLastSectorInPath)', () => {
  const PLOTTER = 0;
  const SQUAD_MATE = 1;
  const OTHER_SQUAD = 2;

  function twoSquadsInA9(): CampaignSim {
    const { campaign: c } = createTestCampaign(kit, { seed: 7, mercs: 3, garrison: { admins: 0, troops: 0, elites: 0 } });
    landFirstSquad(c);
    expect(c.dispatch({ type: 'mapScreen' }).ok).toBe(true);
    expect(c.dispatch({ type: 'assignSquad', soldier: OTHER_SQUAD, squad: 'new' }).ok).toBe(true);
    return c;
  }

  const ctxOf = (c: CampaignSim) => c.strategic ?? never('the strategic layer');
  const pathOf = (c: CampaignSim, id: number) => ctxOf(c).mercs.get(id)?.path;
  const groupOf = (c: CampaignSim, id: number) => getGroup(ctxOf(c), ctxOf(c).mercs.get(id)?.groupId ?? 0) ?? never(`the group of ${id}`);

  it('copies the path at each plotting click to the mercs selected then, without moving them (MapScreen.cc:2312-2315)', () => {
    const c = twoSquadsInA9();
    const selectedPerLeg = [
      [PLOTTER, SQUAD_MATE, OTHER_SQUAD],
      [PLOTTER, SQUAD_MATE],
    ];
    const confirm = {
      type: 'route',
      soldier: PLOTTER,
      to: 'C9',
      via: ['B9'],
      extend: true,
      selected: [PLOTTER, SQUAD_MATE],
      selectedPerLeg,
    };
    expect(c.dispatch(confirm)).toMatchObject({ ok: true, data: { path: ['A9', 'B9', 'C9'] } });
    expect(pathOf(c, OTHER_SQUAD)).toEqual(route('A9', 'B9'));
    expect(groupOf(c, OTHER_SQUAD)).toMatchObject({ betweenSectors: false, waypoints: [] });
    expect(groupOf(c, PLOTTER)).toMatchObject({ betweenSectors: true, waypoints: [S('C9')] });
  });

  it("moves a group selected only at the confirm along the plotting merc's path, its own left empty (MapScreen.cc:5569, :5647)", () => {
    const c = twoSquadsInA9();
    const crew = (id: number) => c.economy?.crew.get(id) as CrewMember;
    crew(OTHER_SQUAD).asleep = true;
    const selectedPerLeg = [[PLOTTER, SQUAD_MATE]];
    const confirm = { type: 'route', soldier: PLOTTER, to: 'C9', extend: true, selected: [PLOTTER, OTHER_SQUAD], selectedPerLeg };
    expect(c.dispatch(confirm).ok).toBe(true);
    expect(pathOf(c, OTHER_SQUAD)).toEqual([]);
    expect(groupOf(c, OTHER_SQUAD)).toMatchObject({ betweenSectors: true, next: S('B9'), waypoints: [S('C9')] });
    expect(crew(OTHER_SQUAD).asleep).toBe(false);
  });

  it('rebuilds a group selected again at the confirm of an unchanged route once, with the plotting merc path (MapScreen.cc:5609-5660)', () => {
    const c = twoSquadsInA9();
    expect(c.dispatch({ type: 'route', soldier: PLOTTER, to: 'C9', selected: [PLOTTER, SQUAD_MATE] }).ok).toBe(true);
    const group = groupOf(c, PLOTTER).id;
    const aboutToArrive = () => c.state.queue.events.filter((e) => e.kind === EventKind.GROUP_ABOUT_TO_ARRIVE && e.param === group).length;
    const announced = aboutToArrive();
    expect(c.dispatch({ type: 'route', soldier: PLOTTER, to: 'C9', selected: [PLOTTER, SQUAD_MATE] }).ok).toBe(true);
    expect(aboutToArrive()).toBe(announced + 1);
  });

  it('leaves out a selected merc the plot could not have started with, as one moving in another group (DeselectSelectedListMercsWhoCantMoveWithThisGuy; original-bugs)', () => {
    const c = twoSquadsInA9();
    expect(c.dispatch({ type: 'route', soldier: OTHER_SQUAD, to: 'A10' }).ok).toBe(true);
    const confirm = { type: 'route', soldier: PLOTTER, to: 'C9', extend: true, selected: [PLOTTER, OTHER_SQUAD] };
    expect(c.dispatch(confirm).ok).toBe(true);
    expect(pathOf(c, OTHER_SQUAD)).toEqual(route('A9', 'A10'));
    expect(groupOf(c, OTHER_SQUAD)).toMatchObject({ next: S('A10'), waypoints: [S('A10')] });
  });

  it('refuses a selection that names no mercs or a list per leg that does not match the legs', () => {
    const c = twoSquadsInA9();
    const refusal = { ok: false, data: { refusal: 'badSoldiers' } };
    expect(c.dispatch({ type: 'route', soldier: PLOTTER, to: 'C9', selected: 'all' })).toMatchObject(refusal);
    expect(c.dispatch({ type: 'route', soldier: PLOTTER, to: 'C9', selected: [PLOTTER, 99] })).toMatchObject(refusal);
    expect(c.dispatch({ type: 'route', soldier: PLOTTER, to: 'C9', selected: [PLOTTER], selectedPerLeg: [] })).toMatchObject(refusal);
  });
});

function never(what: string): never {
  throw new Error(`no ${what}`);
}
