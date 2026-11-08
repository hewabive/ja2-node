import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { progressFor } from '../../../tests/support/autoresolve.ts';
import { type CampaignKit, createTestCampaign, landFirstSquad } from '../../../tests/support/campaign.ts';
import { spawnSoldier } from '../../../tests/support/combat.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { expectReloadsInvisible, type RunMode } from '../../../tests/support/reload.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { strategicIndex } from '../../content/strategic/sector-ids.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { strategicView } from '../../server/strategic-view.ts';
import type { SimEvent } from '../events.ts';
import { Meanwhile } from '../strategic/ai/constants.ts';
import { Assignment } from '../strategic/forces/constants.ts';
import { SKYRIDER, setUpHelicopterForPlayer } from '../strategic/forces/helicopter.ts';
import { Fact } from '../strategic/narrative/fact-ids.ts';
import { Npc } from '../strategic/narrative/npc-ids.ts';
import { CompressMode, EventKind } from '../strategic/time/constants.ts';
import { addStrategicEventUsingSeconds } from '../strategic/time/event-queue.ts';
import { isTimeBeingCompressed } from '../strategic/time/world-clock.ts';
import { anim } from '../tactical/anim-states.ts';
import { states } from '../tactical/animation.ts';
import { setSoldierPosition } from '../tactical/movement.ts';
import { type ProfileProgress, progressFromProfile } from '../tactical/profiles.ts';
import { removeSoldierFromTacticalSector } from '../tactical/sector-presence.ts';
import { NOWHERE, OKLIFE, type Soldier, Team } from '../tactical/soldier.ts';
import { type TacticalState, whoIsThere } from '../tactical/state.ts';
import { checkForEndOfBattle, enterCombatMode, isTeamActive } from '../tactical/turns/turns.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { contractRefusal } from './contracts/contract-flow.ts';
import { handleMoraleEvent, MoraleEvent } from './morale.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const A9 = { x: 9, y: 1, z: 0 };

function landedCampaign(mode?: RunMode): CampaignSim {
  const { campaign: c } = createTestCampaign(kit, {
    seed: 11,
    mercs: 3,
    garrison: { admins: 0, troops: 0, elites: 0 },
    ...(mode ? { mode } : {}),
  });
  landFirstSquad(c);
  for (let i = 0; i < 10_000 && !c.isIdle(); i++) c.step();
  const ctx = c.strategic;
  if (!ctx) throw new Error('no strategic layer');
  const skyrider = kit.sectors.content.profiles[SKYRIDER];
  c.state.profiles.set(SKYRIDER, skyrider ? progressFromProfile(skyrider) : ({ balance: 0, life: 50 } as unknown as ProfileProgress));
  const a9 = c.state.map.elements[strategicIndex(A9)];
  if (a9) a9.enemyControlled = false;
  setUpHelicopterForPlayer(ctx, A9);
  return c;
}

function compressUntilStop(c: CampaignSim): SimEvent[] {
  const events: SimEvent[] = [];
  expect(c.dispatch({ type: 'compressTime', mode: CompressMode.MIN5 }).ok).toBe(true);
  for (let i = 0; i < 20_000 && isTimeBeingCompressed(c.state.clock); i++) {
    c.step();
    events.push(...c.drainEvents());
  }
  return events;
}

const refusalOf = (r: { readonly data?: unknown }) => (r.data as { readonly refusal?: string } | undefined)?.refusal;

function boardFlyAndLeave(mode?: RunMode): CampaignSim {
  const c = landedCampaign(mode);
  expect(refusalOf(c.dispatch({ type: 'heliRoute', to: 'A10' }))).toBe('mapScreenOnly');
  expect(c.dispatch({ type: 'mapScreen' }).ok).toBe(true);
  c.drainEvents();
  expect(refusalOf(c.dispatch({ type: 'heliRoute', to: 'A10' }))).toBe('emptyHelicopterHint');
  expect(c.drainEvents().map((e) => e.type)).toContain('heliEmptyHint');
  expect(c.dispatch({ type: 'boardVehicle', soldier: 0, vehicle: 'helicopter' })).toMatchObject({ ok: true, data: { seat: 0 } });
  expect(c.dispatch({ type: 'boardVehicle', soldier: 1, vehicle: 'helicopter' })).toMatchObject({ ok: true, data: { seat: 1 } });
  expect(refusalOf(c.dispatch({ type: 'boardVehicle', soldier: 1, vehicle: 'helicopter' }))).toBe('alreadyAboard');
  const view = strategicView(c);
  expect(view?.helicopter).toMatchObject({
    sector: 'A9',
    airborne: false,
    passengers: [0, 1, -1, -1, -1, -1, -1, -1, -1, -1].filter((x) => x >= 0),
    canFly: true,
  });
  expect(view?.mercs.find((m) => m.id === 0)).toMatchObject({ assignment: Assignment.VEHICLE, vehicle: 0 });
  const boarded = c.drainEvents().filter((e) => e.type === 'vehicleBoarded');
  expect(boarded).toHaveLength(2);
  const balance = c.state.finances.balance;
  const route = c.dispatch({ type: 'heliRoute', to: 'A10' });
  expect(route).toMatchObject({ ok: true, data: { path: ['A9', 'A10'], etaMinutes: 10 } });
  const takeOff = c.drainEvents();
  expect(takeOff.filter((e) => e.type === 'skyriderQuote').map((e) => (e.type === 'skyriderQuote' ? e.quote : 0))).toEqual([23, 27]);
  expect(takeOff.some((e) => e.type === 'heliTakeOff')).toBe(true);
  expect(refusalOf(c.dispatch({ type: 'leaveVehicle', soldier: 0 }))).toBe('helicopterInFlight');
  expect(refusalOf(c.dispatch({ type: 'assignSquad', soldier: 0, squad: 'new' }))).toBe('helicopterInFlight');
  const flight = compressUntilStop(c);
  const types = flight.map((e) => e.type);
  expect(types).toContain('heliArrived');
  expect(types).toContain('heliHovering');
  expect(flight.find((e) => e.type === 'heliPaid')).toMatchObject({ amount: 100 });
  expect(c.state.finances.balance).toBe(balance - 100);
  expect(strategicView(c)?.helicopter).toMatchObject({ sector: 'A10', hovering: true, airborne: true });
  const leave = c.dispatch({ type: 'leaveVehicle', soldier: 0 });
  expect(leave.ok).toBe(true);
  const squad = (leave.data as { readonly squad: number }).squad;
  expect(c.strategic?.mercs.get(0)).toMatchObject({ assignment: squad, sector: { x: 10, y: 1, z: 0 } });
  expect(c.drainEvents().some((e) => e.type === 'vehicleLeft')).toBe(true);
  expect(c.dispatch({ type: 'route', soldier: 1, to: 'A9' })).toMatchObject({ ok: true, data: { path: ['A10', 'A9'] } });
  expect(c.dispatch({ type: 'heliCancel' }).ok).toBe(true);
  return c;
}

describe('the helicopter commands', () => {
  it('boards, flies, bills, lets passengers off while hovering and refuses what the original refuses, the same across reloads', async () => {
    await expectReloadsInvisible(boardFlyAndLeave);
  });

  it('grounds the helicopter while Skyrider is owed money', () => {
    const c = landedCampaign();
    c.dispatch({ type: 'mapScreen' });
    c.dispatch({ type: 'boardVehicle', soldier: 0, vehicle: 'helicopter' });
    c.state.finances.balance = 40;
    expect(c.dispatch({ type: 'heliRoute', to: 'A10' }).ok).toBe(true);
    const events = compressUntilStop(c);
    expect(events.find((e) => e.type === 'heliOwed')).toMatchObject({ amount: 60 });
    expect(events.find((e) => e.type === 'passengersDropped')).toMatchObject({ soldiers: [0] });
    expect(strategicView(c)?.helicopter).toMatchObject({ canFly: false, reason: 'skyriderOwed', owed: 60 });
    expect(refusalOf(c.dispatch({ type: 'heliRoute', to: 'A9' }))).toBe('skyriderOwed');
    expect(refusalOf(c.dispatch({ type: 'boardVehicle', soldier: 1, vehicle: 'helicopter' }))).toBe('notAccessible');
  });
});

describe('the helicopter passengers over the loaded sector', () => {
  function passengerState(c: CampaignSim, id: number): readonly unknown[] {
    const t = c.tactical?.state;
    const flying = c.battle?.roster.get(id);
    if (!t || !flying) throw new Error('no loaded sector');
    const s = flying.soldier;
    return [flying.isPassengerOrDriver, s.placed, s.offMap, s.gridNo, t.mercSlots.includes(s), t.soldiers[id] === s];
  }

  it('keep their merc slot when they board on the loaded map, off their tile with no other (Vehicles.cc AddSoldierToVehicle, RemoveSoldierFromGridNo)', () => {
    const c = landedCampaign();
    const boarding = c.battle?.roster.get(0)?.soldier;
    const slots = c.tactical?.state.mercSlots.map((s) => s.id);
    if (!boarding || !slots) throw new Error('no loaded sector');
    const [tile, level] = [boarding.gridNo, boarding.level];
    c.dispatch({ type: 'mapScreen' });
    expect(c.dispatch({ type: 'boardVehicle', soldier: 0, vehicle: 'helicopter' }).ok).toBe(true);
    expect(passengerState(c, 0)).toEqual([true, false, true, NOWHERE, true, true]);
    const t = c.tactical?.state;
    expect(t?.mercSlots.map((s) => s.id)).toEqual(slots);
    if (t) expect(whoIsThere(t, tile, level)).toBeNull();
    expect(c.battle?.roster.inTacticalSector(0)).toBe(true);
  });

  const PASSENGER = 0;
  const WALKERS = [1, 2];
  const DOWN = OKLIFE - 1;
  const ENEMY_ID = 20;
  const MERC_PROFILES = [1, 2, 3];

  function aboveTheBattle(): { readonly c: CampaignSim; readonly t: TacticalState; readonly soldier: (id: number) => Soldier } {
    const c = landedCampaign();
    for (const id of [PASSENGER, ...WALKERS]) {
      const s = c.battle?.roster.get(id)?.soldier;
      const profile = MERC_PROFILES[id];
      if (!s || profile === undefined) continue;
      s.profile = profile;
      c.state.profiles.set(profile, progressFor(profile));
    }
    c.dispatch({ type: 'mapScreen' });
    expect(c.dispatch({ type: 'boardVehicle', soldier: PASSENGER, vehicle: 'helicopter' }).ok).toBe(true);
    expect(c.dispatch({ type: 'tacticalScreen' }).ok).toBe(true);
    const sim = c.tactical;
    if (!sim) throw new Error('no loaded sector');
    spawnSoldier(sim, ENEMY_ID, Team.ENEMY, gridNo(80, 120), Direction.SOUTH);
    sim.state.turn.enemyInSector = true;
    c.drainEvents();
    const soldier = (id: number) => {
      const s = c.battle?.roster.get(id)?.soldier;
      if (!s) throw new Error(`no merc ${id}`);
      return s;
    };
    return { c, t: sim.state, soldier };
  }

  it('keep a lost battle going while one of them is conscious, and are captured with the walkers when the battle is lost with everyone down (CheckForLosingEndOfBattle, Overhead.cc:4959, :5058)', () => {
    const { c, t, soldier } = aboveTheBattle();
    for (const id of WALKERS) soldier(id).life = DOWN;
    expect(checkForEndOfBattle(t)).toBe(false);
    soldier(PASSENGER).life = DOWN;
    expect(checkForEndOfBattle(t)).toBe(true);
    const captured = c.drainEvents().flatMap((e) => (e.type === 'mercCaptured' ? [e.soldier] : []));
    expect(captured).toEqual([PASSENGER, ...WALKERS]);
    expect(c.battle?.roster.get(PASSENGER)?.assignment).toBe(Assignment.ASSIGNMENT_POW);
    expect(isTeamActive(t, Team.OUR)).toBe(true);
    expect(strategicView(c)?.helicopter).toMatchObject({ passengers: [] });
  });

  it("are killed for a lost battle when the walkers are dead, with no corpse, and their death waits for its skull as a walker's does (Overhead.cc:5050, Soldier_Ani.cc:2885, Rotting_Corpses.cc:611)", () => {
    const { t, soldier } = aboveTheBattle();
    for (const id of WALKERS) soldier(id).life = 0;
    soldier(PASSENGER).life = DOWN;
    const corpses = t.corpses.length;
    expect(checkForEndOfBattle(t)).toBe(true);
    expect([soldier(PASSENGER).life, soldier(PASSENGER).dead, t.corpses.length]).toEqual([0, false, corpses]);
    expect(t.pendingSkullReleases.map((r) => r.soldier.id)).toEqual([PASSENGER]);
  });

  it('enter their merc slots with no tile when the sector loads its mercs: a sector load never puts them on the map (Soldier_Add.cc InternalAddSoldierToSector)', () => {
    const c = landedCampaign();
    c.dispatch({ type: 'mapScreen' });
    expect(c.dispatch({ type: 'boardVehicle', soldier: 0, vehicle: 'helicopter' }).ok).toBe(true);
    c.sectors?.updateMercsInSector();
    expect(passengerState(c, 0)).toEqual([true, false, true, NOWHERE, true, true]);
    expect(c.tactical?.state.mercSlots.filter((s) => s.id === 0)).toHaveLength(1);
    expect(c.battle?.roster.inTacticalSector(0)).toBe(true);
    expect(c.battle?.roster.get(1)?.inSector).toBe(true);
  });

  const TIRED = 50;
  const WOUNDED = 50;

  it('are refused sleep while enemies are in the sector below the landed helicopter, as the mercs on the map are (CanCharacterSleep, Assignments.cc:804)', () => {
    const { c, soldier } = aboveTheBattle();
    soldier(PASSENGER).breathMax = TIRED;
    expect(c.dispatch({ type: 'mapScreen' }).ok).toBe(true);
    expect(refusalOf(c.dispatch({ type: 'sleep', soldier: PASSENGER }))).toBe('sectorNotCleared');
  });

  it('are refused the assignments that need the sector clear while enemies are in it (AreAssignmentConditionsMet, Assignments.cc:361)', () => {
    const { c, soldier } = aboveTheBattle();
    soldier(PASSENGER).life = WOUNDED;
    expect(c.dispatch({ type: 'mapScreen' }).ok).toBe(true);
    expect(refusalOf(c.dispatch({ type: 'assign', soldiers: [PASSENGER], to: { kind: 'patient' } }))).toBe('notEligible');
  });

  it('cannot be dismissed while the sector below is in combat (the contract menu, MapScreen.cc:5208)', () => {
    const { c, t } = aboveTheBattle();
    enterCombatMode(t, Team.ENEMY);
    expect(c.dispatch({ type: 'mapScreen' }).ok).toBe(true);
    expect(c.dispatch({ type: 'dismiss', soldier: PASSENGER })).toEqual(contractRefusal('inCombat'));
  });

  it('take a strategic morale event at once while enemies are in the sector, never delayed as for a merc away from it (HandleMoraleEventForSoldier, Morale.cc:344)', () => {
    const { c, soldier } = aboveTheBattle();
    const battle = c.battle;
    if (!battle) throw new Error('no battle flow');
    const before = soldier(PASSENGER).strategicMoraleMod;
    handleMoraleEvent(battle.moraleContext(), null, MoraleEvent.TOWN_LIBERATED, A9);
    expect([soldier(PASSENGER).strategicMoraleMod > before, soldier(PASSENGER).delayedStrategicMoraleMod]).toEqual([true, 0]);
  });

  it('count in the strength that makes a retreat from the sector below a run away, the walkers too weak alone (PlayerStrength, Strategic_Town_Loyalty.cc:1153)', () => {
    const { c, t, soldier } = aboveTheBattle();
    for (const id of WALKERS) soldier(id).life = 1;
    const enemy = t.soldiers[ENEMY_ID];
    if (enemy) Object.assign(enemy, { life: 100, breathMax: 100 });
    Object.assign(soldier(PASSENGER), { life: 100, breathMax: 100 });
    const before = soldier(PASSENGER).strategicMoraleMod;
    c.sectors?.handleLoyaltyImplicationsOfMercRetreat(true, A9);
    expect(soldier(PASSENGER).strategicMoraleMod).toBeLessThan(before);
  });

  const NPC_ID = 120;
  const OUTDOORS = gridNo(80, 120);
  const INDOORS = gridNo(81, 120);
  const NPC_ROOM = 7;

  it('stand in no room: an NPC outdoors has a player in his room with only them in the sector, one in a room has none (PCInSameRoom, Quests.cc:277; deviation, the original reads gubWorldRoomInfo at NOWHERE, past the map)', () => {
    const { c, t, soldier } = aboveTheBattle();
    for (const id of WALKERS) {
      removeSoldierFromTacticalSector(t, soldier(id));
    }
    const sim = c.tactical;
    if (!sim) throw new Error('no loaded sector');
    const npc = spawnSoldier(sim, NPC_ID, Team.CIV, OUTDOORS, Direction.SOUTH, { profile: Npc.ANGEL });
    t.world.level.rooms[INDOORS] = NPC_ROOM;
    expect(c.narrative.checkFact(Fact.PLAYER_IN_SAME_ROOM, Npc.ANGEL)).toBe(true);
    setSoldierPosition(t, npc, INDOORS);
    expect(c.narrative.checkFact(Fact.PLAYER_IN_SAME_ROOM, Npc.ANGEL)).toBe(false);
  });

  it('fall asleep and wake up with the animations of a merc in the sector (PutMercInAsleepState, PutMercInAwakeState, Assignments.cc:6230, :6264)', () => {
    const c = landedCampaign();
    c.dispatch({ type: 'mapScreen' });
    expect(c.dispatch({ type: 'boardVehicle', soldier: PASSENGER, vehicle: 'helicopter' }).ok).toBe(true);
    const flying = () => {
      const s = c.battle?.roster.get(PASSENGER)?.soldier;
      if (!s) throw new Error('no passenger');
      return s;
    };
    const content = c.tactical?.state.content;
    if (!content) throw new Error('no loaded sector');
    flying().breathMax = TIRED;
    expect(c.dispatch({ type: 'sleep', soldier: PASSENGER }).ok).toBe(true);
    expect(flying().state).toBe(anim(content, 'SLEEPING'));
    expect(c.dispatch({ type: 'wake', soldier: PASSENGER }).ok).toBe(true);
    expect(flying().state).toBe(states(content.animations).STANDING);
  });
});

describe('the kill-chopper meanwhile', () => {
  it('is pending for the strategic layer only in its own second, as AreInMeanwhile reports it', () => {
    const c = landedCampaign();
    const world = c.strategic?.world;
    expect(world?.inMeanwhile()).toBe(false);
    addStrategicEventUsingSeconds(c.state.queue, EventKind.MEANWHILE, c.state.clock.seconds + 60, Meanwhile.KILL_CHOPPER);
    expect(world?.inMeanwhile()).toBe(false);
    addStrategicEventUsingSeconds(c.state.queue, EventKind.MEANWHILE, c.state.clock.seconds, Meanwhile.KILL_CHOPPER);
    expect(world?.inMeanwhile()).toBe(true);
  });
});
