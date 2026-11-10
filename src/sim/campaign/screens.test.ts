import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignKit, createTestCampaign, landFirstSquad, ourSoldiers } from '../../../tests/support/campaign.ts';
import { loadEconomyTestContent } from '../../../tests/support/economy.ts';
import { loadArmyTestContent } from '../../../tests/support/queen.ts';
import { loadStubSectorKit } from '../../../tests/support/sectors.ts';
import { advance } from '../advance.ts';
import { CompressMode } from '../strategic/time/constants.ts';
import { CompressionStop, lockPauseState, pauseGame } from '../strategic/time/world-clock.ts';
import type { CampaignSim } from './campaign-sim.ts';

let kit: CampaignKit;

beforeAll(async () => {
  const [sectors, economy, army] = await Promise.all([loadStubSectorKit(), loadEconomyTestContent(), loadArmyTestContent()]);
  kit = { sectors, economy, army };
});

afterAll(async () => {
  await kit.sectors.dispose();
});

const ONE_HOUR = 3600;
const ONE_REAL_SECOND_OF_TICKS = 200;
const TEN_REAL_SECONDS_OF_TICKS = 10 * ONE_REAL_SECOND_OF_TICKS;
const SIX_REAL_SECONDS = 6;
const LOCK_PAUSE_MEANWHILE = 6;
const LOCK_PAUSE_MERC_TALKING = 15;
const A9 = { x: 9, y: 1, z: 0 };

function landedWithRoster(troops: number) {
  const created = createTestCampaign(kit, { seed: 8, mercs: 2, garrison: { admins: 0, troops, elites: 0 } });
  landFirstSquad(created.campaign);
  return created;
}

function landed(troops: number): CampaignSim {
  return landedWithRoster(troops).campaign;
}

function onTheMapWithA9Unloaded(): CampaignSim {
  const { campaign: c, roster } = landedWithRoster(0);
  expect(c.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
  for (const m of roster.all()) m.betweenSectors = true;
  expect(c.sectors?.checkAndHandleUnloadingOfCurrentWorld()).toBe(true);
  for (const m of roster.all()) m.betweenSectors = false;
  return c;
}

function worldSecondsOver(c: CampaignSim, ticks: number): number {
  const start = c.state.clock.seconds;
  for (let k = 0; k < ticks; k++) c.step();
  return c.state.clock.seconds - start;
}

const MAP_MODES = [
  { name: 'X0', set: [] as const },
  { name: 'stopped 30-minute mode', set: [{ type: 'compressTime', mode: CompressMode.MIN30 }, { type: 'stopTime' }] },
  { name: 'running 30-minute mode', set: [{ type: 'compressTime', mode: CompressMode.MIN30 }] },
] as const;

describe('map and tactical screens', () => {
  it('compresses time only on the map and never with enemies in the loaded sector', () => {
    const c = landed(3);
    expect(c.state.flow).toBe('tactical');
    expect(advance(c, { compressionStopped: true })).toMatchObject({
      reason: 'refused',
      refusal: 'time compression works on the strategic map only',
    });
    expect(c.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    expect(c.state.flow).toBe('strategic');
    expect(c.tactical).not.toBeNull();
    expect(c.dispatch({ type: 'compressTime', mode: CompressMode.MIN30 })).toEqual({
      ok: false,
      reason: 'enemies are present in the loaded sector',
      data: { refusal: 'enemiesPresent' },
    });
    expect(c.dispatch({ type: 'tacticalScreen' })).toEqual({ ok: true });
    expect(c.state.flow).toBe('tactical');
  });

  it('refuses tactical orders on the map screen, where the loaded sector does not run, and takes them back on the tactical screen', () => {
    const c = landed(0);
    const [merc, patient] = ourSoldiers(c);
    if (!merc || !patient) throw new Error('no squad');
    const turn = { type: 'turn', soldier: merc.id, direction: (merc.direction + 4) % 8 };
    expect(c.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    const offScreen = [
      turn,
      { type: 'move', soldier: merc.id, to: merc.gridNo + 1 },
      { type: 'endTurn' },
      { type: 'bandage', soldier: merc.id, target: patient.id },
      { type: 'talk', soldier: merc.id },
    ];
    for (const order of offScreen) {
      expect(c.dispatch(order)).toEqual({
        ok: false,
        reason: `${order.type} is given on the tactical screen only`,
        data: { refusal: 'notInTactical' },
      });
    }
    expect(c.dispatch({ type: 'tacticalScreen' })).toEqual({ ok: true });
    expect(c.dispatch(turn)).toMatchObject({ ok: true });
  });

  it('selects the loaded sector as the map screen opens, whatever was selected before (MapScreen.cc MapScreenHandle)', () => {
    const c = landed(0);
    c.state.map.selectedSector = { x: 5, y: 5, z: 0 };
    expect(c.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    expect(c.state.map.selectedSector).toEqual(A9);
  });

  it('enters the loaded sector from the map screen into the tactical screen', () => {
    const c = landed(0);
    expect(c.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    expect(c.dispatch({ type: 'compressTime', mode: CompressMode.MIN30 })).toEqual({ ok: true });
    expect(c.dispatch({ type: 'enterSector', sector: 'A9' })).toMatchObject({ ok: true, data: { sector: 'A9' } });
    expect(c.state.flow).toBe('tactical');
    expect(c.state.clock.mode).toBe(CompressMode.X1);
  });

  it('lets a cleared sector wait on the map while the tactical world stays frozen', () => {
    const c = landed(0);
    const tacticalClock = c.tactical?.state.clockMs;
    expect(c.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    const start = c.state.clock.seconds;
    const report = advance(c, { worldSeconds: ONE_HOUR, mode: CompressMode.MIN60 });
    expect(report.reason).toBe('worldTime');
    expect(c.state.clock.seconds - start).toBeGreaterThanOrEqual(ONE_HOUR);
    expect(c.tactical?.state.clockMs).toBe(tacticalClock);
    expect(c.dispatch({ type: 'tacticalScreen' })).toEqual({ ok: true });
    expect(c.state.clock.mode).toBe(CompressMode.X1);
  });

  it('runs the world clock at once when the map hands back to the loaded sector', () => {
    const c = landed(0);
    expect(c.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    for (let k = 0; k < TEN_REAL_SECONDS_OF_TICKS; k++) c.step();
    expect(c.dispatch({ type: 'tacticalScreen' })).toEqual({ ok: true });
    const start = c.state.clock.seconds;
    for (let k = 0; k < ONE_REAL_SECOND_OF_TICKS; k++) c.step();
    expect(c.state.clock.seconds - start).toBe(1);
  });
});

describe('leaving the map screen', () => {
  function pausedByCompressionNoLongerAllowed(c: CampaignSim): void {
    expect(c.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    expect(c.dispatch({ type: 'compressTime', mode: CompressMode.MIN30 })).toEqual({ ok: true });
    const turn = c.tactical?.state.turn;
    if (!turn) throw new Error('no sector');
    turn.enemyInSector = true;
    c.step();
    turn.enemyInSector = false;
    expect([c.state.clock.compressionOn, c.state.clock.paused]).toEqual([true, true]);
  }

  it('lifts the automatic pause the map leaves when it hands back to the loaded sector, so the world clock and the real-time turns run there (MapScreen.cc EndMapScreen)', () => {
    const c = landed(0);
    pausedByCompressionNoLongerAllowed(c);
    expect(c.dispatch({ type: 'tacticalScreen' })).toEqual({ ok: true });
    expect([c.state.clock.mode, c.state.clock.paused, c.state.clock.pauseLocked]).toEqual([CompressMode.X1, false, false]);
    const seconds = c.state.clock.seconds;
    const lastTurnMs = c.tactical?.state.realtimeClock.lastTurnMs ?? 0;
    for (let k = 0; k < SIX_REAL_SECONDS * ONE_REAL_SECOND_OF_TICKS; k++) c.step();
    expect(c.state.clock.seconds - seconds).toBe(SIX_REAL_SECONDS);
    expect(c.tactical?.state.realtimeClock.lastTurnMs).toBeGreaterThan(lastTurnMs);
  });

  it("keeps the player's own pause on the way back to the loaded sector (gfPauseDueToPlayerGamePause)", () => {
    const c = landed(0);
    expect(c.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    const clock = c.state.clock;
    pauseGame(clock);
    clock.playerPause = true;
    expect(c.dispatch({ type: 'tacticalScreen' })).toEqual({ ok: true });
    expect([c.state.clock.paused, c.state.clock.pauseLocked]).toEqual([true, false]);
  });

  it("lifts only the pause lock, not the player's pause, when the pre-battle panel hands the map back to the loaded sector past the exit checks", () => {
    const c = landed(0);
    expect(c.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    const clock = c.state.clock;
    pauseGame(clock);
    clock.playerPause = true;
    lockPauseState(clock, LOCK_PAUSE_MERC_TALKING);
    expect(c.dispatch({ type: 'tacticalScreen' })).toMatchObject({ ok: false, data: { refusal: 'pauseLocked' } });
    expect(c.sectors?.setCurrentWorldSector(A9)).toBe(true);
    expect([c.state.flow, c.state.clock.paused, c.state.clock.pauseLocked]).toEqual(['tactical', true, false]);
  });

  it('stops compression and lifts the pause lock when a sector loads from the map past the exit checks, so the load unpauses the game (StrategicMap.cc EnterSector)', () => {
    const c = onTheMapWithA9Unloaded();
    expect(c.dispatch({ type: 'compressTime', mode: CompressMode.MIN30 })).toEqual({ ok: true });
    const clock = c.state.clock;
    pauseGame(clock);
    lockPauseState(clock, LOCK_PAUSE_MEANWHILE);
    c.drainEvents();
    expect(c.dispatch({ type: 'enterSector', sector: 'A9' })).toMatchObject({ ok: false, data: { refusal: 'pauseLocked' } });
    expect(c.sectors?.setCurrentWorldSector(A9)).toBe(true);
    expect([c.state.flow, c.state.clock.paused, c.state.clock.pauseLocked]).toEqual(['tactical', false, false]);
    expect([c.state.clock.compressionOn, c.state.clock.stopReason]).toEqual([false, CompressionStop.MAP_EXIT]);
  });
});

describe('the speed a sector load from the map leaves (deviation "Speed on a sector load from the map")', () => {
  it.each(MAP_MODES)(
    "sets X1 when a sector that is not loaded loads from the map's $name, so the tactical clock runs and the map comes back at X0, as vanilla's game loop ends the map screen with the game screen pending (V:Strategic/StrategicMap.c:1029, V:GameLoop.c:249)",
    ({ set }) => {
      const c = onTheMapWithA9Unloaded();
      for (const command of set) expect(c.dispatch(command)).toEqual({ ok: true });
      expect(c.dispatch({ type: 'enterSector', sector: 'A9' })).toMatchObject({ ok: true });
      expect([c.state.flow, c.state.clock.mode, c.state.clock.compressionOn]).toEqual(['tactical', CompressMode.X1, false]);
      expect(worldSecondsOver(c, ONE_REAL_SECOND_OF_TICKS)).toBe(1);
      expect(c.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
      expect([c.state.clock.mode, c.state.clock.compressionOn]).toEqual([CompressMode.X0, false]);
    },
  );

  it('sets X1 and lifts the pause lock when the pre-battle panel loads the sector for the placement GUI (StrategicMap.cc EnterSector, V:Strategic/StrategicMap.c:1410-1412)', () => {
    const c = onTheMapWithA9Unloaded();
    expect(c.dispatch({ type: 'compressTime', mode: CompressMode.MIN30 })).toEqual({ ok: true });
    expect(c.dispatch({ type: 'stopTime' })).toEqual({ ok: true });
    lockPauseState(c.state.clock, LOCK_PAUSE_MERC_TALKING);
    expect(c.sectors?.setCurrentWorldSector(A9, { autoPlacement: true })).toBe(true);
    expect([c.state.flow, c.state.clock.mode, c.state.clock.paused, c.state.clock.pauseLocked]).toEqual([
      'tactical',
      CompressMode.X1,
      false,
      false,
    ]);
    expect(worldSecondsOver(c, ONE_REAL_SECOND_OF_TICKS)).toBe(1);
  });
});

describe('the compression cleanup', () => {
  const FAR_TILE = 75 * 160 + 100;
  const PRIMARY = { kind: 'desiredDirection', soldier: 0, direction: 0 } as const;
  const SECONDARY = {
    kind: 'weaponHit',
    soldier: 0,
    attacker: 0,
    weapon: 0,
    damage: 0,
    breathLoss: 0,
    direction: 0,
    range: 0,
    special: 0,
    delay: 20,
    stamp: 0,
  } as const;

  function walkingOnTheMap(): CampaignSim {
    const c = landed(0);
    const [walker] = ourSoldiers(c);
    if (!walker) throw new Error('no merc');
    expect(c.dispatch({ type: 'move', soldier: walker.id, to: FAR_TILE })).toMatchObject({ ok: true });
    for (let k = 0; k < ONE_REAL_SECOND_OF_TICKS; k++) c.step();
    expect(c.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    expect(ourSoldiers(c)[0]?.pathSize).toBeGreaterThan(0);
    return c;
  }

  it('stops every soldier in the loaded sector and drops the primary game events when compression is started', () => {
    const c = walkingOnTheMap();
    c.tactical?.state.gameEvents.push(PRIMARY, SECONDARY);
    expect(c.dispatch({ type: 'compressTime' })).toEqual({ ok: true });
    expect(ourSoldiers(c)[0]?.pathSize).toBe(0);
    expect(c.tactical?.state.gameEvents).toEqual([SECONDARY]);
  });

  it('clears nothing when a speed is picked, as the increase button sets the level without StartTimeCompression', () => {
    const c = walkingOnTheMap();
    expect(c.dispatch({ type: 'compressTime', mode: CompressMode.MIN30 })).toEqual({ ok: true });
    expect(ourSoldiers(c)[0]?.pathSize).toBeGreaterThan(0);
  });

  it('marks the start of compression with tacticalClearedForCompression, which a picked speed does not emit', () => {
    const c = walkingOnTheMap();
    c.drainEvents();
    const typesAfter = (cmd: Parameters<CampaignSim['dispatch']>[0]) => {
      expect(c.dispatch(cmd)).toEqual({ ok: true });
      return c.drainEvents().map((e) => e.type);
    };
    const picked = typesAfter({ type: 'compressTime', mode: CompressMode.MIN30 });
    expect(picked).toContain('compressionStarted');
    expect(picked).not.toContain('tacticalClearedForCompression');
    typesAfter({ type: 'stopTime' });
    const started = typesAfter({ type: 'compressTime' });
    expect(started).toContain('compressionStarted');
    expect(started.filter((type) => type === 'tacticalClearedForCompression')).toHaveLength(1);
  });

  it('clears again at every later start, as the map screen forgets each frame that compression occurred', () => {
    const c = walkingOnTheMap();
    expect(c.dispatch({ type: 'compressTime' })).toEqual({ ok: true });
    expect(c.dispatch({ type: 'stopTime' })).toEqual({ ok: true });
    c.tactical?.state.gameEvents.push(PRIMARY);
    expect(c.dispatch({ type: 'compressTime' })).toEqual({ ok: true });
    expect(c.tactical?.state.gameEvents).toEqual([]);
  });
});
