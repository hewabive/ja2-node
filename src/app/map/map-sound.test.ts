import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeGraph, pcmWav, settle } from '../../../tests/support/fake-audio.ts';
import { AudioEngine } from '../../audio/engine.ts';
import type { Cue } from '../../content/audio/cue.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import type { PlayerView, StrategicMercView } from '../../protocol/view.ts';
import type { AssetSource } from '../assets/asset-source.ts';
import { MapSound } from './map-sound.ts';

const MERC = 3;
const PROFILE = 7;
const OTHER_PROFILE = 8;

function source(): AssetSource {
  return {
    read: async (path: string) => new Uint8Array(await readFile(join(PROJECT_DATA_DIR, path))),
    resolve: () => ({ path: '', size: 0 }),
  } as unknown as AssetSource;
}

function view(): PlayerView {
  const merc = { id: MERC, profile: PROFILE, morale: 50, name: 'Ivan', sector: 'A9' } as unknown as StrategicMercView;
  return { soldiers: [], strategic: { mercs: [merc] } } as unknown as PlayerView;
}

async function rig(talking = false) {
  const graph = new FakeGraph();
  const engine = new AudioEngine({ createGraph: () => graph.asGraph(), load: async () => pcmWav(200) });
  engine.unlock();
  const cues: Cue[] = [];
  const play = engine.play.bind(engine);
  engine.play = (cue) => {
    cues.push(cue);
    return play(cue);
  };
  const cut: number[] = [];
  const sound = new MapSound(engine, source(), view, 'map-sound-test', { isTalking: () => talking, cut: (s) => cut.push(s) });
  await sound.load();
  return { sound, graph, cues, cut };
}

describe('the map screen battle sounds', () => {
  it("reports a merc's route confirmation playing by his profile until it ends, for the speech presenter's wait", async () => {
    const r = await rig();
    expect(r.sound.mercBattleSoundPlaying(PROFILE)).toBe(false);
    r.sound.confirmRoute(MERC);
    expect(r.cues.map((c) => c.file)).toEqual([expect.stringMatching(/^battlesnds\/007_ok\d?\.wav$/)]);
    expect(r.sound.mercBattleSoundPlaying(PROFILE)).toBe(true);
    expect(r.sound.mercBattleSoundPlaying(OTHER_PROFILE)).toBe(false);
    await settle();
    for (const playing of r.graph.playing()) playing.finish();
    expect(r.sound.mercBattleSoundPlaying(PROFILE)).toBe(false);
  });

  it('keeps the route confirmation of a merc who is talking silent', async () => {
    const r = await rig(true);
    r.sound.confirmRoute(MERC);
    expect(r.cues).toEqual([]);
    expect(r.cut).toEqual([]);
    expect(r.sound.mercBattleSoundPlaying(PROFILE)).toBe(false);
  });
});
