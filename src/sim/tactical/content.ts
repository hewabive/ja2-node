import type { AnimationTables } from '../../content/anim/tables.ts';
import type { AnimationScripts } from '../../content/formats/ja2bin.ts';
import type { MercProfile } from '../../content/formats/prof.ts';
import type { ItemTable } from '../../content/items/items.ts';

export interface TacticalContent {
  readonly scripts: AnimationScripts;
  readonly animations: AnimationTables;
  readonly items: ItemTable;
  readonly profiles: readonly MercProfile[];
}
