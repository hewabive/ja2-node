import { describe, expect, it } from 'vitest';
import { FakeGraph, pcmWav, settle } from '../../tests/support/fake-audio.ts';
import { cueOf } from '../content/audio/cue.ts';
import { NOWHERE } from '../content/audio/sound-position.ts';
import { LruCache } from './buffer-cache.ts';
import { AudioEngine, DEFAULT_ENGINE_VOLUMES, MAX_VOICES } from './engine.ts';

function engineWith(files: Record<string, Uint8Array>, options: { maxVoices?: number; cacheEntries?: number } = {}) {
  const graph = new FakeGraph();
  const loads: string[] = [];
  const engine = new AudioEngine({
    createGraph: () => graph.asGraph(),
    load: async (path) => {
      loads.push(path);
      return files[path] ?? null;
    },
    ...options,
  });
  return { graph, engine, loads };
}

const fixed = (file: string, loops = 1) => cueOf(file, 'fixed', 127, NOWHERE, 64, loops);

describe('the audio engine', () => {
  it('ignores cues until the first gesture unlocks it, then builds four buses into a master gain', async () => {
    const { graph, engine } = engineWith({ 'a.wav': pcmWav(100) });
    expect(engine.play(fixed('a.wav')).state).toBe('silent');
    expect(engine.counters.cuesWhileLocked).toBe(1);
    engine.unlock();
    expect(graph.state).toBe('running');
    expect(graph.gains).toHaveLength(5);
    expect(graph.gains[0]?.connections).toEqual([graph.destination]);
    const voice = engine.play(fixed('a.wav'));
    await settle();
    expect(voice.state).toBe('playing');
    expect(engine.counters.voicesStarted).toBe(1);
  });

  it('pans with two linear gains from the mixed volume and pan, splitting stereo buffers', async () => {
    const { graph, engine } = engineWith({ 'm.wav': pcmWav(10), 's.wav': pcmWav(10, 2) });
    engine.unlock();
    engine.setVolumes({ ...DEFAULT_ENGINE_VOLUMES, effects: 127 });
    engine.play(cueOf('m.wav', 'fixed', 127, NOWHERE, 0));
    await settle();
    const [left, right] = graph.gains.slice(5, 7);
    expect([left?.gain.value, right?.gain.value]).toEqual([127 / 128, 0]);
    engine.play(fixed('s.wav'));
    await settle();
    expect(graph.splitters).toHaveLength(1);
  });

  it('drops a new voice when 16 are playing and steals nothing', async () => {
    const { graph, engine } = engineWith({ 'a.wav': pcmWav(10) });
    engine.unlock();
    const voices = Array.from({ length: MAX_VOICES + 2 }, () => engine.play(fixed('a.wav')));
    await settle();
    expect(voices.filter((v) => v.state === 'playing')).toHaveLength(MAX_VOICES);
    expect(voices.filter((v) => v.state === 'dropped')).toHaveLength(2);
    expect(engine.counters.voicesDropped).toBe(2);
    graph.playing()[0]?.finish();
    expect(engine.counters.activeVoices).toBe(MAX_VOICES - 1);
    expect(engine.play(fixed('a.wav')).state).toBe('playing');
  });

  it('fetches each file once, counts missing and undecodable files and never refetches them', async () => {
    const { engine, loads } = engineWith({ 'a.wav': pcmWav(10), 'bad.wav': new Uint8Array([1, 2, 3]) });
    engine.unlock();
    engine.play(fixed('a.wav'));
    engine.play(fixed('a.wav'));
    engine.play(fixed('gone.wav'));
    engine.play(fixed('bad.wav'));
    await settle();
    engine.play(fixed('gone.wav'));
    engine.play(fixed('a.wav'));
    await settle();
    expect(loads).toEqual(['a.wav', 'gone.wav', 'bad.wav']);
    expect(engine.counters).toMatchObject({ filesMissing: 1, decodeErrors: 1, voicesStarted: 3 });
  });

  it('starts nothing while the master volume or the mixed volume is zero', async () => {
    const { engine } = engineWith({ 'a.wav': pcmWav(10) });
    engine.unlock();
    engine.setVolumes({ ...DEFAULT_ENGINE_VOLUMES, master: 0 });
    expect(engine.play(fixed('a.wav')).state).toBe('silent');
    engine.setVolumes({ ...DEFAULT_ENGINE_VOLUMES, effects: 0 });
    expect(engine.play(fixed('a.wav')).state).toBe('silent');
    await settle();
    expect(engine.counters).toMatchObject({ voicesStarted: 0, voicesSilent: 2 });
  });

  it('loops a counted number of times, loops forever for positional sounds, and stops on request', async () => {
    const { graph, engine } = engineWith({ 'a.wav': pcmWav(11025) });
    engine.unlock();
    engine.play(fixed('a.wav', 5));
    const forever = engine.play(cueOf('a.wav', 'positionLoop', 15, 100, 64, Number.POSITIVE_INFINITY));
    await settle();
    const [counted, endless] = graph.sources;
    expect(counted?.loop).toBe(true);
    expect(counted?.stoppedAt).toBe(5);
    expect(endless?.loop).toBe(true);
    expect(endless?.stoppedAt).toBeNull();
    let ended = false;
    forever.onEnded = () => {
      ended = true;
    };
    forever.stop();
    expect(forever.state).toBe('stopped');
    expect(ended).toBe(true);
  });

  it('evicts the least recently used of its decoded buffers', () => {
    const cache = new LruCache<number>(3);
    for (const k of ['a', 'b', 'c']) cache.set(k, 1);
    cache.get('a');
    cache.set('d', 1);
    expect(cache.keys()).toEqual(['c', 'a', 'd']);
    expect(cache.has('b')).toBe(false);
    expect(new LruCache().capacity).toBe(128);
  });

  it('keeps at most the configured number of decoded buffers', async () => {
    const files = Object.fromEntries(['a', 'b', 'c'].map((k) => [`${k}.wav`, pcmWav(4)]));
    const { engine } = engineWith(files, { cacheEntries: 2 });
    engine.unlock();
    for (const k of ['a', 'b', 'c']) engine.play(fixed(`${k}.wav`));
    await settle();
    expect(engine.cachedPaths()).toEqual(['b.wav', 'c.wav']);
  });
});
