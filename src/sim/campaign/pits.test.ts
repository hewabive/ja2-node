import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad, ourSoldiers, runTicks } from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { objectOf } from '../../../tests/support/explosives.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { gridNo } from '../../content/world/grid.ts';
import { InsertionCode } from '../strategic/forces/constants.ts';
import { getGroup } from '../strategic/forces/groups.ts';
import { Detonator, ItemAction, setActionValue, setDetonator } from '../tactical/bombs/bomb-object.ts';
import type { TacticalState } from '../tactical/state.ts';
import { addItemToPool, Visibility, WorldItemFlags } from '../tactical/world-items.ts';
import type { CampaignSim } from './campaign-sim.ts';
import type { Roster, RosterMerc } from './roster.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const A9 = { x: 9, y: 1, z: 0 };
const A9_BASEMENT = { x: 9, y: 1, z: 1 };
const NO_GARRISON = { admins: 0, troops: 0, elites: 0 };
const PIT = gridNo(77, 70);
const FALL_TICKS = 3_000;
const BEYOND_ANY_DETECTION = 20;

function tactical(c: CampaignSim): TacticalState {
  const t = c.tactical?.state;
  if (!t) throw new Error('no sector loaded');
  return t;
}

function rosterMerc(roster: Roster, id: number): RosterMerc {
  const merc = roster.get(id);
  if (!merc) throw new Error(`merc ${id} is not on the roster`);
  return merc;
}

function placePit(t: TacticalState): void {
  const o = objectOf(t, 'ACTION_ITEM');
  setDetonator(o, Detonator.PRESSURE);
  setActionValue(o, ItemAction.SMALL_PIT);
  o.trap = BEYOND_ANY_DETECTION;
  if (!addItemToPool(t, PIT, o, Visibility.BURIED, 0, WorldItemFlags.ARMED_BOMB)) throw new Error('cannot place the pit');
}

describe('a merc who falls into a pit (Pits.cc HandleFallIntoPitFromAnimation)', () => {
  it('goes to the sector below, to come in at the pit centre, on a squad of his own whose group stands there, and his squadmates stay', () => {
    const { campaign: c, roster } = createTestCampaign(kit, { seed: 61, garrison: NO_GARRISON });
    landFirstSquad(c);
    const [faller, next] = ourSoldiers(c);
    if (!faller || !next) throw new Error('two mercs');
    expect(tactical(c).turn.selected).toBe(faller.id);
    placePit(tactical(c));
    expect(c.dispatch({ type: 'move', soldier: faller.id, to: PIT, mode: 'walk' }).ok).toBe(true);
    runTicks(c, FALL_TICKS, () => !rosterMerc(roster, faller.id).soldier.placed);
    const fallen = rosterMerc(roster, faller.id);
    const stayed = rosterMerc(roster, next.id);
    expect([fallen.sector, fallen.insertionCode, fallen.soldier.insertionData]).toEqual([A9_BASEMENT, InsertionCode.GRIDNO, PIT]);
    expect(fallen.assignment).not.toBe(stayed.assignment);
    const strategic = c.strategic;
    if (!strategic) throw new Error('no strategic layer');
    expect(getGroup(strategic, fallen.groupId)?.sector).toEqual(A9_BASEMENT);
    expect([stayed.sector, stayed.soldier.placed, getGroup(strategic, stayed.groupId)?.sector]).toEqual([A9, true, A9]);
    expect(tactical(c).turn.selected).toBe(next.id);
  });
});
