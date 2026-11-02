// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-01. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Faces.cc InitFace (no flags: faces/NN.sti with the profile's eyes and mouth), SetAutoFaceActive,
// @src RenderAutoFace, HandleAutoFaces, SetFaceTalking (the voice at HIGHVOLUME with its gap list when SPEECH is on, the
// @src text's FindDelayForString otherwise), HandleTalkingAutoFace, InternalShutupaYoFace (the voice stopped);
// @src src/game/Tactical/Dialogue_Control.cc HandleDialogue (the next quote once the face stops talking),
// @src FindDelayForString; src/game/Tactical/Gap.cc PlayJA2GapSample (the speech volume); src/game/Laptop/AIMMembers.cc
// @src InitVideoFace, DisplayTalkingMercFaceForVideoPopUp; src/game/Laptop/Mercs.cc InitMercVideoFace, HandleSpeckTalking.

import type { AudioGap } from '../../../content/formats/gap.ts';
import type { ImageCatalog } from '../../assets.ts';
import type { DrawList } from '../../draw-list.ts';
import { textDelay } from '../../speech.ts';
import type { UiSoundHandle } from '../../widgets/button-sounds.ts';
import {
  drawTalkingFace,
  FaceAnimator,
  type FaceRecord,
  type FaceSpeech,
  type FaceSubject,
  faceFileOf,
  OKLIFE,
} from '../tactical/faces.ts';
import type { LaptopProfile } from './laptop-client.ts';
import type { LaptopContext } from './laptop-page.ts';

const HIGH_VOLUME = 127;
const NO_SOLDIER: FaceSubject = { life: OKLIFE };
const STILL_OFFSET: readonly [number, number] = [0, 0];

export interface VideoLine {
  readonly voice: string | null;
  readonly text: string;
  readonly started?: () => void;
}

export interface VideoFacePorts {
  readonly images: ImageCatalog;
  random(range: number): number;
  playVoice(file: string): UiSoundHandle;
  gaps(file: string): readonly AudioGap[] | null;
}

interface Speaking {
  readonly line: VideoLine;
  readonly voice: UiSoundHandle | null;
  readonly startedAt: number;
}

export function videoFacePorts(context: LaptopContext): VideoFacePorts {
  return {
    images: context.services.images,
    random: (range) => context.media.random(range),
    playVoice: (file) => context.services.sounds.play({ file, volume: HIGH_VOLUME, speech: true }),
    gaps: (file) => context.media.gaps(file),
  };
}

export function videoFaceRecord(profile: LaptopProfile | undefined, faceIndex: number): FaceRecord {
  return {
    path: faceFileOf(profile?.faceIndex ?? faceIndex),
    eyes: profile?.eyes ?? STILL_OFFSET,
    mouth: profile?.mouth ?? STILL_OFFSET,
    blinkFrequency: profile?.blinkFrequency ?? 0,
    expressionFrequency: profile?.expressionFrequency ?? 0,
  };
}

export class VideoFace {
  readonly #face: FaceAnimator;
  readonly #ports: VideoFacePorts;
  readonly #queue: VideoLine[] = [];
  #speaking: Speaking | null = null;

  constructor(record: FaceRecord, now: number, ports: VideoFacePorts) {
    this.#ports = ports;
    this.#face = new FaceAnimator(record, now, (range) => ports.random(range));
  }

  get animator(): FaceAnimator {
    return this.#face;
  }

  get talking(): boolean {
    return this.#face.talking;
  }

  say(line: VideoLine, now: number): void {
    this.#queue.push(line);
    if (!this.talking) this.#startNext(now);
  }

  shutUp(): void {
    this.#speaking?.voice?.stop();
    this.#speaking = null;
    this.#face.shutUp();
  }

  clear(): void {
    this.#queue.length = 0;
    this.shutUp();
  }

  freeze(): void {
    this.#face.freeze();
  }

  update(now: number): void {
    if (!this.talking) this.#startNext(now);
    const speaking = this.#speaking;
    this.#face.update(now, NO_SOLDIER, speaking ? this.#speech(speaking, now) : null, this.#ports.images);
    if (!this.talking) this.#speaking = null;
  }

  draw(list: DrawList, x: number, y: number): void {
    drawTalkingFace(list, this.#ports.images, this.#face, x, y);
  }

  #startNext(now: number): void {
    const line = this.#queue.shift();
    if (!line) return;
    const voice = line.voice === null ? null : this.#ports.playVoice(line.voice);
    this.#speaking = { line, voice, startedAt: now };
    this.#face.startTalking();
    line.started?.();
  }

  #speech(speaking: Speaking, now: number): FaceSpeech {
    const { voice, line } = speaking;
    if (voice && line.voice !== null && !voice.failed)
      return { playing: voice.active, elapsedMs: voice.elapsedMs, gaps: this.#ports.gaps(line.voice) ?? [] };
    const elapsedMs = now - speaking.startedAt;
    return { playing: elapsedMs <= textDelay([...line.text].length), elapsedMs, gaps: [] };
  }
}
