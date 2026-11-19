import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSaveKit } from '../../tests/support/saves.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { longestVictoryTrackMs } from '../content/audio/music-lengths.ts';
import type { ServerMessage } from '../protocol/messages.ts';
import { initialMusic, type MusicState, type MusicView } from '../protocol/music.ts';
import { MusicMode } from '../protocol/music-modes.ts';
import type { SimEvent } from '../sim/events.ts';
import { Team } from '../sim/tactical/soldier.ts';
import { enterCombatMode } from '../sim/tactical/turns/turns.ts';
import { CampaignSession } from './campaign-session.ts';
import { TacticalSession } from './sandbox.ts';
import { readSaveHead } from './save-file.ts';
import { Session, type SessionSim } from './session.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

function listen(session: Session): { messages: ServerMessage[]; music: () => MusicView[] } {
  const messages: ServerMessage[] = [];
  session.subscribe((m) => messages.push(m));
  const music = () =>
    messages.flatMap((m) => {
      if (m.t === 'welcome') return m.view.music ? [m.view.music] : [];
      if (m.t === 'frames') return m.frames.flatMap((f) => (f.music ? [f.music] : []));
      return [];
    });
  return { messages, music };
}

async function landingMusic(session: Session): Promise<MusicState[]> {
  const seen: MusicState[] = [session.music];
  expect(session.dispatch({ type: 'aimHire', profile: 0, contract: 7 }).ok).toBe(true);
  expect(session.dispatch({ type: 'closeLaptop' }).ok).toBe(true);
  seen.push(session.music);
  await session.prepareAndDispatch({ type: 'compressTime', mode: 2 });
  seen.push(session.music);
  session.advance({ events: ['helicopterDropEnded'] });
  seen.push(session.music);
  return seen;
}

describe('the music mode of a session', () => {
  it('hears a campaign created with its landing at the first helicopter drop in the welcome', async () => {
    const k = await createSaveKit(kit);
    try {
      const session = await k.factory('campaign', { seed: 3, campaign: {} });
      expect(session.music).toEqual({ mode: MusicMode.TACTICAL_ENEMY_PRESENT, previous: MusicMode.TACTICAL_NOTHING });
      const heard = listen(session);
      expect(heard.music()[0]).toEqual({ mode: MusicMode.TACTICAL_ENEMY_PRESENT, creature: false });
      const report = session.advance({ ticks: 1 });
      expect(report.events.map((e) => e.type)).toContain('sectorLoaded');
    } finally {
      await k.dispose();
    }
  });

  it('starts the sandbox in the enemy-present mode and switches to battle music when combat starts', async () => {
    const k = await createSaveKit(kit);
    try {
      const session = await k.factory('sandbox', { seed: 5 });
      const heard = listen(session);
      expect(heard.music()[0]).toEqual({ mode: MusicMode.TACTICAL_ENEMY_PRESENT, creature: false });
      const sim = session.sim;
      if (!(sim instanceof TacticalSession)) throw new Error('not a sandbox');
      enterCombatMode(sim.sim.state, Team.OUR);
      session.advance({ ticks: 20 });
      expect(heard.music().at(-1)).toEqual({ mode: MusicMode.TACTICAL_BATTLE, creature: false });
      expect(session.music).toEqual({ mode: MusicMode.TACTICAL_BATTLE, previous: MusicMode.TACTICAL_ENEMY_PRESENT });
      expect(session.sim.view().music).toBeUndefined();
    } finally {
      await k.dispose();
    }
  });

  it('follows a new campaign from the laptop to the end of the first helicopter drop, and a save and a load keep it', async () => {
    const k = await createSaveKit(kit);
    try {
      const session = await k.factory('campaign', { seed: 3, campaign: { hire: [] } });
      const heard = listen(session);
      expect(heard.music()[0]).toEqual({ mode: MusicMode.LAPTOP, creature: false });
      expect(session.music.previous).toBe(MusicMode.NONE);
      expect(session.dispatch({ type: 'aimHire', profile: 0, contract: 7 }).ok).toBe(true);
      expect(session.dispatch({ type: 'closeLaptop' }).ok).toBe(true);
      session.advance({ ticks: 1 });
      expect(session.music.mode).toBe(MusicMode.LAPTOP);
      const land = { type: 'compressTime', mode: 2 };
      await session.prepareAndDispatch(land);
      expect(session.music.mode).toBe(MusicMode.TACTICAL_NOTHING);
      session.advance({ events: ['helicopterDropEnded'] });
      const sim = session.sim;
      if (!(sim instanceof CampaignSession)) throw new Error('not a campaign');
      expect(sim.campaign.state.worldSector).not.toBeNull();
      expect(session.music).toEqual({ mode: MusicMode.TACTICAL_ENEMY_PRESENT, previous: MusicMode.TACTICAL_NOTHING });
      expect(heard.music().map((m) => m.mode)).toContain(MusicMode.TACTICAL_ENEMY_PRESENT);
      const saved = await k.saves.save(session, { name: 'withMusic' });
      expect(saved.ok).toBe(true);
      const bytes = await k.store.read('withMusic');
      expect(bytes && readSaveHead(bytes).header.flow).toBe('tactical');
      const loaded = await k.open({ load: 'withMusic', reseed: false });
      expect(loaded.music).toEqual(session.music);
      const relisten = listen(loaded);
      expect(relisten.music()[0]).toEqual({ mode: MusicMode.TACTICAL_ENEMY_PRESENT, creature: false });
      const inPlace = await k.factory('sandbox', { seed: 9 });
      await k.saves.loadInto(inPlace, 'withMusic', false);
      expect(inPlace.music).toEqual(session.music);
    } finally {
      await k.dispose();
    }
  });

  it('follows the same music modes when nobody listens and the session builds no frames', async () => {
    const k = await createSaveKit(kit);
    try {
      const heard = await k.factory('campaign', { seed: 3, campaign: { hire: [] } });
      listen(heard);
      const unheard = await k.factory('campaign', { seed: 3, campaign: { hire: [] } });
      const withListener = await landingMusic(heard);
      expect(await landingMusic(unheard)).toEqual(withListener);
      expect(withListener.at(-1)).toEqual({ mode: MusicMode.TACTICAL_ENEMY_PRESENT, previous: MusicMode.TACTICAL_NOTHING });
    } finally {
      await k.dispose();
    }
  });
});

const VICTORY_MS = 4000;
const SET_AT = 1000;
const ENDS_AT = SET_AT + VICTORY_MS;
const WON = { type: 'combatEnded', reason: 'won', fought: true, tick: 0 } as unknown as SimEvent;

interface ScriptedSim extends SessionSim {
  readonly next: SimEvent[];
  initialMusic?: MusicState;
}

function scriptedSim(): ScriptedSim {
  const next: SimEvent[] = [];
  return {
    next,
    tick: 0,
    isIdle: () => true,
    hasPendingDecision: () => false,
    step: () => undefined,
    drainEvents: () => next.splice(0),
    dispatch: () => ({ ok: true }),
    view: () => ({ tick: 0, mapPath: null, soldiers: [] }),
  };
}

function timedSession(sim: ScriptedSim = scriptedSim()): { session: Session; sim: ScriptedSim; at(ms: number): void } {
  const session = new Session('victory', sim);
  let now = SET_AT;
  session.wallClock = () => now;
  session.useMusicLengths(VICTORY_MS);
  return {
    session,
    sim,
    at: (ms) => {
      now = ms;
    },
  };
}

function winBattle(t: { session: Session; sim: ScriptedSim }): void {
  t.sim.next.push(WON);
  t.session.dispatch({ type: 'wait' });
}

describe('the victory track of a session (MusicPoll)', () => {
  it('turns to the nothing music once the victory track has run from its setter, in the next frame and every read', () => {
    const t = timedSession();
    const heard = listen(t.session);
    winBattle(t);
    expect(t.session.music).toEqual({ mode: MusicMode.TACTICAL_VICTORY, previous: MusicMode.NONE, victoryEndsAt: ENDS_AT });
    t.at(ENDS_AT - 1);
    t.session.dispatch({ type: 'wait' });
    t.at(ENDS_AT);
    t.session.dispatch({ type: 'wait' });
    expect(heard.music().map((m) => m.mode)).toEqual([MusicMode.NONE, MusicMode.TACTICAL_VICTORY, MusicMode.TACTICAL_NOTHING]);
    expect(t.session.music).toEqual({ mode: MusicMode.TACTICAL_NOTHING, previous: MusicMode.TACTICAL_VICTORY });
  });

  it('welcomes a viewer who comes after the track with the nothing music, beside a viewer that heard no frame since', () => {
    const t = timedSession();
    const first = listen(t.session);
    winBattle(t);
    t.at(ENDS_AT + 1);
    const second = listen(t.session);
    expect(second.music()).toEqual([{ mode: MusicMode.TACTICAL_NOTHING, creature: false }]);
    expect(first.music().at(-1)?.mode).toBe(MusicMode.TACTICAL_VICTORY);
    const alone = timedSession();
    winBattle(alone);
    alone.at(ENDS_AT);
    expect(listen(alone.session).music()).toEqual([{ mode: MusicMode.TACTICAL_NOTHING, creature: false }]);
  });

  it('plays a new victory after the nothing music it fell back to, and a load or a native import starts the track again', () => {
    const t = timedSession();
    winBattle(t);
    t.at(ENDS_AT + 10);
    winBattle(t);
    expect(t.session.music).toMatchObject({ mode: MusicMode.TACTICAL_VICTORY, victoryEndsAt: ENDS_AT + 10 + VICTORY_MS });
    const loadedAt = 20_000;
    t.at(loadedAt);
    t.session.restoreMusic({ mode: MusicMode.TACTICAL_VICTORY, previous: MusicMode.TACTICAL_BATTLE });
    expect(t.session.music.victoryEndsAt).toBe(loadedAt + VICTORY_MS);
    const sim = scriptedSim();
    sim.initialMusic = initialMusic(MusicMode.TACTICAL_VICTORY, MusicMode.MAIN_MENU);
    expect(timedSession(sim).session.music.victoryEndsAt).toBe(ENDS_AT);
  });

  it('measures the victory track of the stub pack for the sessions of the factory, and a save after its end keeps the nothing music', async () => {
    const k = await createSaveKit(kit);
    try {
      const victoryMs = await longestVictoryTrackMs(k.pack.read);
      expect(victoryMs).toBeGreaterThan(0);
      const session = await k.factory('sandbox', { seed: 5 });
      let now = SET_AT;
      session.wallClock = () => now;
      session.restoreMusic({ mode: MusicMode.TACTICAL_VICTORY, previous: MusicMode.TACTICAL_BATTLE });
      expect((await k.saves.save(session, { name: 'playing' })).ok).toBe(true);
      now = SET_AT + (victoryMs ?? 0);
      expect((await k.saves.save(session, { name: 'after' })).ok).toBe(true);
      expect((await k.open({ load: 'playing', reseed: false })).music.mode).toBe(MusicMode.TACTICAL_VICTORY);
      expect((await k.open({ load: 'after', reseed: false })).music).toEqual({
        mode: MusicMode.TACTICAL_NOTHING,
        previous: MusicMode.TACTICAL_VICTORY,
      });
    } finally {
      await k.dispose();
    }
  });
});
