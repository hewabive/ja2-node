import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { encodeEdtFile } from '../src/content/formats/edt.ts';
import { encodeNpcRecords } from '../src/content/formats/npc.ts';
import { NPC_RECORD_PATHS, npcRecordPath, parseProfileInfo, scriptRecordsFromJson } from '../src/content/narrative/npc-records.ts';
import { asArray, asInt, asObject, asString } from '../src/content/strategic/json-fields.ts';
import { parseJsonc } from '../src/content/strategic/jsonc.ts';
import { PROJECT_DATA_DIR } from '../src/node/repo.ts';

const RECORDS_FILE = 'npc/records.json';
const TEXT_FILE = 'npc/text.json';
const RECRUITED_FILE = 'npcdata/000.npc';

async function write(out: string, path: string, bytes: Uint8Array): Promise<string> {
  await mkdir(dirname(join(out, path)), { recursive: true });
  await writeFile(join(out, path), bytes);
  return path;
}

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function buildStubNpcData(out: string): Promise<string[]> {
  const info = parseProfileInfo(parseJsonc(await readFile(join(PROJECT_DATA_DIR, NPC_RECORD_PATHS.profileInfo), 'utf8')));
  const env = { items: { byName: new Map<string, { readonly index: number }>() }, profiles: info.ids };
  const records = asObject(await json(join(import.meta.dirname, RECORDS_FILE)), 'stub npc records');
  const written: string[] = [];
  for (const [i, entry] of asArray(records.scripts, 'stub npc records.scripts').entries()) {
    const o = asObject(entry, `stub npc records.scripts[${i}]`);
    const profile = asInt(o.profile, `stub npc records.scripts[${i}].profile`);
    written.push(await write(out, npcRecordPath(profile), encodeNpcRecords(scriptRecordsFromJson(env, o, `stub npc ${profile}`))));
  }
  written.push(await write(out, RECRUITED_FILE, encodeNpcRecords(scriptRecordsFromJson(env, records.recruited, 'stub recruited'))));
  const text = asObject(await json(join(import.meta.dirname, TEXT_FILE)), 'stub npc text');
  for (const [path, rows] of Object.entries(asObject(text.files, 'stub npc text.files'))) {
    const lines = asArray(rows, `stub npc text ${path}`).map((l, k) => asString(l, `stub npc text ${path}[${k}]`));
    written.push(await write(out, path, encodeEdtFile(lines)));
  }
  return written;
}
