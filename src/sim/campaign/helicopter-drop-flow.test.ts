import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type CampaignKit,
  createTestCampaign,
  landFirstSquad,
  ourSoldiers,
  runTheHelicopterDrop,
  runTicks,
  startFirstSquadsDrop,
} from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { NOTHING } from '../../content/items/items.ts';
import { Direction } from '../../content/world/grid.ts';
import { createCampaignSession } from '../../server/campaign-factory.ts';
import type { SimEvent } from '../events.ts';
import { InsertionCode } from '../strategic/forces/constants.ts';
import { CompressMode, EventKind, NUM_SEC_IN_MIN, Warp } from '../strategic/time/constants.ts';
import { addStrategicEvent, deleteStrategicEvent } from '../strategic/time/event-queue.ts';
import { lockPauseState, unLockPauseState, warpGameTime } from '../strategic/time/world-clock.ts';
import { anim } from '../tactical/anim-states.ts';
import { AnimHeight } from '../tactical/animation.ts';
import { eventSoldierGotHit, soldierCollapse } from '../tactical/combat/hit.ts';
import { AimShot } from '../tactical/combat/types.ts';
import { helicopterDropStalled } from '../tactical/helicopter-drop.ts';
import { MercQuote } from '../tactical/narrative/merc-quotes.ts';
import { Team } from '../tactical/soldier.ts';
import { sectorMapOf, type TacticalState } from '../tactical/state.ts';
import { STRATEGIC_OVERHEAD_MS } from '../tactical/turns/turns.ts';
import type { CampaignSim } from './campaign-sim.ts';
import { FIRST_ARRIVAL_MINUTE } from './hiring.ts';
import { UnloadCode } from './sector-flow.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const A9 = { x: 9, y: 1, z: 0 };
const NO_GARRISON = { admins: 0, troops: 0, elites: 0 };
const GARRISON = { admins: 0, troops: 2, elites: 0 };
const LATER_ARRIVAL_MINUTES = 1;
const DROP_TICKS = 40_000;
const NONE_LEFT = 0;
const FRAME_MS = 5;
const LOCK_PAUSE_FOR_A_LINE = 1;

function holdBackArrivals(c: CampaignSim, ids: readonly number[]): void {
  const minute = FIRST_ARRIVAL_MINUTE + LATER_ARRIVAL_MINUTES;
  for (const id of ids) {
    deleteStrategicEvent(c.state.queue, EventKind.DELAYED_HIRING_OF_MERC, id);
    addStrategicEvent(c.state.queue, EventKind.DELAYED_HIRING_OF_MERC, minute, id);
    const m = c.battle?.roster.get(id);
    if (m) m.insertionCode = InsertionCode.NORTH;
  }
}

function arriveLater(c: CampaignSim): void {
  warpGameTime(c.clockContext, LATER_ARRIVAL_MINUTES * NUM_SEC_IN_MIN, Warp.NORMAL);
  c.step();
}

function tactical(c: CampaignSim): TacticalState {
  const t = c.tactical?.state;
  if (!t) throw new Error('no sector');
  return t;
}

function dropEnds(events: readonly SimEvent[]): boolean[] {
  return events.flatMap((e) => (e.type === 'helicopterDropEnded' ? [e.first] : []));
}

describe('the helicopter drop in a campaign', () => {
  it('ends the first run of the game with the turn times synced, the enemies called to the sweet spot, the enemy-presence line and the AI unpaused (Merc_Entering.cc:777)', () => {
    const { campaign: c } = createTestCampaign(kit, { seed: 61, mercs: 2, garrison: GARRISON });
    startFirstSquadsDrop(c);
    const t = c.tactical?.state;
    if (!t) throw new Error('no sector');
    expect(c.drainEvents().filter((e) => e.type === 'mercQuote')).toEqual([]);
    const said: number[] = [];
    const narrative = t.narrative;
    t.narrative = {
      ...narrative,
      sayQuote: (s, quote, delayed) => {
        said.push(quote);
        narrative.sayQuote(s, quote, delayed);
      },
    };
    const drop = t.helicopterDrop;
    expect([drop.running, drop.firstHeliRun, drop.sweetSpot]).toEqual([true, true, sectorMapOf(t).info.northGridNo]);
    t.turn.pauseAllAi = true;
    let endedAt = -1;
    for (let tick = 0; endedAt < 0 && tick < DROP_TICKS; tick++) {
      c.step();
      if (!drop.running) endedAt = t.clockMs - FRAME_MS;
    }
    expect([t.realtimeClock.lastTurnMs, drop.firstHeliRun, t.turn.pauseAllAi]).toEqual([endedAt, false, false]);
    expect(t.perception.publicNoiseGridNo[Team.ENEMY]).toBe(drop.sweetSpot);
    expect(said).toEqual([MercQuote.ENEMY_PRESENCE]);
    expect(dropEnds(c.drainEvents())).toEqual([true]);
  });

  it('tells the run’s start at the north entry with the command that starts it, and each merc it drops on the tick he lands', () => {
    const { campaign: c } = createTestCampaign(kit, { seed: 62, mercs: 2, garrison: NO_GARRISON });
    startFirstSquadsDrop(c);
    const t = tactical(c);
    expect(c.drainEvents().filter((e) => e.type === 'sectorLoaded' || e.type === 'helicopterDropStarted')).toMatchObject([
      { type: 'sectorLoaded' },
      { type: 'helicopterDropStarted', gridNo: sectorMapOf(t).info.northGridNo },
    ]);
    const dropped: { soldier: number; placed: boolean | undefined }[] = [];
    runTicks(c, DROP_TICKS, () => {
      for (const e of c.drainEvents())
        if (e.type === 'mercDropped') dropped.push({ soldier: e.soldier, placed: t.soldiers[e.soldier]?.placed });
      return !t.helicopterDrop.running;
    });
    expect(dropped).toEqual([
      { soldier: 0, placed: true },
      { soldier: 1, placed: true },
    ]);
  });

  it('keeps the world clock still for the whole drop, so no strategic event, an arrival included, can join a running drop', () => {
    const { campaign: c } = createTestCampaign(kit, { seed: 62, mercs: 3, garrison: NO_GARRISON });
    startFirstSquadsDrop(c);
    const seconds = c.state.clock.seconds;
    const ticks = runTicks(c, DROP_TICKS, () => {
      expect(c.state.clock.seconds).toBe(seconds);
      return c.tactical?.state.helicopterDrop.running !== true;
    });
    expect(ticks).toBeGreaterThan(0);
    expect(c.state.clock.paused).toBe(false);
  });

  it('flies a later arrival in the loaded start sector in on a run of his own, which syncs no turn times: the first poll after it runs a real-time turn at once (Merc_Hiring.cc:257, Merc_Entering.cc:780)', () => {
    const { campaign: c, roster } = createTestCampaign(kit, { seed: 63, mercs: 2, garrison: NO_GARRISON });
    holdBackArrivals(c, [1]);
    landFirstSquad(c);
    const later = () => roster.get(1);
    expect(ourSoldiers(c).map((s) => s.id)).toEqual([0]);
    arriveLater(c);
    const drop = tactical(c).helicopterDrop;
    expect([later()?.insertionCode, drop.seats, drop.running, drop.firstHeliRun]).toEqual([InsertionCode.CHOPPER, [1], true, false]);
    const syncedAtTheFirstRun = tactical(c).realtimeClock.lastTurnMs;
    runTheHelicopterDrop(c, DROP_TICKS);
    expect([later()?.insertionCode, later()?.soldier.placed]).toEqual([InsertionCode.NORTH, true]);
    expect(dropEnds(c.drainEvents())).toEqual([true, false]);
    expect(tactical(c).realtimeClock.lastTurnMs).toBe(syncedAtTheFirstRun);
    const end = tactical(c).clockMs;
    runTicks(c, DROP_TICKS, () => tactical(c).realtimeClock.lastTurnMs !== syncedAtTheFirstRun);
    const turnAt = tactical(c).realtimeClock.lastTurnMs;
    expect(turnAt).not.toBe(syncedAtTheFirstRun);
    expect(turnAt - end).toBeLessThanOrEqual(STRATEGIC_OVERHEAD_MS + FRAME_MS);
  });

  it('leaves the map screen for a later arrival in the loaded start sector and starts his run there (Merc_Hiring.cc:269)', () => {
    const { campaign: c } = createTestCampaign(kit, { seed: 67, mercs: 2, garrison: NO_GARRISON });
    holdBackArrivals(c, [1]);
    landFirstSquad(c);
    expect(c.dispatch({ type: 'mapScreen' }).ok).toBe(true);
    expect([c.state.flow, tactical(c).helicopterDrop.running]).toEqual(['strategic', false]);
    arriveLater(c);
    const drop = tactical(c).helicopterDrop;
    expect([c.state.flow, drop.running, drop.seats, drop.doHeliRun]).toEqual(['tactical', true, [1], false]);
  });

  it('stands a hired merc hit in mid-drop up at the end of the hit, as every hire wants to stand from his creation on (Soldier_Control.cc CreateSoldierCommon)', async () => {
    const session = await createCampaignSession(kit.sectors.read, (p) => kit.sectors.worlds.exists(p), 66, { mercs: 1, land: false });
    const c = session.campaign;
    const merc = c.battle?.roster.get(0)?.soldier;
    expect(merc?.desiredHeight).toBe(AnimHeight.STAND);
    const land = { type: 'compressTime', mode: CompressMode.MIN5 };
    await session.prepare(land);
    expect(session.dispatch(land).ok).toBe(true);
    const t = tactical(c);
    const helidrop = anim(t.content, 'HELIDROP');
    runTicks(c, DROP_TICKS, () => merc?.state === helidrop);
    if (!merc) throw new Error('no merc');
    eventSoldierGotHit(t, merc, NOTHING, 1, 1, Direction.SOUTH, 1, null, 0, AimShot.TORSO);
    const hit = merc.state;
    expect(hit).toBe(anim(t.content, 'GENERIC_HIT_CROUCH'));
    runTicks(c, DROP_TICKS, () => merc.state !== hit);
    expect(merc.state).toBe(anim(t.content, 'KNEEL_UP'));
  });

  it('cuts a run flagged on the map screen short when the world unloads: the seat gets the north entry and lands there at the next load (deviation "Helicopter drop cut short")', () => {
    const { campaign: c, roster } = createTestCampaign(kit, { seed: 64, mercs: 2, garrison: NO_GARRISON });
    holdBackArrivals(c, [1]);
    landFirstSquad(c);
    expect(c.dispatch({ type: 'mapScreen' }).ok).toBe(true);
    lockPauseState(c.state.clock, LOCK_PAUSE_FOR_A_LINE);
    arriveLater(c);
    const drop = c.state.sectorFlow.helicopterDrop;
    expect([c.state.flow, drop.doHeliRun, drop.running, drop.seats]).toEqual(['strategic', true, false, [1]]);
    const flow = c.sectors;
    if (!flow) throw new Error('no sector flow');
    flow.handleDefiniteUnloadingOfWorld(UnloadCode.ABOUT_TO_TRASH_WORLD);
    flow.trashWorld();
    expect([drop.doHeliRun, drop.running, drop.seats.length, drop.shadow]).toEqual([false, false, NONE_LEFT, null]);
    expect(roster.get(1)?.insertionCode).toBe(InsertionCode.NORTH);
    unLockPauseState(c.state.clock);
    expect(flow.setCurrentWorldSector(A9)).toBe(true);
    expect(ourSoldiers(c).map((s) => s.id)).toEqual([0, 1]);
    expect(c.tactical?.state.helicopterDrop.running).toBe(false);
  });

  it('refuses every way out of the tactical screen while a run goes on, stalled or not, until skipHelicopterDrop: the drop’s lock takes every key but Esc (Turn_Based_Input.cc:2330)', () => {
    const { campaign: c } = createTestCampaign(kit, { seed: 68, mercs: 2, garrison: NO_GARRISON });
    startFirstSquadsDrop(c);
    runTicks(c, DROP_TICKS, () => ourSoldiers(c).length > 0);
    const merc = ourSoldiers(c)[0]?.id ?? -1;
    const ways = [
      { type: 'mapScreen' },
      { type: 'exitSector', soldier: merc, direction: 'east', who: 'squad' },
      { type: 'enterSector', sector: 'A10' },
      { type: 'move', soldier: merc, to: (tactical(c).soldiers[merc]?.gridNo ?? 0) + 2, mode: 'walk' },
    ];
    for (const cmd of ways) expect(c.dispatch(cmd)).toMatchObject({ ok: false, data: { refusal: 'helicopterDrop' } });
    const t = tactical(c);
    const dropping = t.soldiers[merc];
    if (!dropping) throw new Error('no merc down');
    soldierCollapse(t, dropping);
    runTicks(c, DROP_TICKS, () => helicopterDropStalled(tactical(c)));
    expect(helicopterDropStalled(tactical(c))).toBe(true);
    expect(c.dispatch({ type: 'mapScreen' })).toMatchObject({ ok: false, data: { refusal: 'helicopterDrop' } });
    expect(c.dispatch({ type: 'skipHelicopterDrop' })).toEqual({ ok: true });
    expect(c.dispatch({ type: 'skipHelicopterDrop' })).toMatchObject({ ok: false, data: { refusal: 'noHelicopterDrop' } });
    expect(c.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
  });
});
