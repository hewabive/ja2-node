import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeGraph, pcmWav, settle } from '../../../tests/support/fake-audio.ts';
import { AudioEngine, DEFAULT_ENGINE_VOLUMES } from '../../audio/engine.ts';
import { MUSIC_TABLE_PATH } from '../../content/audio/music-table.ts';
import type { MusicView } from '../../protocol/music.ts';
import { MUSIC_OVERHEAD_MS, MusicMode } from '../../protocol/music-modes.ts';
import { DEFAULT_SETTINGS } from '../../ui/settings.ts';
import { FrontEndMusicPlayer } from './front-end-music.ts';

const VICTORY_TRACK = 'music/triumph.wav';
const NOTHING_TRACK = 'music/nothing a.wav';
const TABLE = { main_menu: ['music/menu.wav'], tactical: [NOTHING_TRACK], tactical_victory: [VICTORY_TRACK] };
const VICTORY: MusicView = { mode: MusicMode.TACTICAL_VICTORY, creature: false };
const POLLS = 200;

async function rig() {
  const graph = new FakeGraph();
  const engine = new AudioEngine({ createGraph: () => graph.asGraph(), load: async () => pcmWav(64, 2) });
  engine.unlock();
  engine.setVolumes(DEFAULT_ENGINE_VOLUMES);
  const read = async (path: string) => {
    if (path !== MUSIC_TABLE_PATH) throw new Error(`no ${path}`);
    return new TextEncoder().encode(JSON.stringify(TABLE));
  };
  const music = new FrontEndMusicPlayer(DEFAULT_SETTINGS, read);
  await music.load(engine);
  return { graph, music };
}

async function poll(times = POLLS): Promise<void> {
  for (let i = 0; i < times; i++) {
    vi.advanceTimersByTime(MUSIC_OVERHEAD_MS);
    await settle();
  }
}

describe('the front end music player', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the nothing track the victory track fell back to when a game screen shows the session again', async () => {
    const { graph, music } = await rig();
    music.show('session', VICTORY);
    await settle();
    expect(music.page.hook.track).toBe(VICTORY_TRACK);
    graph.playing()[0]?.finish();
    await poll(1);
    expect([music.page.hook.mode, music.page.hook.track]).toEqual([MusicMode.TACTICAL_NOTHING, NOTHING_TRACK]);
    music.show('session', VICTORY);
    await poll();
    expect([music.page.hook.mode, music.page.hook.track, music.page.hook.tracks]).toEqual([
      MusicMode.TACTICAL_NOTHING,
      NOTHING_TRACK,
      [VICTORY_TRACK, NOTHING_TRACK],
    ]);
  });

  it('shows the session again after the main menu music', async () => {
    const { music } = await rig();
    music.show('session', VICTORY);
    music.show('mainMenu', null);
    await poll();
    music.show('session', VICTORY);
    await poll();
    expect([music.page.hook.mode, music.page.hook.track]).toEqual([MusicMode.TACTICAL_VICTORY, VICTORY_TRACK]);
  });
});
