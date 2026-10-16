// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Meanwhile.h, Meanwhile.cc gusMeanWhileGridNo, StartMeanwhile; Tactical/QArray.cc
// @src QuoteExp_WitnessDeidrannaDeath, QuoteExp_WitnessQueenBugDeath (transcribed in data/tables/narrative-scenes.json).
// @src See docs/26 §11.2.

import { asArray, asBool, asInt, asObject, asString } from '../strategic/json-fields.ts';
import { parseJsoncBytes } from '../strategic/jsonc.ts';
import type { ReadFile } from '../world/tileset-loader.ts';

export const NARRATIVE_SCENES_PATH = 'tables/narrative-scenes.json';

export interface NarrativeScene {
  readonly id: number;
  readonly name: string;
  readonly flag: number;
  readonly sector: string;
  readonly npcs: readonly string[];
  readonly cameraGridNo: number;
  readonly skippable: boolean;
}

export interface NarrativeScenes {
  readonly scenes: readonly NarrativeScene[];
  readonly deidrannaWitnesses: ReadonlySet<number>;
  readonly queenBugWitnesses: ReadonlySet<number>;
}

export const NO_NARRATIVE_SCENES: NarrativeScenes = { scenes: [], deidrannaWitnesses: new Set(), queenBugWitnesses: new Set() };

function ints(value: unknown, what: string): number[] {
  return asArray(value, what).map((v, i) => asInt(v, `${what}[${i}]`));
}

export function parseNarrativeScenes(json: unknown): NarrativeScenes {
  const root = asObject(json, 'narrative scenes');
  const scenes = asArray(root.scenes, 'narrative scenes.scenes').map((v, i) => {
    const what = `narrative scenes.scenes[${i}]`;
    const o = asObject(v, what);
    return {
      id: asInt(o.id, `${what}.id`),
      name: asString(o.name, `${what}.name`),
      flag: asInt(o.flag, `${what}.flag`),
      sector: asString(o.sector, `${what}.sector`),
      npcs: asArray(o.npcs, `${what}.npcs`).map((n, k) => asString(n, `${what}.npcs[${k}]`)),
      cameraGridNo: asInt(o.cameraGridNo, `${what}.cameraGridNo`),
      skippable: asBool(o.skippable, `${what}.skippable`),
    };
  });
  const witnesses = asObject(root.witnesses, 'narrative scenes.witnesses');
  return {
    scenes,
    deidrannaWitnesses: new Set(ints(witnesses.deidranna, 'witnesses.deidranna')),
    queenBugWitnesses: new Set(ints(witnesses.queenBug, 'witnesses.queenBug')),
  };
}

export async function loadNarrativeScenes(read: ReadFile): Promise<NarrativeScenes> {
  const bytes = await read(NARRATIVE_SCENES_PATH);
  return bytes ? parseNarrativeScenes(parseJsoncBytes(bytes)) : NO_NARRATIVE_SCENES;
}
