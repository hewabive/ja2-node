import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad } from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { strategicIndex } from '../../content/strategic/sector-ids.ts';
import { strategicView } from '../../server/strategic-view.ts';
import type { SimEvent } from '../events.ts';
import { Meanwhile } from '../strategic/ai/constants.ts';
import { Assignment } from '../strategic/forces/constants.ts';
import { SKYRIDER, setUpHelicopterForPlayer } from '../strategic/forces/helicopter.ts';
import { CompressMode, EventKind } from '../strategic/time/constants.ts';
import { addStrategicEventUsingSeconds } from '../strategic/time/event-queue.ts';
import { isTimeBeingCompressed } from '../strategic/time/world-clock.ts';
import { type ProfileProgress, progressFromProfile } from '../tactical/profiles.ts';
import type { CampaignSim } from './campaign-sim.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const A9 = { x: 9, y: 1, z: 0 };
const TIMEOUT_MS = 60_000;

function landedCampaign(): CampaignSim {
  const { campaign: c } = createTestCampaign(kit, { seed: 11, mercs: 3, garrison: { admins: 0, troops: 0, elites: 0 } });
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

describe('the helicopter commands', () => {
  it(
    'boards, flies, bills, lets passengers off while hovering and refuses what the original refuses',
    () => {
      const c = landedCampaign();
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
    },
    TIMEOUT_MS,
  );

  it(
    'grounds the helicopter while Skyrider is owed money',
    () => {
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
    },
    TIMEOUT_MS,
  );
});

describe('the kill-chopper meanwhile', () => {
  it(
    'is pending for the strategic layer only in its own second, as AreInMeanwhile reports it',
    () => {
      const c = landedCampaign();
      const world = c.strategic?.world;
      expect(world?.inMeanwhile()).toBe(false);
      addStrategicEventUsingSeconds(c.state.queue, EventKind.MEANWHILE, c.state.clock.seconds + 60, Meanwhile.KILL_CHOPPER);
      expect(world?.inMeanwhile()).toBe(false);
      addStrategicEventUsingSeconds(c.state.queue, EventKind.MEANWHILE, c.state.clock.seconds, Meanwhile.KILL_CHOPPER);
      expect(world?.inMeanwhile()).toBe(true);
    },
    TIMEOUT_MS,
  );
});
