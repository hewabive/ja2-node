import { join } from 'node:path';
import { REPO_ROOT } from '../../src/node/repo.ts';
import { bracedBody, evaluateIntExpression, readSource, STRACCIATELLA_COMMIT, stripCComments, writeTable } from './c-source.ts';

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

function definedExpression(src: string, name: string): number {
  const m = new RegExp(`#define\\s+${name}\\s+([^\\n]+)`).exec(src);
  if (!m) throw new Error(`#define ${name} not found`);
  return evaluateIntExpression(m[1] as string, new Map());
}

function definedFile(src: string, name: string): string {
  const m = new RegExp(`#define\\s+${name}\\s+BINARYDATADIR\\s+"([^"]+)"`).exec(src);
  if (!m) throw new Error(`#define ${name} not found`);
  return `${directory('BINARYDATADIR')}${m[1]}`;
}

function returnedFile(src: string, functionName: string): string {
  const m = new RegExp(`${functionName}\\(\\)\\s*\\{\\s*return\\s+BINARYDATADIR\\s+"([^"]+)"`).exec(src);
  if (!m) throw new Error(`${functionName} not found`);
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

function itemStrings(): Layout {
  const relativePath = 'externalized/strings/ItemStrings.cc';
  const src = code(relativePath);
  return {
    path: returnedFile(src, 'BinaryData::itemsFilename'),
    columns: ['SIZE_SHORT_ITEM_NAME', 'SIZE_ITEM_NAME', 'SIZE_ITEM_INFO'].map((n) => definedExpression(src, n)),
    src: `src/${relativePath} BinaryData::deserialize`,
  };
}

interface DefinedLayout {
  readonly relativePath: string;
  readonly file: string;
  readonly columns: readonly string[];
  readonly record?: string;
  readonly what: string;
}

const SIZE_DEFINES = 'game/Laptop/Insurance_Text.h';
const DEFINED_LAYOUTS: readonly DefinedLayout[] = [
  { relativePath: 'game/Credits.cc', file: 'CRDT_NAME_OF_CREDIT_FILE', columns: ['CREDITS_LINESIZE'], what: 'GetCreditsString' },
  { relativePath: 'game/Laptop/AIM.h', file: 'AIMHISTORYFILE', columns: ['AIM_HISTORY_LINE_SIZE'], what: 'AIMHistory.cc' },
  { relativePath: 'game/Laptop/AIMArchives.cc', file: 'AIM_ALUMNI_NAME_FILE', columns: ['AIM_ALUMNI_NAME_SIZE'], what: 'DrawFaceAndName' },
  {
    relativePath: 'game/Laptop/AIMArchives.cc',
    file: 'AIM_ALUMNI_FILE',
    columns: ['AIM_ALUMNI_FULL_NAME_SIZE', 'AIM_ALUMNI_DECRIPTION_SIZE'],
    record: 'AIM_ALUMNI_FILE_RECORD_SIZE',
    what: 'DisplayAlumniOldMercPopUp',
  },
  { relativePath: 'game/Laptop/AIMPolicies.cc', file: 'AIMPOLICYFILE', columns: ['AIM_POLICY_LINE_SIZE'], what: 'LoadAIMPolicyText' },
  {
    relativePath: 'game/Laptop/BobbyRGuns.h',
    file: 'BOBBYRDESCFILE',
    columns: ['BOBBYR_ITEM_DESC_NAME_SIZE', 'BOBBYR_ITEM_DESC_INFO_SIZE'],
    record: 'BOBBYR_ITEM_DESC_FILE_SIZE',
    what: 'BobbyRGuns.cc',
  },
  {
    relativePath: 'game/Laptop/Insurance.cc',
    file: 'INSURANCE_TEXT_SINGLE_FILE',
    columns: ['INSURANCE_TEXT_SINGLE_LINE_SIZE'],
    what: 'GetInsuranceText',
  },
  {
    relativePath: 'game/Laptop/Insurance.cc',
    file: 'INSURANCE_TEXT_MULTI_FILE',
    columns: ['INSURANCE_TEXT_MULTI_LINE_SIZE'],
    what: 'GetInsuranceText',
  },
  {
    relativePath: 'game/Laptop/Florist_Cards.h',
    file: 'FLOR_CARD_TEXT_FILE',
    columns: ['FLOR_CARD_TEXT_TITLE_SIZE'],
    what: 'Florist_Cards.cc',
  },
  {
    relativePath: 'game/Laptop/Florist_Gallery.h',
    file: 'FLOR_GALLERY_TEXT_FILE',
    columns: ['FLOR_GALLERY_TEXT_TITLE_SIZE', 'FLOR_GALLERY_TEXT_PRICE_SIZE', 'FLOR_GALLERY_TEXT_DESC_SIZE'],
    record: 'FLOR_GALLERY_TEXT_TOTAL_SIZE',
    what: 'Florist_Gallery.cc',
  },
];

function definedLayout(layout: DefinedLayout): Layout {
  const src = `${code(layout.relativePath)}\n${code(SIZE_DEFINES)}`;
  const columns = layout.columns.map((n) => definedExpression(src, n));
  if (layout.record && columns.reduce((a, b) => a + b, 0) !== definedExpression(src, layout.record))
    throw new Error(`${layout.file}: columns do not fill ${layout.record}`);
  return { path: definedFile(src, layout.file), columns, src: `src/${layout.relativePath} ${layout.what}` };
}

function impText(): Layout {
  const relativePath = 'game/Laptop/IMP_Text_System.cc';
  const src = code(relativePath);
  const m = /loadEncryptedString\(\s*BINARYDATADIR\s+"([^"]+)"\s*,\s*\w+\s*\*\s*IMP_SEEK_AMOUNT\s*,\s*IMP_SEEK_AMOUNT\s*\)/.exec(src);
  if (!m) throw new Error('LoadAndDisplayIMPText no longer reads IMP_SEEK_AMOUNT rows');
  return {
    path: `${directory('BINARYDATADIR')}${m[1]}`,
    columns: [definedExpression(src, 'IMP_SEEK_AMOUNT')],
    src: `src/${relativePath} LoadAndDisplayIMPText`,
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
  ...DEFINED_LAYOUTS.map(definedLayout),
  impText(),
  itemStrings(),
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
  source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: src/externalized/strings/EDT.h, ${DEFINED_LAYOUTS.map((l) => `src/${l.relativePath}`).join(', ')}, src/${SIZE_DEFINES}, src/game/Laptop/IMP_Text_System.cc, src/externalized/strings/ItemStrings.cc, src/game/Laptop/EMail.cc, Files.cc, History.cc, src/game/Tactical/Civ_Quotes.cc, src/externalized/content/Dialogs.cc, src/externalized/DefaultContentManager.cc, src/game/Directories.h`,
  license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
  format:
    'files: every EDT file the game reads, as a VFS path, with the record layout its reader uses: columns are UTF-16 code unit widths of one record, in order; {03d} and {02d} stand for a zero-padded number of that many digits, {sector} for a sector short string (row letter and column, e.g. a9)',
  files,
};
const target = join(REPO_ROOT, 'data/tables/edt-layouts.json');
writeTable(target, out);
console.log(`${files.length} EDT layouts → ${target}`);
