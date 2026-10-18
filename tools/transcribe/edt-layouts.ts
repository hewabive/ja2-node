import { join } from 'node:path';
import { REPO_ROOT } from '../../src/node/repo.ts';
import { bracedBody, readSource, STRACCIATELLA_COMMIT, stripCComments, writeTable } from './c-source.ts';

interface Layout {
  readonly path: string;
  readonly columns: readonly number[];
  readonly src: string;
}

const SECTOR_PLACEHOLDER = '{sector}';

function code(relativePath: string): string {
  return stripCComments(readSource(relativePath));
}

const directories = code('game/Directories.h');

function directory(macro: string): string {
  const m = new RegExp(`#define\\s+${macro}\\s+"([^"]+)"`).exec(directories);
  if (!m) throw new Error(`${macro} not found`);
  return m[1] as string;
}

function defined(src: string, name: string): number {
  const m = new RegExp(`#define\\s+${name}\\s+(\\d+)\\b`).exec(src);
  if (!m) throw new Error(`#define ${name} not found`);
  return Number(m[1]);
}

function constant(src: string, name: string): number {
  const m = new RegExp(`constexpr\\s+uint32_t\\s+${name}\\s*=\\s*(\\d+)\\s*;`).exec(src);
  if (!m) throw new Error(`constexpr ${name} not found`);
  return Number(m[1]);
}

function constantFile(src: string, name: string): string {
  const m = new RegExp(`constexpr\\s+const\\s+char\\s*\\*\\s*${name}\\s*=\\s*BINARYDATADIR\\s+"([^"]+)"`).exec(src);
  if (!m) throw new Error(`constexpr ${name} not found`);
  return `${directory('BINARYDATADIR')}${m[1]}`;
}

function edtFilesTable(): Layout[] {
  const src = code('externalized/strings/EDT.h');
  const body = bracedBody(src, 'static inline EDTFilesTable const EDTFilesTable[]');
  return [...body.matchAll(/\{\s*BINARYDATADIR\s+"([^"]+)"\s*,\s*\{([^}]*)\}\s*\}/g)].map((m) => ({
    path: `${directory('BINARYDATADIR')}${m[1]}`,
    columns: (m[2] as string).split(',').map((s) => Number(s.trim())),
    src: 'src/externalized/strings/EDT.h EDTFilesTable',
  }));
}

function itemStrings(): Layout[] {
  const src = code('externalized/ItemModel.cc');
  const item = ['BINARY_SIZE_ITEM_NAME', 'BINARY_SIZE_SHORT_ITEM_NAME', 'BINARY_SIZE_ITEM_INFO'].map((n) => constant(src, n));
  const bobbyRay = ['BINARY_SIZE_BOBBYR_ITEM_NAME', 'BINARY_SIZE_BOBBYR_ITEM_INFO'].map((n) => constant(src, n));
  return [
    { path: constantFile(src, 'BINARY_STRING_FILE'), columns: item, src: 'src/externalized/ItemModel.cc ItemStrings' },
    { path: constantFile(src, 'BINARY_STRING_BOBBYR_FILE'), columns: bobbyRay, src: 'src/externalized/ItemModel.cc ItemStrings' },
  ];
}

function bioStrings(relativePath: string, what: string): Layout {
  const src = code(relativePath);
  return {
    path: constantFile(src, 'BINARY_STRING_FILE'),
    columns: ['BINARY_DESCRIPTION_SIZE', 'BINARY_ADDITIONAL_INFORMATION_SIZE'].map((n) => constant(src, n)),
    src: `src/${relativePath} ${what}`,
  };
}

function encryptedStringReaders(relativePath: string, what: string): Layout[] {
  const src = code(relativePath);
  return [...src.matchAll(/loadEncryptedString\(\s*BINARYDATADIR\s+"([^"]+)"\s*,\s*(\w+)\s*\*/g)].map((m) => ({
    path: `${directory('BINARYDATADIR')}${m[1]}`,
    columns: [defined(src, m[2] as string)],
    src: `src/${relativePath} ${what}`,
  }));
}

function fileListReaders(): Layout[] {
  const relativePath = 'game/Laptop/Files.cc';
  const src = code(relativePath);
  const reader = bracedBody(src, 'static FileString* LoadStringsIntoFileList(');
  const width = /loadEncryptedString\(\s*filename\s*,\s*(\w+)\s*\*\s*offset\s*,\s*\1\s*\)/.exec(reader);
  if (!width) throw new Error('LoadStringsIntoFileList no longer reads fixed-width rows');
  return [...src.matchAll(/LoadStringsIntoFileList\(\s*BINARYDATADIR\s+"([^"]+)"/g)].map((m) => ({
    path: `${directory('BINARYDATADIR')}${m[1]}`,
    columns: [defined(src, width[1] as string)],
    src: `src/${relativePath} LoadStringsIntoFileList`,
  }));
}

function civQuoteFiles(): Layout[] {
  const relativePath = 'game/Tactical/Civ_Quotes.cc';
  const src = code(relativePath);
  const width = defined(src, 'CIV_QUOTE_TEXT_SIZE');
  const paths = new Set<string>();
  for (const m of src.matchAll(/ST::format\(\s*NPCDATADIR\s+"([^"]+)"\s*,\s*([^)]+)\)/g)) {
    const name = m[1] as string;
    const sector = name.includes('{}');
    if (sector && !(m[2] as string).includes('AsShortString')) throw new Error(`unexpected civ quote file argument ${m[2]}`);
    paths.add(`${directory('NPCDATADIR')}${sector ? name.replace('{}', SECTOR_PLACEHOLDER) : name}`);
  }
  if (paths.size === 0) throw new Error('no civ quote files found');
  return [...paths].map((path) => ({ path, columns: [width], src: `src/${relativePath} GetCivQuoteText` }));
}

function dialogueFiles(): Layout[] {
  const width = defined(code('externalized/DefaultContentManager.cc'), 'DIALOGUESIZE');
  const body = bracedBody(code('externalized/content/Dialogs.cc'), 'ST::string Content::GetDialogueTextFilename(');
  return [...body.matchAll(/ST::format\(\s*"\{\}\/([^"]+)"\s*,\s*(\w+)\s*,/g)].map((m) => ({
    path: `${directory(m[2] as string)}/${m[1]}`,
    columns: [width],
    src: 'src/externalized/content/Dialogs.cc GetDialogueTextFilename, DefaultContentManager.cc DIALOGUESIZE',
  }));
}

const layouts: Layout[] = [
  ...edtFilesTable(),
  ...itemStrings(),
  bioStrings('externalized/mercs/AIMListingModel.cc', 'BioStrings'),
  bioStrings('externalized/mercs/MERCListingModel.cc', 'BioStrings'),
  ...encryptedStringReaders('game/Laptop/EMail.cc', 'LoadEMailText, LoadIMPResultText'),
  ...fileListReaders(),
  ...encryptedStringReaders('game/Laptop/History.cc', 'GetQuestStartedString, GetQuestEndedString'),
  ...civQuoteFiles(),
  ...dialogueFiles(),
];
const unique = new Map<string, Layout>();
for (const layout of layouts) {
  const known = unique.get(layout.path);
  if (known && known.columns.join() !== layout.columns.join()) throw new Error(`${layout.path} has two layouts`);
  if (!known) unique.set(layout.path, layout);
}
const files = [...unique.values()];
if (files.some((f) => f.columns.length === 0 || f.columns.some((w) => !Number.isInteger(w) || w <= 0))) throw new Error('bad column width');

const out = {
  source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: src/externalized/strings/EDT.h, src/externalized/ItemModel.cc, src/externalized/mercs/AIMListingModel.cc, MERCListingModel.cc, src/game/Laptop/EMail.cc, Files.cc, History.cc, src/game/Tactical/Civ_Quotes.cc, src/externalized/content/Dialogs.cc, src/externalized/DefaultContentManager.cc, src/game/Directories.h`,
  license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
  format:
    'files: every EDT file the game reads, as a VFS path, with the record layout its reader uses: columns are UTF-16 code unit widths of one record, in order; {03d} and {02d} stand for a zero-padded number of that many digits, {sector} for a sector short string (row letter and column, e.g. a9)',
  files,
};
const target = join(REPO_ROOT, 'data/tables/edt-layouts.json');
writeTable(target, out);
console.log(`${files.length} EDT layouts → ${target}`);
