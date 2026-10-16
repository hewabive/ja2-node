import { CORPSES_TABLE_PATH, loadCorpseContent } from '../../content/anim/corpses.ts';
import { loadAnimStructures } from '../../content/anim/structures.ts';
import { ANIM_CONTROL_PATH, ANIM_SURFACES_PATH, parseAnimationTables } from '../../content/anim/tables.ts';
import { FormatError } from '../../content/binary/errors.ts';
import { ANIMATION_SCRIPTS_PATH, parseAnimationScripts } from '../../content/formats/ja2bin.ts';
import { decodeLockTable, emptyLockTable, LOCKS_PATH, type LockTable, STUB_LOCKS_PATH } from '../../content/formats/locks.ts';
import { PROFILES_PATH, parseProfiles } from '../../content/formats/prof.ts';
import { loadExplosionContent } from '../../content/items/explosions.ts';
import { loadItemTable } from '../../content/items/items.ts';
import type { ReadFile } from '../../content/world/tileset-loader.ts';
import type { TacticalContent } from './content.ts';

export const MATERIAL_ARMOUR_PATH = 'tables/material-armour.json';

export function parseMaterialArmour(json: unknown): number[] {
  const armour = (json as { armour?: unknown }).armour;
  if (!Array.isArray(armour)) throw new FormatError('malformed material armour table');
  return armour.map(Number);
}

export const STUB_ANIMATION_SCRIPTS_PATH = `stubs/${ANIMATION_SCRIPTS_PATH}`;

async function json(read: ReadFile, path: string): Promise<unknown> {
  const bytes = await read(path);
  if (!bytes) throw new FormatError(`missing ${path}`);
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function loadLockTable(read: ReadFile): Promise<LockTable> {
  const bytes = (await read(LOCKS_PATH)) ?? (await read(STUB_LOCKS_PATH));
  return bytes ? decodeLockTable(bytes) : emptyLockTable();
}

export async function loadTacticalContent(read: ReadFile): Promise<TacticalContent> {
  const scriptBytes = (await read(ANIMATION_SCRIPTS_PATH)) ?? (await read(STUB_ANIMATION_SCRIPTS_PATH));
  if (!scriptBytes) throw new FormatError(`missing ${ANIMATION_SCRIPTS_PATH} (and no stub pack)`);
  const [control, surfaces, items, profileBytes, animStructures, material, explosions, corpses, locks] = await Promise.all([
    json(read, ANIM_CONTROL_PATH),
    json(read, ANIM_SURFACES_PATH),
    loadItemTable((path) => json(read, path)),
    read(PROFILES_PATH),
    loadAnimStructures(read),
    json(read, MATERIAL_ARMOUR_PATH),
    loadExplosionContent(read),
    json(read, CORPSES_TABLE_PATH).then((table) => loadCorpseContent(read, table)),
    loadLockTable(read),
  ]);
  return {
    scripts: parseAnimationScripts(scriptBytes),
    animations: parseAnimationTables(control, surfaces),
    animStructures,
    items,
    profiles: profileBytes ? parseProfiles(profileBytes) : [],
    materialArmour: parseMaterialArmour(material),
    explosions,
    corpses,
    locks,
  };
}
