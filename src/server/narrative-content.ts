import type { MercProfile } from '../content/formats/prof.ts';
import type { ItemTable } from '../content/items/items.ts';
import { DialogueTexts } from '../content/narrative/dialogue-text.ts';
import {
  type LayerCount,
  loadNpcRecordContent,
  NPCDATA_DIR,
  type NpcRecordContent,
  STUB_PREFIX,
} from '../content/narrative/npc-records.ts';
import { loadNarrativeScenes, type NarrativeScenes } from '../content/narrative/scenes.ts';
import { type DataDecoding, DEFAULT_DATA_DECODING } from '../content/text/data-version.ts';
import type { ReadFile } from '../content/world/tileset-loader.ts';
import type { NarrativeSetup } from '../sim/campaign/talk-flow.ts';

interface LoadedNarrative {
  readonly records: NpcRecordContent;
  readonly texts: DialogueTexts;
  readonly scenes: NarrativeScenes;
}

const loaded = new WeakMap<ReadFile, Map<string, Promise<LoadedNarrative>>>();

const ORIGINAL_RECORDS = `${NPCDATA_DIR}/000.npc`;

async function narrativeSource(read: ReadFile): Promise<ReadFile> {
  if ((await read(ORIGINAL_RECORDS)) === null) return read;
  return (path) => (path.startsWith(STUB_PREFIX) ? Promise.resolve(null) : read(path));
}

async function load(base: ReadFile, items: ItemTable, layers: LayerCount | undefined, decoding: DataDecoding): Promise<LoadedNarrative> {
  const read = await narrativeSource(base);
  const [records, texts, scenes] = await Promise.all([
    loadNpcRecordContent({ read, items, layout: decoding.npcRecords, ...(layers ? { layerCount: layers } : {}) }),
    DialogueTexts.load(read, decoding.edt),
    loadNarrativeScenes(read),
  ]);
  return { records, texts, scenes };
}

function decodingKey(decoding: DataDecoding): string {
  return `${decoding.edt}/${decoding.npcRecords}`;
}

export function narrativeContent(
  read: ReadFile,
  items: ItemTable,
  layers?: LayerCount,
  decoding: DataDecoding = DEFAULT_DATA_DECODING,
): Promise<LoadedNarrative> {
  const byDecoding = loaded.get(read) ?? new Map<string, Promise<LoadedNarrative>>();
  loaded.set(read, byDecoding);
  const key = decodingKey(decoding);
  const known = byDecoding.get(key);
  if (known) return known;
  const fresh = load(read, items, layers, decoding);
  byDecoding.set(key, fresh);
  return fresh;
}

export async function narrativeSetup(
  read: ReadFile,
  items: ItemTable,
  profiles: readonly MercProfile[],
  layers?: LayerCount,
  decoding: DataDecoding = DEFAULT_DATA_DECODING,
): Promise<NarrativeSetup & { readonly texts: DialogueTexts }> {
  const { records, texts, scenes } = await narrativeContent(read, items, layers, decoding);
  return { records, texts, items, profiles, scenes };
}
