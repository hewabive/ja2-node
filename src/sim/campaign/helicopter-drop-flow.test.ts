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
import { warpGameTime } from '../strategic/time/world-clock.ts';
import { anim } from '../tactical/anim-states.ts';
import { AnimHeight } from '../tactical/animation.ts';
import { eventSoldierGotHit } from '../tactical/combat/hit.ts';
import { AimShot } from '../tactical/combat/types.ts';
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

  it('cuts a running drop short when the world is unloaded: the seats still in the helicopter get the north entry and land there at the next load (deviation "Helicopter drop cut short")', () => {
    const { campaign: c, roster } = createTestCampaign(kit, { seed: 64, mercs: 3, garrison: NO_GARRISON });
    startFirstSquadsDrop(c);
    runTicks(c, DROP_TICKS, () => ourSoldiers(c).length > 0);
    const flow = c.sectors;
    const drop = c.state.sectorFlow.helicopterDrop;
    if (!flow) throw new Error('no sector flow');
    expect([drop.curDrop, drop.seats.length]).toEqual([1, 3]);
    flow.handleDefiniteUnloadingOfWorld(UnloadCode.ABOUT_TO_TRASH_WORLD);
    flow.trashWorld();
    expect([drop.running, drop.seats.length, drop.shadow, drop.strandedShadows.length]).toEqual([false, NONE_LEFT, null, NONE_LEFT]);
    expect([1, 2].map((id) => roster.get(id)?.insertionCode)).toEqual([InsertionCode.NORTH, InsertionCode.NORTH]);
    expect(flow.setCurrentWorldSector(A9)).toBe(true);
    expect(ourSoldiers(c).map((s) => s.id)).toEqual([0, 1, 2]);
    expect(c.tactical?.state.helicopterDrop.running).toBe(false);
  });
});
