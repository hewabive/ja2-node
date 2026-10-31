import type { CorpseContent } from '../../content/anim/corpses.ts';
import type { AnimStructures } from '../../content/anim/structures.ts';
import type { AnimationTables } from '../../content/anim/tables.ts';
import type { LogicTimeline } from '../../content/anim/timelines.ts';
import type { LockTable } from '../../content/formats/locks.ts';
import type { MercProfile } from '../../content/formats/prof.ts';
import type { ExplosionContent } from '../../content/items/explosions.ts';
import type { ItemTable } from '../../content/items/items.ts';
import type { QuoteSpeakers } from '../../content/narrative/quote-speakers.ts';
import type { LightTemplate } from './lighting/templates.ts';

export interface TacticalContent {
  readonly timeline: LogicTimeline;
  readonly animations: AnimationTables;
  readonly animStructures: AnimStructures;
  readonly items: ItemTable;
  readonly profiles: readonly MercProfile[];
  readonly materialArmour: readonly number[];
  readonly explosions: ExplosionContent;
  readonly corpses: CorpseContent;
  readonly locks: LockTable;
  readonly lightTemplates: ReadonlyMap<string, LightTemplate>;
  readonly quoteSpeakers: QuoteSpeakers;
  readonly sightingBattleSound: boolean;
}
