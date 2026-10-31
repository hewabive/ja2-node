import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type CampaignKit,
  createTestCampaign,
  landFirstSquad,
  ourSoldiers,
  runTicks,
  runUntilIdle,
  walkSquadToEastEdge,
} from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { mainAdvance } from '../../../tests/support/explosives.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { putMercInAsleepState } from '../strategic/economy/rest.ts';
import { handleSoldierDeath } from '../tactical/combat/death.ts';
import { NO_SELECTION } from '../tactical/selection.ts';
import { Personality } from '../tactical/soldier.ts';
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
const A10 = { x: 10, y: 1, z: 0 };
const NO_GARRISON = { admins: 0, troops: 0, elites: 0 };
const SKULL_TICKS = 400;
const FIRST_PROFILE = 4;
const WALK_OFF_TICKS = 2_000;
const LONE_EXIT_TICKS = 1_500;
const LONE_EXIT_TILE = 75 * 160 + 150;

function rosterMerc(roster: Roster, id: number): RosterMerc {
  const merc = roster.get(id);
  if (!merc) throw new Error(`merc ${id} is not on the roster`);
  return merc;
}

function selected(c: CampaignSim): number {
  return c.tactical?.state.turn.selected ?? NO_SELECTION;
}

function draws(c: CampaignSim, act: () => void): number {
  const before = c.state.rng.state();
  act();
  return mainAdvance(before, c.state.rng.state());
}

function makePsycho(roster: Roster, id: number): void {
  const soldier = rosterMerc(roster, id).soldier;
  soldier.profile = FIRST_PROFILE + id;
  soldier.personalityTrait = Personality.PSYCHO;
}

function psychoDraws(seed: number, mercs: number, prepare: (c: CampaignSim, roster: Roster) => void, act: (c: CampaignSim) => void) {
  return [false, true].map((psycho) => {
    const { campaign: c, roster } = createTestCampaign(kit, { seed, mercs, garrison: NO_GARRISON });
    prepare(c, roster);
    if (psycho) for (const m of roster.all()) makePsycho(roster, m.id);
    return draws(c, () => act(c));
  });
}

function leaveStrategically(c: CampaignSim, roster: Roster): void {
  for (const m of roster.all()) m.betweenSectors = true;
  expect(c.sectors?.checkAndHandleUnloadingOfCurrentWorld()).toBe(true);
}

function returnTo(c: CampaignSim, roster: Roster): void {
  for (const m of roster.all()) {
    m.betweenSectors = false;
    m.sector = { ...A9 };
  }
  expect(c.dispatch({ type: 'enterSector', sector: { ...A9 } })).toMatchObject({ ok: true });
}

describe('the selections the server makes when the tactical screen opens', () => {
  it('selects the first merc the helicopter dropped when the first landing ends, forced (Merc_Entering.cc HandleHeliDrop)', () => {
    const [plain, psycho] = psychoDraws(41, 2, () => {}, landFirstSquad);
    expect((psycho ?? 0) - (plain ?? 0)).toBe(1);
    const { campaign: c } = createTestCampaign(kit, { seed: 41, mercs: 2, garrison: NO_GARRISON });
    landFirstSquad(c);
    const [first] = ourSoldiers(c);
    expect([selected(c), c.state.forces.currentSquad]).toEqual([first?.id, 0]);
  });

  it('reselects the selected merc on the return from the map, forced: he wakes and a psycho draws (GameScreen.cc EnterTacticalScreen)', () => {
    const prepare = (c: CampaignSim, roster: Roster) => {
      landFirstSquad(c);
      expect(c.dispatch({ type: 'mapScreen' }).ok).toBe(true);
      const economy = c.economy;
      if (!economy) throw new Error('no economy');
      putMercInAsleepState(economy, rosterMerc(roster, ourSoldiers(c)[0]?.id ?? -1));
    };
    const [plain, psycho] = psychoDraws(42, 2, prepare, (c) => expect(c.dispatch({ type: 'tacticalScreen' })).toEqual({ ok: true }));
    expect([plain, psycho]).toEqual([0, 1]);
    const { campaign: c, roster } = createTestCampaign(kit, { seed: 42, mercs: 2, garrison: NO_GARRISON });
    prepare(c, roster);
    const first = ourSoldiers(c)[0]?.id ?? -1;
    expect(rosterMerc(roster, first).asleep).toBe(true);
    expect(c.dispatch({ type: 'tacticalScreen' })).toEqual({ ok: true });
    expect([selected(c), rosterMerc(roster, first).asleep]).toEqual([first, false]);
  });

  it('selects the first merc who may act after a sector load and again on entry: a psycho draws twice (TacticalScreenLocateToSoldier)', () => {
    const prepare = (c: CampaignSim, roster: Roster) => {
      landFirstSquad(c);
      leaveStrategically(c, roster);
    };
    const [plain, psycho] = psychoDraws(43, 2, prepare, (c) => returnTo(c, c.battle?.roster ?? fail()));
    expect((psycho ?? 0) - (plain ?? 0)).toBe(2);
    const { campaign: c, roster } = createTestCampaign(kit, { seed: 43, mercs: 2, garrison: NO_GARRISON });
    prepare(c, roster);
    returnTo(c, roster);
    expect(selected(c)).toBe(ourSoldiers(c)[0]?.id);
  });

  it('selects in the next sector the merc who was selected when the squad left, not the first one (gPreferredInitialSelectedGuy)', () => {
    const { campaign: c } = createTestCampaign(kit, { seed: 44, garrison: NO_GARRISON });
    landFirstSquad(c);
    walkSquadToEastEdge(c);
    const [first, chosen] = ourSoldiers(c);
    if (!first || !chosen) throw new Error('two mercs');
    expect(c.dispatch({ type: 'select', soldier: chosen.id }).ok).toBe(true);
    expect(c.dispatch({ type: 'exitSector', soldier: first.id, direction: 'east', who: 'squad' }).ok).toBe(true);
    runTicks(c, WALK_OFF_TICKS, () => c.state.worldSector?.x === A10.x);
    expect([c.state.worldSector, selected(c)]).toEqual([A10, chosen.id]);
    expect(c.state.sectorFlow.preferredSelection).toBe(NO_SELECTION);
  });
});

describe('the selections the server makes when a merc dies or leaves', () => {
  it('selects the next merc of the squad after the skull of the selected merc, as his squad removal comes first (Squads.cc UpdateCurrentlySelectedMerc)', () => {
    const { campaign: c } = createTestCampaign(kit, { seed: 45, mercs: 3, garrison: NO_GARRISON });
    landFirstSquad(c);
    const [, chosen, next] = ourSoldiers(c);
    if (!chosen || !next) throw new Error('three mercs');
    expect(c.dispatch({ type: 'select', soldier: chosen.id }).ok).toBe(true);
    const t = c.tactical?.state;
    const dying = t?.soldiers[chosen.id];
    if (!t || !dying) throw new Error('no sector');
    dying.life = 0;
    handleSoldierDeath(t, dying);
    runTicks(c, SKULL_TICKS, () => selected(c) !== dying.id);
    expect(selected(c)).toBe(next.id);
  });

  it('hands the selection of a merc leaving his squad to walk off alone to his next squadmate at once (HandleSoldierLeavingSectorByThemSelf)', () => {
    const { campaign: c, roster } = createTestCampaign(kit, { seed: 46, garrison: NO_GARRISON });
    landFirstSquad(c);
    const [, leaver, next] = ourSoldiers(c);
    if (!leaver || !next) throw new Error('three mercs');
    expect(c.dispatch({ type: 'move', soldier: leaver.id, to: LONE_EXIT_TILE, mode: 'run' }).ok).toBe(true);
    runUntilIdle(c);
    expect(selected(c)).toBe(leaver.id);
    expect(c.dispatch({ type: 'exitSector', soldier: leaver.id, direction: 'east', who: 'merc', load: false }).ok).toBe(true);
    expect(selected(c)).toBe(next.id);
    runTicks(c, LONE_EXIT_TICKS, () => !rosterMerc(roster, leaver.id).soldier.placed && !c.tactical?.state.mercsWaiting);
    expect([rosterMerc(roster, leaver.id).soldier.placed, selected(c)]).toEqual([false, next.id]);
  });

  it('hands the selection of a merc whose group leaves the loaded sector to the next merc of his squad on the tactical screen (RemoveSoldierFromTacticalSector)', () => {
    const { campaign: c, roster } = createTestCampaign(kit, { seed: 48, garrison: NO_GARRISON });
    landFirstSquad(c);
    const [, leaver, next] = ourSoldiers(c);
    if (!leaver || !next) throw new Error('three mercs');
    expect(c.dispatch({ type: 'select', soldier: leaver.id }).ok).toBe(true);
    rosterMerc(roster, leaver.id).betweenSectors = true;
    c.strategic?.mercs.removeFromTacticalSector(leaver.id);
    expect(selected(c)).toBe(next.id);
  });

  it('clears the selection when a merc leaves the loaded sector while the map is up, and the return selects nobody', () => {
    const { campaign: c, roster } = createTestCampaign(kit, { seed: 47, garrison: NO_GARRISON });
    landFirstSquad(c);
    const leaver = ourSoldiers(c).at(-1);
    if (!leaver) throw new Error('no merc');
    expect(c.dispatch({ type: 'mapScreen' }).ok).toBe(true);
    expect(selected(c)).not.toBe(NO_SELECTION);
    rosterMerc(roster, leaver.id).betweenSectors = true;
    c.strategic?.mercs.removeFromTacticalSector(leaver.id);
    expect(selected(c)).toBe(NO_SELECTION);
    expect(c.dispatch({ type: 'tacticalScreen' })).toEqual({ ok: true });
    expect(selected(c)).toBe(NO_SELECTION);
  });
  it('unselects the selected merc dismissed on the map without a successor, and the return to the sector selects nobody (TacticalRemoveSoldier)', () => {
    const { campaign: c } = createTestCampaign(kit, { seed: 49, garrison: NO_GARRISON });
    landFirstSquad(c);
    const first = ourSoldiers(c)[0];
    if (!first) throw new Error('no merc');
    expect(selected(c)).toBe(first.id);
    expect(c.dispatch({ type: 'mapScreen' }).ok).toBe(true);
    expect(c.dispatch({ type: 'dismiss', soldier: first.id }).ok).toBe(true);
    expect(c.dispatch({ type: 'answer', choice: 'here' }).ok).toBe(true);
    expect(selected(c)).toBe(NO_SELECTION);
    expect(c.dispatch({ type: 'tacticalScreen' })).toEqual({ ok: true });
    expect(selected(c)).toBe(NO_SELECTION);
  });
});

function fail(): never {
  throw new Error('no roster');
}
