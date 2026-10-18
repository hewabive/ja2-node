import { describe, expect, it } from 'vitest';
import { FakeGraph, type FakeSource, pcmWav, settle } from '../../tests/support/fake-audio.ts';
import { parseMusicTable } from '../content/audio/music-table.ts';
import type { MusicView } from '../protocol/music.ts';
import { FAST_FADE_STEP, MusicMode, type MusicModeName } from '../protocol/music-modes.ts';
import { AudioEngine, DEFAULT_ENGINE_VOLUMES } from './engine.ts';
import { MusicPlayer } from './music.ts';

const TABLE = parseMusicTable({
  main_menu: ['music/menu.wav'],
  laptop: ['music/laptop.wav'],
  tactical: ['music/nothing a.wav', 'music/nothing b.wav'],
  tactical_enemypresent: ['music/tensor a.wav'],
  tactical_battle: ['music/battle a.wav'],
  tactical_creature: ['music/creepy.wav'],
  tactical_creature_enemypresent: ['music/creepy.wav'],
  tactical_creature_battle: ['music/creature battle.wav'],
  tactical_victory: ['music/triumph.wav'],
  tactical_defeat: ['music/death.wav'],
});
const MUSIC_VOLUME = 40;

function rig(volume = MUSIC_VOLUME) {
  const graph = new FakeGraph();
  const files = new Map<string, Uint8Array>();
  for (const list of TABLE.values()) for (const path of list) files.set(path, pcmWav(64, 2));
  const engine = new AudioEngine({ createGraph: () => graph.asGraph(), load: async (path) => files.get(path) ?? null });
  engine.unlock();
  engine.setVolumes({ ...DEFAULT_ENGINE_VOLUMES, music: volume });
  const picks: number[] = [];
  const player = new MusicPlayer({
    engine,
    table: TABLE,
    rand: (n) => {
      picks.push(n);
      return n - 1;
    },
  });
  const playing = (): FakeSource[] => graph.playing().filter((s) => !s.stoppedAt && s.stoppedAt !== 0);
  return { graph, engine, player, picks, playing };
}

const view = (mode: MusicModeName, creature = false, fastFade = false): MusicView => ({
  mode,
  creature,
  ...(fastFade ? { fastFade: true as const } : {}),
});

function pollUntilSilent(player: MusicPlayer, limit = 200): number {
  let polls = 0;
  while (player.fading && polls < limit) {
    player.poll();
    polls++;
  }
  return polls;
}

describe('the music player', () => {
  it('starts a random track of the mode at once at the music volume, without a fade-in', async () => {
    const { player, picks } = rig();
    player.show(view(MusicMode.TACTICAL_NOTHING));
    await settle();
    expect(picks).toEqual([2]);
    expect(player.track).toBe('music/nothing b.wav');
    expect(player.volume).toBe(MUSIC_VOLUME);
    player.show(view(MusicMode.TACTICAL_NOTHING));
    expect(player.track).toBe('music/nothing b.wav');
  });

  it('fades the old track out one volume step per poll and then starts the new mode', async () => {
    const { player } = rig();
    player.show(view(MusicMode.TACTICAL_ENEMY_PRESENT));
    await settle();
    player.show(view(MusicMode.TACTICAL_BATTLE));
    expect(player.track).toBe('music/tensor a.wav');
    player.poll();
    expect(player.volume).toBe(MUSIC_VOLUME - 1);
    const polls = pollUntilSilent(player) + 1;
    expect(polls).toBe(MUSIC_VOLUME);
    await settle();
    expect(player.track).toBe('music/battle a.wav');
    expect(player.volume).toBe(MUSIC_VOLUME);
  });

  it('fades five times faster on a sector entry or exit', async () => {
    const { player } = rig();
    player.show(view(MusicMode.TACTICAL_ENEMY_PRESENT));
    await settle();
    player.show(view(MusicMode.TACTICAL_NOTHING, false, true));
    expect(pollUntilSilent(player)).toBe(Math.ceil(MUSIC_VOLUME / FAST_FADE_STEP));
    await settle();
    expect(player.track).toBe('music/nothing b.wav');
    player.show(view(MusicMode.TACTICAL_BATTLE));
    expect(pollUntilSilent(player)).toBe(MUSIC_VOLUME);
  });

  it('plays the next random track of the mode when one ends', async () => {
    const { player, graph, picks } = rig();
    player.show(view(MusicMode.TACTICAL_NOTHING));
    await settle();
    graph.playing()[0]?.finish();
    player.poll();
    await settle();
    expect(picks).toEqual([2, 2]);
    expect(player.track).toBe('music/nothing b.wav');
    expect(player.stats.tracksStarted).toBe(2);
  });

  it('falls back to the nothing mode after the victory track and to silence after the defeat track', async () => {
    const won = rig();
    won.player.show(view(MusicMode.TACTICAL_VICTORY));
    await settle();
    expect(won.player.track).toBe('music/triumph.wav');
    won.graph.playing()[0]?.finish();
    won.player.poll();
    await settle();
    expect(won.player.mode).toBe(MusicMode.TACTICAL_NOTHING);
    expect(won.player.track).toBe('music/nothing b.wav');
    const lost = rig();
    lost.player.show(view(MusicMode.TACTICAL_DEFEAT));
    await settle();
    lost.graph.playing()[0]?.finish();
    lost.player.poll();
    await settle();
    expect(lost.player.mode).toBe(MusicMode.TACTICAL_DEFEAT);
    expect(lost.player.track).toBeNull();
    for (let i = 0; i < 10; i++) lost.player.poll();
    expect(lost.player.stats.tracksStarted).toBe(1);
  });

  it('picks the creature tracks for the nothing, enemy and battle modes while the creature flag is set', async () => {
    const { player } = rig();
    player.show(view(MusicMode.TACTICAL_BATTLE, true));
    await settle();
    expect(player.track).toBe('music/creature battle.wav');
    player.show(view(MusicMode.TACTICAL_VICTORY, true));
    pollUntilSilent(player);
    await settle();
    expect(player.track).toBe('music/triumph.wav');
  });

  it('stops at music volume 0 without restarting and starts again when the volume comes back', async () => {
    const { player, engine } = rig();
    player.show(view(MusicMode.LAPTOP));
    await settle();
    engine.setVolumes({ ...engine.volumes, music: 0 });
    player.setVolume(MUSIC_VOLUME, 0);
    player.poll();
    expect(player.track).toBeNull();
    expect(player.stats.tracksStarted).toBe(1);
    engine.setVolumes({ ...engine.volumes, music: MUSIC_VOLUME });
    player.setVolume(0, MUSIC_VOLUME);
    await settle();
    expect(player.track).toBe('music/laptop.wav');
  });

  it('fades out to silence for the none mode', async () => {
    const { player } = rig();
    player.show(view(MusicMode.MAIN_MENU));
    await settle();
    player.show(view(MusicMode.NONE));
    pollUntilSilent(player);
    await settle();
    expect(player.track).toBeNull();
    for (let i = 0; i < 5; i++) player.poll();
    expect(player.track).toBeNull();
  });
});
