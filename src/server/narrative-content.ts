import type { MercProfile } from '../content/formats/prof.ts';
import type { ItemTable } from '../content/items/items.ts';
import { DialogueTexts } from '../content/narrative/dialogue-text.ts';
import { type LayerCount, loadNpcRecordContent, type NpcRecordContent } from '../content/narrative/npc-records.ts';
import type { ReadFile } from '../content/world/tileset-loader.ts';
import type { NarrativeSetup } from '../sim/campaign/talk-flow.ts';

interface LoadedNarrative {
  readonly records: NpcRecordContent;
  readonly texts: DialogueTexts;
}

const loaded = new WeakMap<ReadFile, Promise<LoadedNarrative>>();

async function load(read: ReadFile, items: ItemTable, layers: LayerCount | undefined): Promise<LoadedNarrative> {
  const [records, texts] = await Promise.all([
    loadNpcRecordContent({ read, items, ...(layers ? { layerCount: layers } : {}) }),
    DialogueTexts.load(read),
  ]);
  return { records, texts };
}

export function narrativeContent(read: ReadFile, items: ItemTable, layers?: LayerCount): Promise<LoadedNarrative> {
  const known = loaded.get(read);
  if (known) return known;
  const fresh = load(read, items, layers);
  loaded.set(read, fresh);
  return fresh;
}

export async function narrativeSetup(
  read: ReadFile,
  items: ItemTable,
  profiles: readonly MercProfile[],
  layers?: LayerCount,
): Promise<NarrativeSetup & { readonly texts: DialogueTexts }> {
  const { records, texts } = await narrativeContent(read, items, layers);
  return { records, texts, items, profiles };
}
