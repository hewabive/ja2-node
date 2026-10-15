import type { AnimationTables } from '../../content/anim/tables.ts';
import type { AnimationScripts } from '../../content/formats/ja2bin.ts';
import type { MercProfile } from '../../content/formats/prof.ts';
import type { WeaponTable } from '../../content/items/weapons.ts';

export interface TacticalContent {
  readonly scripts: AnimationScripts;
  readonly animations: AnimationTables;
  readonly weapons: WeaponTable;
  readonly profiles: readonly MercProfile[];
}
