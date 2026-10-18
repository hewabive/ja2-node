import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSaveKit } from '../../tests/support/saves.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import type { ServerMessage } from '../protocol/messages.ts';
import type { MusicView } from '../protocol/music.ts';
import { MusicMode } from '../protocol/music-modes.ts';
import { Team } from '../sim/tactical/soldier.ts';
import { enterCombatMode } from '../sim/tactical/turns/turns.ts';
import { CampaignSession } from './campaign-session.ts';
import { TacticalSession } from './sandbox.ts';
import { readSaveHead } from './save-file.ts';
import type { Session } from './session.ts';

const TEST_TIMEOUT_MS = 120_000;

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

describe('the music mode of a session', () => {
  it(
    'starts the sandbox in the enemy-present mode and switches to battle music when combat starts',
    async () => {
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
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'follows a new campaign from the laptop to the first landing, and a save and a load keep it',
    async () => {
      const k = await createSaveKit(kit);
      try {
        const session = await k.factory('campaign', { seed: 3, campaign: { hire: [] } });
        const heard = listen(session);
        expect(heard.music()[0]?.mode).toBe(MusicMode.NONE);
        expect(session.dispatch({ type: 'aimHire', profile: 0, contract: 7 }).ok).toBe(true);
        expect(session.dispatch({ type: 'closeLaptop' }).ok).toBe(true);
        session.advance({ ticks: 1 });
        expect(session.music.mode).toBe(MusicMode.LAPTOP);
        const land = { type: 'compressTime', mode: 2 };
        await session.prepareAndDispatch(land);
        session.advance({ idle: true });
        session.advance({ ticks: 1 });
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
    },
    TEST_TIMEOUT_MS,
  );
});
