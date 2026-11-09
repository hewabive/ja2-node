import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { u32 } from '../core/int.ts';
import type { InstallationView } from '../protocol/installation.ts';
import {
  type InstallationSettings,
  meanwhileSceneBit,
  meanwhileSceneSeenIn,
  meanwhileScenesSeenFlags,
} from '../sim/campaign/installation.ts';

export const INSTALLATION_FILE = 'installation.json';
export const INSTALLATION_FORMAT = 'ja2-node-installation';
const INSTALLATION_VERSION = 1;
const TEMP_SUFFIX = '.tmp';

interface InstallationFile {
  readonly format: typeof INSTALLATION_FORMAT;
  readonly version: number;
  readonly meanwhileScenesSeen: number;
}

function flagsOf(text: string): number {
  const file = JSON.parse(text) as Partial<InstallationFile> | null;
  return file?.format === INSTALLATION_FORMAT ? meanwhileScenesSeenFlags(file.meanwhileScenesSeen) : 0;
}

export class InstallationStore implements InstallationSettings {
  readonly path: string;
  readonly #warn: (message: string) => void;

  constructor(dir: string, warn: (message: string) => void = () => {}) {
    this.path = join(dir, INSTALLATION_FILE);
    this.#warn = warn;
  }

  view(): InstallationView {
    return { meanwhileScenesSeen: this.#read() };
  }

  meanwhileSceneSeen(scene: number): boolean {
    return meanwhileSceneSeenIn(this.#read(), scene);
  }

  setMeanwhileSceneSeen(scene: number): void {
    this.mergeMeanwhileScenesSeen(meanwhileSceneBit(scene));
  }

  mergeMeanwhileScenesSeen(flags: number): InstallationView {
    const known = this.#read();
    const merged = u32(known | meanwhileScenesSeenFlags(flags));
    if (merged !== known) this.#write(merged);
    return { meanwhileScenesSeen: merged };
  }

  #read(): number {
    try {
      return flagsOf(readFileSync(this.path, 'utf8'));
    } catch {
      return 0;
    }
  }

  #write(meanwhileScenesSeen: number): void {
    const file: InstallationFile = { format: INSTALLATION_FORMAT, version: INSTALLATION_VERSION, meanwhileScenesSeen };
    const temp = `${this.path}${TEMP_SUFFIX}`;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(temp, `${JSON.stringify(file)}\n`);
      renameSync(temp, this.path);
    } catch (err) {
      this.#warn(`cannot write ${this.path}: ${(err as Error).message}`);
    }
  }
}
