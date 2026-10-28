// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Intro.cc gpzSmackerFileNames, GetNextIntroVideo, PrepareToExitIntroScreen; src/game/Intro.h
// @src INTRO_BEGINING, INTRO_ENDING, INTRO_SPLASH; src/game/Directories.h INTRODIR.

import type { CampaignEndingView } from '../../protocol/view.ts';
import type { ClientSettings } from '../../ui/settings.ts';

export const INTRO_DIR = 'intro';
export const VIDEO_EXTENSION = 'smk';

export const IntroVideo = {
  REBEL_CREDITS: 'rebel_cr',
  OMERTA: 'omerta',
  PRAGUE_CREDITS: 'prague_cr',
  PRAGUE: 'prague',
  THRONE_MIGUEL: 'throne_mig',
  THRONE_NO_MIGUEL: 'throne_nomig',
  HELI_FLYBY: 'heli_flyby',
  HELI_SKYRIDER: 'heli_sky',
  HELI_NO_SKYRIDER: 'heli_nosky',
  SPLASH: 'splashscreen',
  TALONSOFT_LOGO: 'talonsoftid_endhold',
} as const;
export type IntroVideo = (typeof IntroVideo)[keyof typeof IntroVideo];

export type IntroSequence = 'splash' | 'beginning' | 'ending';
export type AfterSequence = 'mainMenu' | 'newGame' | 'credits';

export interface SequencePlan {
  readonly sequence: IntroSequence;
  readonly videos: readonly IntroVideo[];
  readonly followedBy: AfterSequence;
}

export const SPLASH_VIDEOS: readonly IntroVideo[] = [IntroVideo.SPLASH];
export const BEGINNING_VIDEOS: readonly IntroVideo[] = [
  IntroVideo.REBEL_CREDITS,
  IntroVideo.OMERTA,
  IntroVideo.PRAGUE_CREDITS,
  IntroVideo.PRAGUE,
];

export function introVideoPath(video: IntroVideo): string {
  return `${INTRO_DIR}/${video}.${VIDEO_EXTENSION}`;
}

export function endingVideos(ending: CampaignEndingView): readonly IntroVideo[] {
  return [
    ending.miguelAlive ? IntroVideo.THRONE_MIGUEL : IntroVideo.THRONE_NO_MIGUEL,
    IntroVideo.HELI_FLYBY,
    ending.skyriderAlive ? IntroVideo.HELI_SKYRIDER : IntroVideo.HELI_NO_SKYRIDER,
  ];
}

export function splashPlan(): SequencePlan {
  return { sequence: 'splash', videos: SPLASH_VIDEOS, followedBy: 'mainMenu' };
}

export function beginningPlan(): SequencePlan {
  return { sequence: 'beginning', videos: BEGINNING_VIDEOS, followedBy: 'newGame' };
}

export function endingPlan(ending: CampaignEndingView): SequencePlan {
  return { sequence: 'ending', videos: endingVideos(ending), followedBy: 'credits' };
}

export function sequenceEnabled(sequence: IntroSequence, settings: Pick<ClientSettings, 'playSplash' | 'playIntro'>): boolean {
  if (sequence === 'splash') return settings.playSplash;
  if (sequence === 'beginning') return settings.playIntro;
  return true;
}
