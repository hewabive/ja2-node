import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ANIM_CONTROL_PATH, ANIM_SURFACES_PATH, parseAnimationTables } from '../../src/content/anim/tables.ts';
import { parseAnimationScripts } from '../../src/content/formats/ja2bin.ts';
import { loadItemTable } from '../../src/content/items/items.ts';
import { type DoorCostTable, parseDoorCostTable } from '../../src/content/world/movement-costs.ts';
import type { TacticalContent } from '../../src/sim/tactical/content.ts';
import { buildStubAnimationScripts } from '../../stubs/anim-scripts.ts';

export const DATA_DIR = join(import.meta.dirname, '../../data');

export function readDataJson(path: string): unknown {
  return JSON.parse(readFileSync(join(DATA_DIR, path), 'utf8'));
}

export function testDoorCosts(): DoorCostTable {
  return parseDoorCostTable(readDataJson('tables/door-costs.json'));
}

export async function loadTestContent(): Promise<TacticalContent> {
  return {
    scripts: parseAnimationScripts(await buildStubAnimationScripts()),
    animations: parseAnimationTables(readDataJson(ANIM_CONTROL_PATH), readDataJson(ANIM_SURFACES_PATH)),
    items: await loadItemTable(async (path) => readDataJson(path)),
    profiles: [],
  };
}
