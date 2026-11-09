// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-09. See LICENSE (SFI-SCLA).
// @src src/game/GameSettings.cc MeanwhileSceneSeen, SetMeanwhileSceneSeen (uiMeanwhileScenesSeenFlags, kept in Ja2.set
// @src per installation, not in the save; an id past NUM_MEANWHILES is never seen and never set).

import { u32 } from '../../core/int.ts';
import { NUM_MEANWHILES } from '../strategic/ai/queen-state.ts';

export interface InstallationSettings {
  meanwhileSceneSeen(scene: number): boolean;
  setMeanwhileSceneSeen(scene: number): void;
}

export const NO_INSTALLATION: InstallationSettings = Object.freeze({
  meanwhileSceneSeen: () => false,
  setMeanwhileSceneSeen: () => {},
});

export function meanwhileSceneBit(scene: number): number {
  return Number.isInteger(scene) && scene >= 0 && scene < NUM_MEANWHILES ? u32(1 << scene) : 0;
}

export function meanwhileScenesSeenFlags(flags: unknown): number {
  return typeof flags === 'number' && Number.isInteger(flags) ? u32(flags) : 0;
}

export function meanwhileSceneSeenIn(flags: number, scene: number): boolean {
  return (flags & meanwhileSceneBit(scene)) !== 0;
}

export class MemoryInstallation implements InstallationSettings {
  meanwhileScenesSeen: number;

  constructor(meanwhileScenesSeen = 0) {
    this.meanwhileScenesSeen = meanwhileScenesSeenFlags(meanwhileScenesSeen);
  }

  meanwhileSceneSeen(scene: number): boolean {
    return meanwhileSceneSeenIn(this.meanwhileScenesSeen, scene);
  }

  setMeanwhileSceneSeen(scene: number): void {
    this.meanwhileScenesSeen = u32(this.meanwhileScenesSeen | meanwhileSceneBit(scene));
  }
}
