import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CORPSES_TABLE_PATH, type CorpseContent, parseCorpseTable, stubCorpseStructureFiles } from '../../src/content/anim/corpses.ts';
import { stubAnimStructures } from '../../src/content/anim/structures.ts';
import { ANIM_CONTROL_PATH, ANIM_SURFACES_PATH, parseAnimationTables } from '../../src/content/anim/tables.ts';
import { parseAnimationScripts } from '../../src/content/formats/ja2bin.ts';
import type { StructureFile } from '../../src/content/formats/jsd.ts';
import { EXPLOSION_ANIMATIONS_PATH, parseExplosionContent, SMOKE_EFFECTS_PATH } from '../../src/content/items/explosions.ts';
import { loadItemTable } from '../../src/content/items/items.ts';
import { type DoorCostTable, parseDoorCostTable } from '../../src/content/world/movement-costs.ts';
import type { TacticalContent } from '../../src/sim/tactical/content.ts';
import { parseMaterialArmour } from '../../src/sim/tactical/load-content.ts';
import { buildStubAnimationScripts } from '../../stubs/anim-scripts.ts';

export const DATA_DIR = join(import.meta.dirname, '../../data');

export function readDataJson(path: string): unknown {
  return JSON.parse(readFileSync(join(DATA_DIR, path), 'utf8'));
}

export function testDoorCosts(): DoorCostTable {
  return parseDoorCostTable(readDataJson('tables/door-costs.json'));
}

function stubCorpseContent(): CorpseContent {
  const table = parseCorpseTable(readDataJson(CORPSES_TABLE_PATH));
  const structures = new Map(
    [...stubCorpseStructureFiles(table)].map(([name, defs]): [string, StructureFile] => [
      name,
      { structureCount: defs.length, auxData: null, tileLocations: [], structures: defs },
    ]),
  );
  return { table, structures };
}

export async function loadTestContent(): Promise<TacticalContent> {
  return {
    scripts: parseAnimationScripts(await buildStubAnimationScripts()),
    animations: parseAnimationTables(readDataJson(ANIM_CONTROL_PATH), readDataJson(ANIM_SURFACES_PATH)),
    animStructures: stubAnimStructures(),
    items: await loadItemTable(async (path) => readDataJson(path)),
    profiles: [],
    materialArmour: parseMaterialArmour(readDataJson('tables/material-armour.json')),
    explosions: parseExplosionContent(readDataJson(EXPLOSION_ANIMATIONS_PATH), readDataJson(SMOKE_EFFECTS_PATH)),
    corpses: stubCorpseContent(),
  };
}
