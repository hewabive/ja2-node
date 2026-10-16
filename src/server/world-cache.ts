import {
  buildTacticalWorldFromInputs,
  loadTacticalWorldInputs,
  type TacticalWorld,
  type TacticalWorldInputs,
} from '../content/world/tactical-world.ts';
import type { ReadFile } from '../content/world/tileset-loader.ts';
import type { SectorWorlds } from '../sim/campaign/sector-flow.ts';

export type FileExists = (path: string) => boolean;

export class WorldCache implements SectorWorlds {
  readonly #read: ReadFile;
  readonly #exists: FileExists;
  readonly #inputs = new Map<string, TacticalWorldInputs>();

  constructor(read: ReadFile, exists: FileExists) {
    this.#read = read;
    this.#exists = exists;
  }

  exists(path: string): boolean {
    return this.#exists(path);
  }

  world(path: string): TacticalWorld | null {
    const inputs = this.#inputs.get(path);
    return inputs ? buildTacticalWorldFromInputs(inputs) : null;
  }

  async prepare(paths: Iterable<string>): Promise<void> {
    for (const path of new Set(paths)) {
      if (this.#inputs.has(path) || !this.#exists(path)) continue;
      this.#inputs.set(path, await loadTacticalWorldInputs(this.#read, path));
    }
  }
}
