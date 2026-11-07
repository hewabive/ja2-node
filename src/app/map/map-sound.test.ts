import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeGraph, pcmWav, settle } from '../../../tests/support/fake-audio.ts';
import { AudioEngine } from '../../audio/engine.ts';
import { type Cue, mixCue } from '../../content/audio/cue.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import type { PlayerView, StrategicMercView } from '../../protocol/view.ts';
import type { AssetSource } from '../assets/asset-source.ts';
import { MapSound } from './map-sound.ts';

const MERC = 3;
const PROFILE = 7;
const OTHER_PROFILE = 8;
const DOORCR_1 = 'sounds/doorcr.wav';
const HEADCR_1 = 'sounds/ja2 death hit.wav';
const INTO_VEHICLE = 'sounds/into vehicle.wav';
const VEHICLE_TILE = 80 * 160 + 80;
const FAR_RIGHT_OFF_SCREEN = 126;
const MIDDLE = 64;
const FULL = 127;
const FAR_VOLUME = FULL - 25;
const LAST_TACTICAL_VIEW = { centerX: 800, centerY: 1800, width: 640, height: 360 };

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
  return { sound, engine, graph, cues, cut };
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

  it('cries the death of a soldier on the map screen in the voice the event names, then DOORCR_1 and HEADCR_1, all at the middle', async () => {
    const r = await rig();
    r.sound.mercDiedOffTheMap(MERC, { voice: '052', bodyType: 0 });
    const samples = [DOORCR_1, HEADCR_1];
    expect(r.cues.map((c) => c.file)).toEqual(['battlesnds/052_die.wav', ...samples]);
    expect(r.cues.map((c) => [c.gridNo, c.pan, c.baseVolume])).toEqual([
      [-1, 64, 127],
      [-1, 64, 127],
      [-1, 64, 127],
    ]);
    r.sound.mercDiedOffTheMap(MERC + 1, null);
    expect(r.cues.slice(3).map((c) => c.file)).toEqual(samples);
  });

  it("plays a vehicle's enter sound at its tile against the tactical view last shown, and off the loaded map at full volume in the middle (PlayLocationJA2Sample)", async () => {
    const r = await rig();
    r.engine.setListener(LAST_TACTICAL_VIEW);
    r.sound.vehicleEntered(VEHICLE_TILE);
    r.sound.vehicleEntered(null);
    const full = { effects: FULL, speech: FULL, music: FULL, ambient: FULL };
    expect(r.cues.map((c) => [c.file, mixCue(c, r.engine.listener, full)])).toEqual([
      [INTO_VEHICLE, { volume: FAR_VOLUME, pan: FAR_RIGHT_OFF_SCREEN }],
      [INTO_VEHICLE, { volume: FULL, pan: MIDDLE }],
    ]);
  });

  it('keeps the route confirmation of a merc who is talking silent', async () => {
    const r = await rig(true);
    r.sound.confirmRoute(MERC);
    expect(r.cues).toEqual([]);
    expect(r.cut).toEqual([]);
    expect(r.sound.mercBattleSoundPlaying(PROFILE)).toBe(false);
  });
});
