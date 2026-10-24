import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { encodeEdtRecords } from '../src/content/formats/edt.ts';
import { loadItemTable } from '../src/content/items/items.ts';
import { mercDialogueFile } from '../src/content/narrative/dialogue-text.ts';
import {
  AIM_BIOS_FILE as AIM_BIOS_PATH,
  PROFILE_PRESENTATION_PATHS,
  parseProfilePresentationTables,
} from '../src/content/narrative/profile-presentation.ts';
import { asArray, asInt, asObject, asString } from '../src/content/strategic/json-fields.ts';
import { parseJsonc } from '../src/content/strategic/jsonc.ts';
import { EDT_LAYOUTS_PATH, EdtLayouts } from '../src/content/text/edt-layouts.ts';
import { PROJECT_DATA_DIR } from '../src/node/repo.ts';

const MERC_QUOTES_TABLE = 'tables/merc-quotes.json';
const LAPTOP_TABLE = 'tables/laptop.json';
const MERC_LINES_FILE = 'text/merc-quotes.json';
const ITEM_TEXT_FILE = 'text/items.json';
const CREDITS_FILE = 'text/credits.json';
const MAIL_FILE = 'text/email.json';
const AIM_HISTORY_FILE = 'text/aimhist.json';
const AIM_BIOS_FILE = 'text/aimbios.json';
const HELP_FILE = 'text/help.json';
const HELP_PATH = 'binarydata/help.edt';
const HELP_CONSTANTS_TABLE = 'tables/ui-constants/HelpScreen.json';
const HELP_RECORD_PREFIX = 'HLP_TXT_';
const AIM_HISTORY_PATH = 'binarydata/aimhist.edt';
const ITEM_TEXT_PATH = 'binarydata/itemdesc.edt';
const CREDITS_PATH = 'binarydata/credits.edt';
const MAIL_PATH = 'binarydata/email.edt';
const NO_QUOTE = 0xffff;
const NICKNAME = '{nickname}';
const MAIL_LENGTH_SUFFIX = '_LENGTH';
const STUB_PROFILES_FILE = 'profiles.json';

export interface StubText {
  readonly written: string[];
  readonly mercDialogue: ReadonlyMap<number, number>;
}

async function dataJson(path: string): Promise<unknown> {
  return parseJsonc(await readFile(join(PROJECT_DATA_DIR, path), 'utf8'));
}

async function stubJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(join(import.meta.dirname, path), 'utf8'));
}

async function put(out: string, path: string, bytes: Uint8Array): Promise<string> {
  await mkdir(dirname(join(out, path)), { recursive: true });
  await writeFile(join(out, path), bytes);
  return path;
}

function strings(value: unknown, what: string): string[] {
  return asArray(value, what).map((v, i) => asString(v, `${what}[${i}]`));
}

function columnsOf(layouts: EdtLayouts, path: string): readonly number[] {
  const layout = layouts.layoutOf(path);
  if (!layout) throw new Error(`no EDT layout for ${path}`);
  return layout.columns;
}

async function quoteKeysInOrder(): Promise<string[]> {
  const keys: string[] = [];
  for (const [i, entry] of asArray(asObject(await dataJson(MERC_QUOTES_TABLE), 'merc quotes').quotes, 'merc quotes').entries()) {
    const q = asObject(entry, `merc quotes[${i}]`);
    const id = asInt(q.id, `merc quotes[${i}].id`);
    if (id !== NO_QUOTE && keys[id] === undefined) keys[id] = asString(q.key, `merc quotes[${i}].key`);
  }
  return Array.from({ length: keys.length }, (_, id) => keys[id] ?? '');
}

async function nicknames(): Promise<Map<number, string>> {
  const profiles = asArray(asObject(await stubJson(STUB_PROFILES_FILE), 'stub profiles').profiles, 'stub profiles');
  return new Map(
    profiles.map((p, i) => {
      const o = asObject(p, `stub profiles[${i}]`);
      return [asInt(o.id, `stub profiles[${i}].id`), asString(o.nickname, `stub profiles[${i}].nickname`)] as const;
    }),
  );
}

async function buildMercDialogue(out: string, layouts: EdtLayouts): Promise<{ written: string[]; rows: Map<number, number> }> {
  const json = asObject(await stubJson(MERC_LINES_FILE), 'stub merc lines');
  const lines = asObject(json.lines, 'stub merc lines.lines');
  const overrides = asObject(json.overrides, 'stub merc lines.overrides');
  const keys = await quoteKeysInOrder();
  const names = await nicknames();
  const written: string[] = [];
  const rows = new Map<number, number>();
  for (const [i, value] of asArray(json.profiles, 'stub merc lines.profiles').entries()) {
    const profile = asInt(value, `stub merc lines.profiles[${i}]`);
    const nickname = names.get(profile);
    if (nickname === undefined) throw new Error(`stub merc lines: profile ${profile} is not a stub profile`);
    const own = overrides[String(profile)] === undefined ? {} : asObject(overrides[String(profile)], `overrides.${profile}`);
    const records = keys.map((key) => {
      const line = own[key] ?? lines[key];
      if (line === undefined) throw new Error(`stub merc lines: no line for ${key}`);
      return [asString(line, `stub merc line ${key}`).replaceAll(NICKNAME, nickname)];
    });
    const path = mercDialogueFile(profile);
    written.push(await put(out, path, encodeEdtRecords(records, columnsOf(layouts, path))));
    rows.set(profile, records.length);
  }
  return { written, rows };
}

async function buildItemText(out: string, layouts: EdtLayouts): Promise<string> {
  const items = await loadItemTable(dataJson);
  const texts = asObject(asObject(await stubJson(ITEM_TEXT_FILE), 'stub item text').items, 'stub item text.items');
  const byIndex = new Map<number, string[]>();
  for (const [name, value] of Object.entries(texts)) {
    const item = items.byName.get(name);
    if (!item) throw new Error(`stub item text: unknown item ${name}`);
    byIndex.set(item.index, strings(value, `stub item text.${name}`));
  }
  const records = Array.from({ length: Math.max(...byIndex.keys()) + 1 }, (_, index) => byIndex.get(index) ?? []);
  return put(out, ITEM_TEXT_PATH, encodeEdtRecords(records, columnsOf(layouts, ITEM_TEXT_PATH)));
}

async function buildCredits(out: string, layouts: EdtLayouts): Promise<string> {
  const rows = strings(asObject(await stubJson(CREDITS_FILE), 'stub credits').rows, 'stub credits.rows');
  return put(
    out,
    CREDITS_PATH,
    encodeEdtRecords(
      rows.map((row) => [row]),
      columnsOf(layouts, CREDITS_PATH),
    ),
  );
}

async function buildMail(out: string, layouts: EdtLayouts): Promise<string> {
  const offsets = asObject(asObject(await dataJson(LAPTOP_TABLE), 'laptop').mail, 'laptop.mail');
  const mails = asObject(asObject(await stubJson(MAIL_FILE), 'stub mail').mails, 'stub mail.mails');
  const rows: string[] = [];
  for (const [name, value] of Object.entries(mails)) {
    const lines = strings(value, `stub mail.${name}`);
    const offset = asInt(offsets[name], `laptop.mail.${name}`);
    const length = asInt(offsets[`${name}${MAIL_LENGTH_SUFFIX}`], `laptop.mail.${name}${MAIL_LENGTH_SUFFIX}`);
    if (lines.length !== length) throw new Error(`stub mail ${name}: ${lines.length} rows, the mail has ${length}`);
    lines.forEach((line, k) => {
      rows[offset + k] = line;
    });
  }
  const records = Array.from({ length: rows.length }, (_, k) => [rows[k] ?? '']);
  return put(out, MAIL_PATH, encodeEdtRecords(records, columnsOf(layouts, MAIL_PATH)));
}

async function buildAimHistory(out: string, layouts: EdtLayouts): Promise<string> {
  const rows = strings(asObject(await stubJson(AIM_HISTORY_FILE), 'stub aim history').rows, 'stub aim history.rows');
  return put(
    out,
    AIM_HISTORY_PATH,
    encodeEdtRecords(
      rows.map((row) => [row]),
      columnsOf(layouts, AIM_HISTORY_PATH),
    ),
  );
}

async function buildAimBios(out: string, layouts: EdtLayouts): Promise<string> {
  const tables = parseProfilePresentationTables({
    aimListings: await dataJson(PROFILE_PRESENTATION_PATHS.aimListings),
    mercListings: await dataJson(PROFILE_PRESENTATION_PATHS.mercListings),
    smallFaces: await dataJson(PROFILE_PRESENTATION_PATHS.smallFaces),
    profileInfo: await dataJson(PROFILE_PRESENTATION_PATHS.profileInfo),
  });
  const bios = asObject(asObject(await stubJson(AIM_BIOS_FILE), 'stub aim bios').bios, 'stub aim bios.bios');
  const records: string[][] = [];
  for (const [profile, value] of Object.entries(bios)) {
    const row = tables.aimBio.get(Number(profile));
    if (row === undefined) throw new Error(`stub aim bios: profile ${profile} has no A.I.M. bio row`);
    records[row] = strings(value, `stub aim bios.${profile}`);
  }
  return put(
    out,
    AIM_BIOS_PATH,
    encodeEdtRecords(
      Array.from({ length: records.length }, (_, row) => records[row] ?? []),
      columnsOf(layouts, AIM_BIOS_PATH),
    ),
  );
}

async function helpRecordNumbers(): Promise<Map<string, number>> {
  const constants = asObject(asObject(await dataJson(HELP_CONSTANTS_TABLE), 'help constants').constants, 'help constants.constants');
  return new Map(
    Object.entries(constants)
      .filter(([name]) => name.startsWith(HELP_RECORD_PREFIX))
      .map(([name, value]) => [name, asInt(value, `help constants.${name}`)] as const),
  );
}

async function buildHelp(out: string, layouts: EdtLayouts): Promise<string> {
  const numbers = await helpRecordNumbers();
  const rows = asObject(asObject(await stubJson(HELP_FILE), 'stub help').rows, 'stub help.rows');
  const records: string[][] = Array.from({ length: Math.max(...numbers.values()) + 1 }, () => ['']);
  for (const [name, row] of numbers) {
    const text = rows[name];
    if (text === undefined) throw new Error(`stub help: no row for ${name}`);
    records[row] = [asString(text, `stub help.${name}`)];
  }
  for (const name of Object.keys(rows)) if (!numbers.has(name)) throw new Error(`stub help: ${name} is not a help record`);
  return put(out, HELP_PATH, encodeEdtRecords(records, columnsOf(layouts, HELP_PATH)));
}

export async function buildStubText(out: string): Promise<StubText> {
  const layouts = EdtLayouts.parse(await dataJson(EDT_LAYOUTS_PATH));
  const merc = await buildMercDialogue(out, layouts);
  const written = [
    ...merc.written,
    await buildItemText(out, layouts),
    await buildCredits(out, layouts),
    await buildMail(out, layouts),
    await buildAimHistory(out, layouts),
    await buildAimBios(out, layouts),
    await buildHelp(out, layouts),
  ];
  return { written, mercDialogue: merc.rows };
}
