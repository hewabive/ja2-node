// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/IMP_Portraits.cc EnterIMPPortraits, RenderPortrait (faces/bigfaces/<face>.sti of the gender's n-th
// @src portrait), IncrementPictureIndex, DecrementPicture, BtnIMPPortraitDoneCallback; IMP_Voices.cc EnterIMPVoices (the
// @src sample played on entry), PlayVoice (speech/<profile>_001.wav at MIDVOLUME), IncrementVoice, DecrementVoice,
// @src BtnIMPVoicesDoneCallback, IMPPortraitRegionButtonCallback, RenderVoiceIndex ("<pIMPVoicesStrings> <n>").
// @src See docs/28 §9.7.

import type { ControllerContract } from '../../../layout/controller.ts';
import { ViewModelController } from '../../../layout/controller.ts';
import { portraitPath } from '../../../widgets/portrait.ts';
import type { LaptopPage } from '../laptop-page.ts';
import { genderList, type ImpContext } from './imp-site.ts';

export const IMP_PORTRAIT_LAYOUT = 'imp-portrait';
export const IMP_VOICE_LAYOUT = 'imp-voice';

const VOICES_STRINGS = 'pIMPVoicesStrings';
const SPEECH_DIR = 'speech';
const VOICE_SAMPLE_QUOTE = 1;
const MID_VOLUME = 'MIDVOLUME';

export const IMP_PORTRAIT_CONTRACT: ControllerContract = {
  id: 'impPortrait',
  actions: { next: {}, previous: {}, done: {} },
  bindings: { face: 'number', faceShown: 'boolean' },
};

export const IMP_VOICE_CONTRACT: ControllerContract = {
  id: 'impVoice',
  actions: { next: {}, previous: {}, done: {}, replay: {} },
  bindings: { voiceIndex: 'string' },
};

function threeDigits(n: number): string {
  return String(n).padStart(3, '0');
}

export function voiceSample(profile: number): string {
  return `${SPEECH_DIR}/${threeDigits(profile)}_${threeDigits(VOICE_SAMPLE_QUOTE)}.wav`;
}

export function portraitPage(imp: ImpContext): LaptopPage {
  const { draft } = imp;
  const faces = () => genderList(imp, 'portraits');
  draft.enterPortraits(faces().length);
  const model: Record<string, unknown> = {};
  let loaded = -1;
  const refresh = () => {
    const face = faces()[draft.portrait];
    model.faceShown = face !== undefined;
    model.face = face ?? 0;
    if (face !== undefined && face !== loaded) {
      loaded = face;
      void imp.context.media.loadImages([portraitPath(face, 'big')]);
    }
  };
  const controller = new ViewModelController(IMP_PORTRAIT_CONTRACT, model, {
    next: () => draft.stepPortrait(1, faces().length),
    previous: () => draft.stepPortrait(-1, faces().length),
    done: () => draft.portraitDone(),
  });
  refresh();
  return { layouts: [{ name: IMP_PORTRAIT_LAYOUT, controller }], update: refresh };
}

export function voicePage(imp: ImpContext): LaptopPage {
  const { draft, context } = imp;
  const voices = () => genderList(imp, 'voices');
  draft.enterVoices(voices().length);
  const volume = context.constant(IMP_VOICE_LAYOUT, MID_VOLUME);
  const play = () => {
    const profile = voices()[draft.voice];
    if (profile !== undefined) context.playSound(voiceSample(profile), volume);
  };
  const model: Record<string, unknown> = {};
  const refresh = () => {
    model.voiceIndex = `${context.string(VOICES_STRINGS, 0)} ${draft.voice + 1}`;
  };
  const step = (delta: 1 | -1) => {
    draft.stepVoice(delta, voices().length);
    play();
  };
  const controller = new ViewModelController(IMP_VOICE_CONTRACT, model, {
    next: () => step(1),
    previous: () => step(-1),
    done: () => draft.voiceDone(),
    replay: play,
  });
  play();
  refresh();
  return { layouts: [{ name: IMP_VOICE_LAYOUT, controller }], update: refresh };
}
