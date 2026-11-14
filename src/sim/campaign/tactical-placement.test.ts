import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type CampaignKit,
  createTestCampaign,
  landFirstSquad,
  ourGroupAtPreBattleInB9,
  ourSoldiers,
  spreadAndPlace,
} from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { expectReloadsInvisible, type RunMode } from '../../../tests/support/reload.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { Rng } from '../../core/rng.ts';
import { Assignment } from '../strategic/economy/constants.ts';
import { type BattlePrompt, PlacementButton } from '../strategic/forces/battle-state.ts';
import { InsertionCode } from '../strategic/forces/constants.ts';
import {
  beginMapEdgepointSearch,
  edgepointList,
  endMapEdgepointSearch,
  searchForClosestPrimaryMapEdgepoint,
} from '../tactical/edgepoints.ts';
import { NOWHERE, Team } from '../tactical/soldier.ts';
import { type TacticalState, teamMembers } from '../tactical/state.ts';
import type { CampaignSim } from './campaign-sim.ts';
import type { Roster } from './roster.ts';
import { placedByThePlayer } from './tactical-placement.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const A9 = { x: 9, y: 1, z: 0 };
const B9 = { x: 9, y: 2, z: 0 };
const NORTH_STRIP_INWARD = 3 * 161;

interface Placing {
  readonly c: CampaignSim;
  readonly roster: Roster;
}

type BeforeEntering = (c: CampaignSim, roster: Roster) => void;

function placing(beforeEntering: BeforeEntering = () => {}, mode?: RunMode): Placing {
  const { campaign, roster } = ourGroupAtPreBattleInB9(kit, mode);
  const p = { c: campaign, roster };
  const prompt = p.c.state.battle.prompt;
  if (prompt?.kind !== 'preBattle') throw new Error('no pre-battle panel');
  beforeEntering(p.c, p.roster);
  const entered = p.c.dispatch({ type: 'answer', prompt: prompt.id, choice: 'enterSector' });
  if (!entered.ok) throw new Error(`enterSector refused: ${entered.reason}`);
  return p;
}

type PlacementPrompt = Extract<BattlePrompt, { kind: 'tacticalPlacement' }>;

function placement(c: CampaignSim): PlacementPrompt {
  const prompt = c.state.battle.prompt;
  if (prompt?.kind !== 'tacticalPlacement') throw new Error(`no placement prompt: ${prompt?.kind ?? 'none'}`);
  return prompt;
}

function answer(c: CampaignSim, choice: string, extra: Record<string, unknown> = {}) {
  return c.dispatch({ type: 'answer', prompt: placement(c).id, choice, ...extra });
}

function tactical(c: CampaignSim): TacticalState {
  const t = c.tactical?.state;
  if (!t) throw new Error('no loaded sector');
  return t;
}

function northEdgepoints(c: CampaignSim): readonly number[] {
  return edgepointList(tactical(c), InsertionCode.NORTH, true) ?? [];
}

function pieceTiles(c: CampaignSim, roster: Roster): (number | null)[] {
  return placement(c).pieces.map((p) => (p.placed ? (roster.get(p.soldier)?.soldier.gridNo ?? null) : null));
}

function enemies(c: CampaignSim): number {
  return teamMembers(tactical(c), Team.ENEMY).length;
}

describe('the tactical placement of a pre-battle Go to sector (Tactical_Placement_GUI.cc)', () => {
  it('holds the load at a placement prompt with every merc of the group waiting on his side, none placed under the default Clear and no enemy added yet (StrategicMap.cc:892-896, Tactical_Placement_GUI.cc:72, :572-590)', () => {
    const { c } = placing();
    expect(c.state.flow).toBe('tactical');
    expect(c.hasPendingDecision()).toBe(true);
    expect(placement(c).pieces).toEqual([0, 1, 2, 3].map((soldier) => ({ soldier, side: InsertionCode.NORTH, placed: false })));
    expect(ourSoldiers(c)).toEqual([]);
    expect(enemies(c)).toBe(0);
  });

  it('lists only our living mercs of the battle group sector on the surface, never the POWs, those in transit or between sectors (:150-175)', () => {
    const { campaign: c, roster } = createTestCampaign(kit, { seed: 31, mode: 'plain' });
    landFirstSquad(c);
    const [dead, pow, transit, travelling] = roster.all();
    if (!dead || !pow || !transit || !travelling) throw new Error('four mercs expected');
    expect(roster.all().map((m) => placedByThePlayer(m, A9))).toEqual([true, true, true, true]);
    expect(placedByThePlayer(dead, B9)).toBe(false);
    dead.soldier.life = 0;
    pow.assignment = Assignment.ASSIGNMENT_POW;
    transit.assignment = Assignment.IN_TRANSIT;
    travelling.betweenSectors = true;
    expect(roster.all().map((m) => placedByThePlayer(m, A9))).toEqual([false, false, false, false]);
  });

  it('turns an edge-index insertion code into the side it stores (:178-182)', () => {
    const { c, roster } = placing((_c, r) => {
      const merc = r.get(2);
      if (!merc) throw new Error('no merc 2');
      merc.insertionCode = InsertionCode.PRIMARY_EDGEINDEX;
      merc.soldier.insertionData = InsertionCode.EAST;
    });
    expect(placement(c).pieces[2]).toEqual({ soldier: 2, side: InsertionCode.EAST, placed: false });
    expect(roster.get(2)?.insertionCode).toBe(InsertionCode.EAST);
  });

  it('spreads every merc onto a random edge point of his side, one Random draw each in list order, his piece put down there (ChooseRandomEdgepoints)', () => {
    const { c, roster } = placing();
    const north = northEdgepoints(c);
    const rolls = Rng.fromState(c.state.rng.state());
    const chosen = [0, 1, 2, 3].map(() => north[rolls.int(north.length)]);
    expect(answer(c, 'spread')).toEqual({ ok: true });
    expect(pieceTiles(c, roster)).toEqual(chosen);
    expect(c.state.rng.state()).toEqual(rolls.state());
    expect(c.state.battle.placementButton).toBe(PlacementButton.SPREAD);
    expect(roster.all().map((m) => [m.insertionCode, m.soldier.insertionData])).toEqual(chosen.map((g) => [InsertionCode.GRIDNO, g]));
  });

  it('puts the merc named on the edge point of his side closest to the tile, faced to the centre (HandleTacticalPlacementClicksInOverheadMap, PutDownMercPiece)', () => {
    const { c, roster } = placing();
    const [first, second] = northEdgepoints(c);
    if (first === undefined || second === undefined) throw new Error('no north edge points');
    const inward = second + NORTH_STRIP_INWARD;
    const t = tactical(c);
    beginMapEdgepointSearch(t);
    const closest = searchForClosestPrimaryMapEdgepoint(t, inward, InsertionCode.NORTH, false);
    endMapEdgepointSearch(t);
    expect(answer(c, 'place', { soldier: 0, gridNo: first })).toEqual({ ok: true });
    expect(answer(c, 'place', { soldier: 1, gridNo: inward })).toEqual({ ok: true });
    expect(pieceTiles(c, roster)).toEqual([first, closest, null, null]);
    expect(roster.get(0)?.soldier.placed).toBe(true);
    expect(answer(c, 'place', { soldier: 7, gridNo: first })).toMatchObject({ ok: false, data: { refusal: 'notPlacing' } });
  });

  it('writes NOWHERE into the insertion data of a placed merc a spot with no edge point near cannot take, his piece left where it was (:798-808)', () => {
    const { c, roster } = placing();
    const [first] = northEdgepoints(c);
    if (first === undefined) throw new Error('no north edge points');
    expect(answer(c, 'place', { soldier: 0, gridNo: first })).toEqual({ ok: true });
    const centre = tactical(c).world.map?.info.centerGridNo ?? NOWHERE;
    expect(answer(c, 'place', { soldier: 0, gridNo: centre })).toMatchObject({ ok: false, data: { refusal: 'placementInaccessible' } });
    expect(pieceTiles(c, roster)[0]).toBe(first);
    expect(roster.get(0)?.soldier.insertionData).toBe(NOWHERE);
  });

  it('can place no merc whose side is no map edge: place is refused and Spread writes NOWHERE into his insertion data, so Done never comes (TacticalPlacementHandle gfValidCursor, ChooseRandomEdgepoints)', () => {
    const { c, roster } = placing((_c, r) => {
      const merc = r.get(3);
      if (!merc) throw new Error('no merc 3');
      merc.insertionCode = InsertionCode.GRIDNO;
    });
    const [first] = northEdgepoints(c);
    expect(answer(c, 'place', { soldier: 3, gridNo: first })).toMatchObject({ ok: false, data: { refusal: 'placementInvalid' } });
    expect(answer(c, 'spread')).toEqual({ ok: true });
    expect(pieceTiles(c, roster)[3]).toBeNull();
    expect(roster.get(3)?.soldier.insertionData).toBe(NOWHERE);
    expect(answer(c, 'done')).toMatchObject({ ok: false, data: { refusal: 'placementIncomplete' } });
  });

  it('places the whole group of the merc named under Group, and Group again goes back to Clear with everyone left placed (GroupPlacementsCallback)', () => {
    const { c, roster } = placing();
    const [first] = northEdgepoints(c);
    expect(answer(c, 'group')).toEqual({ ok: true });
    expect(c.state.battle.placementButton).toBe(PlacementButton.GROUP);
    expect(answer(c, 'place', { soldier: 2, gridNo: first })).toEqual({ ok: true });
    const tiles = pieceTiles(c, roster);
    expect(tiles.every((g) => g !== null && northEdgepoints(c).includes(g))).toBe(true);
    expect(new Set(tiles).size).toBe(4);
    expect(answer(c, 'group')).toEqual({ ok: true });
    expect(c.state.battle.placementButton).toBe(PlacementButton.CLEAR);
    expect(pieceTiles(c, roster)).toEqual(tiles);
  });

  it('picks every piece up under Clear (ClearPlacementsCallback, PlaceMercs)', () => {
    const { c, roster } = placing();
    expect(answer(c, 'spread')).toEqual({ ok: true });
    expect(answer(c, 'clear')).toEqual({ ok: true });
    expect(pieceTiles(c, roster)).toEqual([null, null, null, null]);
    expect(ourSoldiers(c)).toEqual([]);
    expect(c.state.battle.placementButton).toBe(PlacementButton.CLEAR);
  });

  it("refuses Done until everyone is placed, then prepares the loaded sector with the mercs at their pieces' tiles and locates one (EnsureDoneButtonStatus, KillTacticalPlacementGUI)", () => {
    const { c, roster } = placing();
    expect(answer(c, 'done')).toMatchObject({ ok: false, data: { refusal: 'placementIncomplete' } });
    expect(answer(c, 'spread')).toEqual({ ok: true });
    const tiles = pieceTiles(c, roster);
    c.drainEvents();
    expect(answer(c, 'done')).toEqual({ ok: true });
    expect(c.state.battle.prompt).toBeNull();
    expect(enemies(c)).toBe(2);
    expect(ourSoldiers(c).map((s) => s.gridNo)).toEqual(tiles);
    expect(c.drainEvents().find((e) => e.type === 'placementDone')).toMatchObject({ sector: 'B9', located: 0 });
  });

  it.each([
    ['Spread spreads everyone at once', PlacementButton.SPREAD, true],
    ['Group places nobody', PlacementButton.GROUP, false],
  ])(
    'opens with the default button saved from the last placement: %s (gubDefaultButton, InitTacticalPlacementGUI)',
    (_name, button, placed) => {
      const { c } = placing((campaign) => {
        campaign.state.battle.placementButton = button;
      });
      expect(placement(c).pieces.map((p) => p.placed)).toEqual([placed, placed, placed, placed]);
      expect(c.state.battle.placementButton).toBe(button);
    },
  );

  it('plays the same placement when the campaign is saved and restored after every input', async () => {
    await expectReloadsInvisible((mode) => {
      const { c } = placing(() => {}, mode);
      const [first] = northEdgepoints(c);
      answer(c, 'group');
      answer(c, 'place', { soldier: 1, gridNo: first });
      answer(c, 'clear');
      spreadAndPlace(c);
      return c;
    });
  });
});
