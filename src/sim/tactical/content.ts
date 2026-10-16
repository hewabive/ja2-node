import type { CorpseContent } from '../../content/anim/corpses.ts';
import type { AnimStructures } from '../../content/anim/structures.ts';
import type { AnimationTables } from '../../content/anim/tables.ts';
import type { AnimationScripts } from '../../content/formats/ja2bin.ts';
import type { LockTable } from '../../content/formats/locks.ts';
import type { MercProfile } from '../../content/formats/prof.ts';
import type { ExplosionContent } from '../../content/items/explosions.ts';
import type { ItemTable } from '../../content/items/items.ts';

export interface TacticalContent {
  readonly scripts: AnimationScripts;
  readonly animations: AnimationTables;
  readonly animStructures: AnimStructures;
  readonly items: ItemTable;
  readonly profiles: readonly MercProfile[];
  readonly materialArmour: readonly number[];
  readonly explosions: ExplosionContent;
  readonly corpses: CorpseContent;
  readonly locks: LockTable;
}
