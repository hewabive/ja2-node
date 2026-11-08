import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type CampaignKit,
  createTestCampaign,
  dropFirstSquad,
  eastEdgeTile,
  landFirstSquad,
  ourSoldiers,
  runTheHelicopterDrop,
  runTicks,
  runUntilIdle,
  startFirstSquadsDrop,
  walkSquadToEastEdge,
} from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent, kit as medicalKit } from '../../../tests/support/economy.ts';
import { mainAdvance } from '../../../tests/support/explosives.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { putMercInAsleepState } from '../strategic/economy/rest.ts';
import { setSoldierAssignmentHospital } from '../strategic/economy/set-assignment.ts';
import { handleSoldierDeath } from '../tactical/combat/death.ts';
import { InvSlot } from '../tactical/inventory.ts';
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
const WOUND = 10;

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
  it('selects the first seat, forced, when the Esc key lands the drop at once (Merc_Entering.cc HandleHeliDrop)', () => {
    const [plain, psycho] = psychoDraws(41, 2, () => {}, landFirstSquad);
    expect((psycho ?? 0) - (plain ?? 0)).toBe(1);
    const { campaign: c } = createTestCampaign(kit, { seed: 41, mercs: 2, garrison: NO_GARRISON });
    landFirstSquad(c);
    const [first] = ourSoldiers(c);
    expect([selected(c), c.state.forces.currentSquad]).toEqual([first?.id, 0]);
  });

  it('makes the first merc down’s squad current, forced, and selects the first seat, forced, as the helicopter leaves (Merc_Entering.cc:605, :759)', () => {
    const [plain, psycho] = psychoDraws(41, 2, () => {}, dropFirstSquad);
    expect((psycho ?? 0) - (plain ?? 0)).toBe(2);
    const { campaign: c } = createTestCampaign(kit, { seed: 41, mercs: 2, garrison: NO_GARRISON });
    startFirstSquadsDrop(c);
    const firstDown = runTicks(c, 40_000, () => ourSoldiers(c).length > 0);
    const [first] = ourSoldiers(c);
    expect([firstDown, selected(c), c.state.forces.currentSquad]).toEqual([1912, first?.id, 0]);
    expect(c.tactical?.state.helicopterDrop.running).toBe(true);
    runTheHelicopterDrop(c);
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

  it('names the merc an entry selects for the view to locate; the first arrival finds nobody on the map yet (gfGameScreenLocateToSoldier)', () => {
    const { campaign: c } = createTestCampaign(kit, { seed: 44, garrison: NO_GARRISON });
    const entries = () => c.drainEvents().filter((e) => e.type === 'sectorLoaded');
    landFirstSquad(c);
    const [arrival] = entries();
    expect(arrival).toMatchObject({ sector: 'A9' });
    expect(arrival && 'located' in arrival).toBe(false);
    walkSquadToEastEdge(c);
    const [first, chosen] = ourSoldiers(c);
    if (!first || !chosen) throw new Error('two mercs');
    expect(c.dispatch({ type: 'select', soldier: chosen.id }).ok).toBe(true);
    expect(c.dispatch({ type: 'exitSector', soldier: first.id, direction: 'east', who: 'squad' }).ok).toBe(true);
    runTicks(c, WALK_OFF_TICKS, () => c.state.worldSector?.x === A10.x);
    expect(entries()).toMatchObject([{ sector: 'A10', located: chosen.id }]);
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

function selectedSquad(c: CampaignSim): [number, number] {
  return [selected(c), c.state.forces.currentSquad];
}

function assignSquad(c: CampaignSim, soldier: number, squad: number | 'new'): void {
  expect(c.dispatch({ type: 'assignSquad', soldier, squad })).toMatchObject({ ok: true });
}

function leaveWhileOnTheMap(c: CampaignSim, roster: Roster, ids: readonly number[]): void {
  for (const id of ids) {
    rosterMerc(roster, id).betweenSectors = true;
    c.strategic?.mercs.removeFromTacticalSector(id);
  }
}

function firstOfSquad(c: CampaignSim, squad: number): number | undefined {
  return c.state.forces.squads[squad]?.[0];
}

function soldierIds(c: CampaignSim): number[] {
  return ourSoldiers(c).map((s) => s.id);
}

describe('the current squad the server keeps (Squads.cc SetCurrentSquad)', () => {
  it('makes a squad on the map current with selectSquad and selects its first merc, forced: a psycho draws (ChangeCurrentSquad)', () => {
    const prepare = (c: CampaignSim) => {
      landFirstSquad(c);
      assignSquad(c, soldierIds(c)[2] ?? -1, 'new');
    };
    const [plain, psycho] = psychoDraws(50, 3, prepare, (c) => expect(c.dispatch({ type: 'selectSquad', squad: 1 })).toEqual({ ok: true }));
    expect((psycho ?? 0) - (plain ?? 0)).toBe(1);
    const { campaign: c } = createTestCampaign(kit, { seed: 50, mercs: 3, garrison: NO_GARRISON });
    prepare(c);
    const third = soldierIds(c)[2];
    expect(selectedSquad(c)).toEqual([soldierIds(c)[0], 0]);
    expect(c.dispatch({ type: 'selectSquad', squad: 1 })).toEqual({ ok: true });
    expect(selectedSquad(c)).toEqual([third, 1]);
  });

  it('refuses selectSquad for a squad off the map, a bad squad and on the map screen, and changes nothing for the current squad', () => {
    const { campaign: c } = createTestCampaign(kit, { seed: 51, mercs: 2, garrison: NO_GARRISON });
    landFirstSquad(c);
    const before = c.state.rng.state();
    expect(c.dispatch({ type: 'selectSquad', squad: 0 })).toEqual({ ok: true });
    expect(mainAdvance(before, c.state.rng.state())).toBe(0);
    expect(c.dispatch({ type: 'selectSquad', squad: 3 })).toMatchObject({ ok: false, data: { refusal: 'squadNotHere' } });
    expect(c.dispatch({ type: 'selectSquad', squad: 20 })).toMatchObject({ ok: false, data: { refusal: 'badSquad' } });
    expect(c.dispatch({ type: 'mapScreen' }).ok).toBe(true);
    expect(c.dispatch({ type: 'selectSquad', squad: 0 })).toMatchObject({ ok: false, data: { refusal: 'notInTactical' } });
    expect(selectedSquad(c)).toEqual([soldierIds(c)[0], 0]);
  });

  it('selects the first merc of the squad the selected merc joins when his old squad, the current one, is left empty, forced (AddCharacterToSquad)', () => {
    const prepare = (c: CampaignSim) => {
      landFirstSquad(c);
      assignSquad(c, soldierIds(c)[1] ?? -1, 'new');
    };
    const join = (c: CampaignSim) => assignSquad(c, soldierIds(c)[0] ?? -1, 1);
    const [plain, psycho] = psychoDraws(52, 2, prepare, join);
    expect((psycho ?? 0) - (plain ?? 0)).toBe(1);
    const { campaign: c } = createTestCampaign(kit, { seed: 52, mercs: 2, garrison: NO_GARRISON });
    prepare(c);
    const [first, second] = soldierIds(c);
    expect(selectedSquad(c)).toEqual([first, 0]);
    join(c);
    expect(selectedSquad(c)).toEqual([second, 1]);
  });

  it('makes the first squad on the map current on the return from the map when the current squad left it, selecting its first merc twice (SetDefaultSquadOnSectorEntry)', () => {
    const prepare = (c: CampaignSim, roster: Roster) => {
      landFirstSquad(c);
      const [first, second, third, fourth] = soldierIds(c);
      assignSquad(c, third ?? -1, 'new');
      assignSquad(c, fourth ?? -1, 1);
      expect(c.dispatch({ type: 'mapScreen' }).ok).toBe(true);
      leaveWhileOnTheMap(c, roster, [first ?? -1, second ?? -1]);
    };
    const enter = (c: CampaignSim) => expect(c.dispatch({ type: 'tacticalScreen' })).toEqual({ ok: true });
    const [plain, psycho] = psychoDraws(53, 4, prepare, enter);
    expect((psycho ?? 0) - (plain ?? 0)).toBe(2);
    const { campaign: c, roster } = createTestCampaign(kit, { seed: 53, mercs: 4, garrison: NO_GARRISON });
    prepare(c, roster);
    expect(selectedSquad(c)).toEqual([NO_SELECTION, 0]);
    enter(c);
    expect(selectedSquad(c)).toEqual([firstOfSquad(c, 1), 1]);
  });

  it('makes the first squad left on the map current after a squad walks off without a load while nobody is selected, forced (AllMercsHaveWalkedOffSector)', () => {
    const prepare = (c: CampaignSim, roster: Roster) => {
      landFirstSquad(c);
      const [first, second, third, fourth] = soldierIds(c);
      assignSquad(c, third ?? -1, 'new');
      assignSquad(c, fourth ?? -1, 'new');
      for (const id of [first, second])
        expect(c.dispatch({ type: 'move', soldier: id, to: eastEdgeTile(id ?? 0), mode: 'run' })).toMatchObject({ ok: true });
      runUntilIdle(c);
      expect(c.dispatch({ type: 'mapScreen' }).ok).toBe(true);
      leaveWhileOnTheMap(c, roster, [fourth ?? -1]);
      expect(c.dispatch({ type: 'tacticalScreen' })).toEqual({ ok: true });
      expect(selectedSquad(c)).toEqual([NO_SELECTION, 0]);
    };
    const walkOff = (c: CampaignSim) => {
      const first = soldierIds(c)[0] ?? -1;
      expect(c.dispatch({ type: 'exitSector', soldier: first, direction: 'east', who: 'squad', load: false })).toMatchObject({ ok: true });
      runTicks(c, WALK_OFF_TICKS, () => c.state.forces.currentSquad !== 0);
    };
    const [plain, psycho] = psychoDraws(54, 4, prepare, walkOff);
    expect((psycho ?? 0) - (plain ?? 0)).toBe(1);
    const { campaign: c, roster } = createTestCampaign(kit, { seed: 54, mercs: 4, garrison: NO_GARRISON });
    prepare(c, roster);
    walkOff(c);
    expect(selectedSquad(c)).toEqual([firstOfSquad(c, 1), 1]);
  });
});

describe('the current squad after a hospital assignment (Assignments.cc SetSoldierAssignmentHospital, RebuildCurrentSquad)', () => {
  it('makes the first squad on the map current when the patient was the last of the current squad and selects its first merc, forced', () => {
    const prepare = (c: CampaignSim, roster: Roster) => {
      landFirstSquad(c);
      const [first, second] = soldierIds(c);
      assignSquad(c, second ?? -1, 'new');
      rosterMerc(roster, first ?? -1).soldier.life -= WOUND;
    };
    const admit = (c: CampaignSim, roster: Roster) => {
      const economy = c.economy;
      if (!economy) throw new Error('no economy');
      expect(setSoldierAssignmentHospital(economy, rosterMerc(roster, soldierIds(c)[0] ?? -1))).toBe(true);
    };
    const [plain, psycho] = psychoDraws(57, 2, prepare, (c) => admit(c, c.battle?.roster ?? fail()));
    expect((psycho ?? 0) - (plain ?? 0)).toBe(1);
    const { campaign: c, roster } = createTestCampaign(kit, { seed: 57, mercs: 2, garrison: NO_GARRISON });
    prepare(c, roster);
    const second = soldierIds(c)[1];
    admit(c, roster);
    expect(selectedSquad(c)).toEqual([second, 1]);
  });
});

describe('the current squad as the tactical assignment menu closes (Assignments.cc CreateDestroyAssignmentPopUpBoxes, RebuildCurrentSquad)', () => {
  function withDoctorAlone(c: CampaignSim, roster: Roster): void {
    landFirstSquad(c);
    const [first, second] = soldierIds(c);
    assignSquad(c, second ?? -1, 'new');
    rosterMerc(roster, first ?? -1).soldier.inv[InvSlot.BIGPOCK4] = medicalKit(kit.economy.items, 'MEDICKIT', [100]);
  }

  function assignDoctor(c: CampaignSim): void {
    expect(c.dispatch({ type: 'assign', soldiers: [soldierIds(c)[0]], to: { kind: 'doctor' } })).toMatchObject({ ok: true });
  }

  it('makes the first squad on the map current when the assignment takes the last merc of the current squad', () => {
    const { campaign: c, roster } = createTestCampaign(kit, { seed: 58, mercs: 2, garrison: NO_GARRISON });
    withDoctorAlone(c, roster);
    const [first, second] = soldierIds(c);
    expect(selectedSquad(c)).toEqual([first, 0]);
    assignDoctor(c);
    expect(selectedSquad(c)).toEqual([second, 1]);
  });

  it('makes the first squad on the map current after a squad change while the current squad is off the map', () => {
    const { campaign: c, roster } = createTestCampaign(kit, { seed: 59, mercs: 3, garrison: NO_GARRISON });
    landFirstSquad(c);
    const [first, second, third] = soldierIds(c);
    assignSquad(c, third ?? -1, 'new');
    rosterMerc(roster, third ?? -1).betweenSectors = true;
    c.strategic?.mercs.removeFromTacticalSector(third ?? -1);
    c.state.forces.currentSquad = 1;
    assignSquad(c, second ?? -1, 'new');
    expect(selectedSquad(c)).toEqual([first, 0]);
  });

  it('leaves the current squad as it is on the map screen, where SetCurrentSquad returns at once', () => {
    const { campaign: c, roster } = createTestCampaign(kit, { seed: 58, mercs: 2, garrison: NO_GARRISON });
    withDoctorAlone(c, roster);
    expect(c.dispatch({ type: 'mapScreen' }).ok).toBe(true);
    assignDoctor(c);
    expect(c.state.forces.currentSquad).toBe(0);
  });
});

describe('the selections when a native save resumes in tactical (SaveLoadGame.cc LoadSavedGame, SaveLoadScreen.cc SetSaveLoadExitScreen)', () => {
  it('selects the saved selected merc again, forced, then enters the tactical screen, which selects him again: he wakes and a psycho draws twice', () => {
    const prepare = (c: CampaignSim, roster: Roster) => {
      landFirstSquad(c);
      const economy = c.economy;
      if (!economy) throw new Error('no economy');
      putMercInAsleepState(economy, rosterMerc(roster, ourSoldiers(c)[0]?.id ?? -1));
    };
    const adopt = (c: CampaignSim) => c.sectors?.adoptLoadedSector([]);
    const [plain, psycho] = psychoDraws(55, 2, prepare, adopt);
    expect((psycho ?? 0) - (plain ?? 0)).toBe(2);
    const { campaign: c, roster } = createTestCampaign(kit, { seed: 55, mercs: 2, garrison: NO_GARRISON });
    prepare(c, roster);
    const first = ourSoldiers(c)[0]?.id ?? -1;
    adopt(c);
    expect([selected(c), rosterMerc(roster, first).asleep, c.state.forces.currentSquad]).toEqual([first, false, 0]);
  });

  it('makes no selection when the save resumes on the map screen: a psycho draws nothing', () => {
    const { campaign: c, roster } = createTestCampaign(kit, { seed: 56, mercs: 2, garrison: NO_GARRISON });
    landFirstSquad(c);
    expect(c.dispatch({ type: 'mapScreen' }).ok).toBe(true);
    for (const m of roster.all()) makePsycho(roster, m.id);
    expect(draws(c, () => c.sectors?.adoptLoadedSector([]))).toBe(0);
  });
});

function fail(): never {
  throw new Error('no roster');
}
