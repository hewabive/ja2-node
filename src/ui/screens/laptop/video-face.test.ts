import { describe, expect, it } from 'vitest';
import type { AudioGap } from '../../../content/formats/gap.ts';
import { StaticImageCatalog } from '../../assets.ts';
import { DrawList } from '../../draw-list.ts';
import { FINAL_TALKING_DELAY_MS, TEXT_DELAY_MODIFIER_MS } from '../../speech.ts';
import type { UiSoundHandle } from '../../widgets/button-sounds.ts';
import type { FaceRecord } from '../tactical/faces.ts';
import { VideoFace, type VideoLine } from './video-face.ts';

const FACE = 'faces/33.sti';
const ANIMATED_FACE_FRAMES = 8;
const MOUTH_FRAME_OFFSET = 4;
const RECORD: FaceRecord = { path: FACE, eyes: [10, 12], mouth: [10, 24], blinkFrequency: 3000, expressionFrequency: 2000 };
const VOICE = 'speech/033_005.wav';
const STEP_MS = 16;
const VOICE_MS = 1000;

class FakeVoice implements UiSoundHandle {
  active = true;
  failed = false;
  elapsedMs = 0;
  stopped = false;

  stop(): void {
    this.stopped = true;
    this.active = false;
  }
}

interface Rig {
  readonly face: VideoFace;
  readonly voices: FakeVoice[];
  readonly played: string[];
  gaps: readonly AudioGap[] | null;
  missing: boolean;
}

function rig(): Rig {
  const images = new StaticImageCatalog();
  const frame = { width: 48, height: 43, offsetX: 0, offsetY: 0 };
  images.set(FACE, { kind: 'indexed', frames: Array.from({ length: ANIMATED_FACE_FRAMES }, () => frame), animatedFrames: 0 });
  let draws = 0;
  const r: Rig = {
    voices: [],
    played: [],
    gaps: null,
    missing: false,
    face: new VideoFace(RECORD, 0, {
      images,
      random: (range) => draws++ % range,
      playVoice: (file) => {
        r.played.push(file);
        const voice = new FakeVoice();
        voice.failed = r.missing;
        voice.active = !r.missing;
        r.voices.push(voice);
        return voice;
      },
      gaps: () => r.gaps,
    }),
  };
  return r;
}

function run(face: VideoFace, from: number, to: number, each?: (now: number) => void): number[] {
  const mouths: number[] = [];
  for (let now = from; now <= to; now += STEP_MS) {
    each?.(now);
    face.update(now);
    mouths.push(face.animator.mouthFrame);
  }
  return mouths;
}

function voiced(text = 'Hello there'): VideoLine {
  return { voice: VOICE, text };
}

describe('the laptop video face', () => {
  it('moves the mouth while the voice plays, then talks on 300 ms with the mouth closed', () => {
    const r = rig();
    r.face.say(voiced(), 0);
    expect([r.played, r.face.talking]).toEqual([[VOICE], true]);
    const mouths = run(r.face, STEP_MS, VOICE_MS);
    expect(mouths.some((m) => m > 0)).toBe(true);
    const voice = r.voices[0];
    if (voice) voice.active = false;
    const ended = VOICE_MS + STEP_MS;
    r.face.update(ended);
    expect([r.face.talking, r.face.animator.mouthFrame]).toEqual([true, 0]);
    r.face.update(ended + FINAL_TALKING_DELAY_MS);
    expect(r.face.talking).toBe(true);
    r.face.update(ended + FINAL_TALKING_DELAY_MS + 1);
    expect(r.face.talking).toBe(false);
  });

  it('times a quote without a voice by its text, 60 ms a character, as when the voice is missing', () => {
    const text = 'x'.repeat(10);
    const textMs = text.length * TEXT_DELAY_MODIFIER_MS;
    for (const line of [{ voice: null, text }, voiced(text)]) {
      const r = rig();
      r.missing = true;
      r.face.say(line, 0);
      run(r.face, 0, textMs);
      expect(r.face.animator.talking).toBe(true);
      r.face.update(textMs + 1);
      expect(r.face.animator.mouthFrame).toBe(0);
      r.face.update(textMs + 1 + FINAL_TALKING_DELAY_MS + 1);
      expect(r.face.talking).toBe(false);
    }
  });

  it('keeps the mouth closed in the gaps of the voice', () => {
    const r = rig();
    r.gaps = [{ start: 100, end: 900 }];
    r.face.say(voiced(), 0);
    const mouths = run(r.face, STEP_MS, 800, (now) => {
      const voice = r.voices[0];
      if (voice) voice.elapsedMs = now;
    });
    expect(mouths.slice(Math.ceil(120 / STEP_MS)).every((m) => m === 0)).toBe(true);
  });

  it('says a queued quote once the face has stopped talking', () => {
    const r = rig();
    const started: number[] = [];
    let now = 0;
    const line = (n: number): VideoLine => ({ voice: null, text: 'x', started: () => started.push(n * 1000 + now) });
    r.face.say(line(1), now);
    r.face.say(line(2), now);
    expect(started).toEqual([1000]);
    for (now = STEP_MS; started.length < 2; now += STEP_MS) r.face.update(now);
    expect(started[1]).toBeGreaterThan(2000 + TEXT_DELAY_MODIFIER_MS + FINAL_TALKING_DELAY_MS);
  });

  it('stops the voice and closes the mouth when shut up', () => {
    const r = rig();
    r.face.say(voiced(), 0);
    run(r.face, STEP_MS, 400);
    r.face.shutUp();
    expect([r.voices[0]?.stopped, r.face.talking, r.face.animator.mouthFrame]).toEqual([true, false, 0]);
  });

  it('neither blinks nor moves the mouth once frozen, as on the answering machine, yet talks out its quote', () => {
    const r = rig();
    r.face.freeze();
    r.face.say(voiced(), 0);
    const eyes: number[] = [];
    const mouths = run(r.face, STEP_MS, 6000, (now) => {
      eyes.push(r.face.animator.eyeFrame);
      if (now > VOICE_MS) {
        const voice = r.voices[0];
        if (voice) voice.active = false;
      }
    });
    expect([...new Set(eyes)], 'eyes').toEqual([0]);
    expect([...new Set(mouths)], 'mouth').toEqual([0]);
    expect(r.face.talking).toBe(false);
    const list = new DrawList();
    r.face.draw(list, 0, 0);
    expect(list.items.map((i) => (i.kind === 'image' ? i.frame : -1))).toEqual([0]);
  });

  it('draws the face with its eyes and mouth at the profile offsets', () => {
    const r = rig();
    r.face.say(voiced(), 0);
    const drawnWhen = (shown: () => boolean): number[][] => {
      for (let now = STEP_MS; !shown(); now += STEP_MS) r.face.update(now);
      const list = new DrawList();
      r.face.draw(list, 100, 50);
      return list.items.flatMap((i) => (i.kind === 'image' ? [[i.frame, i.x, i.y]] : []));
    };
    const talking = drawnWhen(() => r.face.animator.mouthFrame > 0);
    expect(talking[0]).toEqual([0, 100, 50]);
    expect(talking).toContainEqual([r.face.animator.mouthFrame + MOUTH_FRAME_OFFSET, 110, 74]);
    const blinking = drawnWhen(() => r.face.animator.eyeFrame > 0);
    expect(blinking).toContainEqual([r.face.animator.eyeFrame, 110, 62]);
  });
});
