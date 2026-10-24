// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Files.cc GetFirstStringOnThisPage (the pages built record by record with IanWrappedStringHeight at
// @src the width of each record's width record, a height adjustment equal to the page size closing the page),
// @src CreateWidthRecordsForAruloIntelFile, CreateWidthRecordsForTerroristFile, HandleSpecialFiles (the title font for the
// @src first record of page 0, record FILES_COUNTER_1_WIDTH starting page 1, records FILES_COUNTER_2_WIDTH and
// @src FILES_COUNTER_3_WIDTH beside a picture, the pictures of pages 0, 4 and 5), HandleSpecialTerroristFile (records 4-6
// @src beside the portrait drawn when record 4 is reached on page 0), the "gonna get cut off" stop and
// @src fOnLastFilesPageFlag, OpenFirstUnreadFile (the last unread file: the loop has no break), g_file_info. See docs/28 §9.3.

export const ENRICO_FILE = 0;
export const NO_FILE_LINE = -1;
export const SLAY_LENGTH = 12;
export const LENGTH_OF_ENRICO_FILE = 68;
export const FILES_COUNTER_1_WIDTH = 7;
export const FILES_COUNTER_2_WIDTH = 43;
export const FILES_COUNTER_3_WIDTH = 45;
const FULL_WIDTH = 350;
const PICTURE_COLUMN_WIDTH = 200;
const PORTRAIT_COLUMN_WIDTH = 170;
const TEXT_INDENT = 10;
const PICTURE_COLUMN_INDENT = 150;
const PORTRAIT_COLUMN_INDENT = 180;
const TEXT_TOP = 4;
const PORTRAIT_RECORD = 4;
const PORTRAIT_RECORDS_END = 7;
const MAP_PAGE = 0;
const KID_PAGE = 4;
const WEDDING_PAGE = 5;

export const FileProfile = { SLAY: 64, ANNIE: 82, CHRIS: 83, TIFFANY: 110, T_REX: 111, DRUGGIST: 112 } as const;

const FILE_PROFILES: readonly (number | null)[] = [
  null,
  FileProfile.SLAY,
  FileProfile.ANNIE,
  FileProfile.CHRIS,
  FileProfile.TIFFANY,
  FileProfile.T_REX,
  FileProfile.DRUGGIST,
];

export interface WidthRecord {
  readonly record: number;
  readonly width: number;
  readonly heightAdjustment: number;
}

export type Measure = (width: number, title: boolean, text: string) => number;

export interface FileGeometry {
  readonly viewerX: number;
  readonly viewerY: number;
  readonly pageSize: number;
}

export interface FileLine {
  readonly record: number;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly title: boolean;
}

export type FilePicture = 'map' | 'kid' | 'wedding';

export interface FilePage {
  readonly lines: readonly FileLine[];
  readonly portraitBefore: number | null;
  readonly picture: FilePicture | null;
  readonly onLastPage: boolean;
}

export function enricoWidthRecords(pageSize: number): WidthRecord[] {
  return [
    { record: FILES_COUNTER_1_WIDTH, width: FULL_WIDTH, heightAdjustment: pageSize },
    { record: FILES_COUNTER_2_WIDTH, width: PICTURE_COLUMN_WIDTH, heightAdjustment: 0 },
    { record: FILES_COUNTER_3_WIDTH, width: PICTURE_COLUMN_WIDTH, heightAdjustment: 0 },
  ];
}

export function terroristWidthRecords(): WidthRecord[] {
  return [4, 5, 6].map((record) => ({ record, width: PORTRAIT_COLUMN_WIDTH, heightAdjustment: 0 }));
}

export function fileProfile(code: number): number | null {
  return FILE_PROFILES[code] ?? null;
}

export function fileOffset(code: number): number {
  return code === ENRICO_FILE ? 0 : SLAY_LENGTH * (code - 1);
}

export function fileLength(code: number): number {
  return code === ENRICO_FILE ? LENGTH_OF_ENRICO_FILE : SLAY_LENGTH;
}

function applyWidthRecords(counter: number, base: number, position: number, widths: readonly WidthRecord[], pageSize: number) {
  let width = base;
  let pos = position;
  for (const w of widths) {
    if (counter !== w.record) continue;
    width = w.width;
    if (w.heightAdjustment === pageSize) {
      if (pos !== 0) pos += pageSize - pos;
    } else pos += w.heightAdjustment;
  }
  return { width, pos };
}

export function firstRecordOnPage(
  records: readonly string[],
  measure: Measure,
  page: number,
  pageSize: number,
  widths: readonly WidthRecord[],
): number | null {
  if (records.length === 0) return null;
  let current = 0;
  let counter = 0;
  for (let currentPage = 0; currentPage < page; currentPage++) {
    let { width, pos } = applyWidthRecords(counter, FULL_WIDTH, 0, widths, pageSize);
    for (;;) {
      const text = records[current];
      if (text === undefined) return null;
      const h = measure(width, false, text);
      if (pos + h >= pageSize) break;
      pos += h;
      current++;
      counter++;
      ({ width, pos } = applyWidthRecords(counter, FULL_WIDTH, pos, widths, pageSize));
    }
  }
  return current < records.length ? current : null;
}

function picture(page: number): FilePicture | null {
  if (page === MAP_PAGE) return 'map';
  if (page === KID_PAGE) return 'kid';
  return page === WEDDING_PAGE ? 'wedding' : null;
}

interface Column {
  readonly x: number;
  readonly width: number;
}

function layoutPage(
  records: readonly string[],
  measure: Measure,
  page: number,
  g: FileGeometry,
  widths: readonly WidthRecord[],
  column: (record: number, y: number) => { readonly column: Column; readonly y: number },
  portraitAt: number | null,
): Omit<FilePage, 'picture'> {
  const start = firstRecordOnPage(records, measure, page, g.pageSize, widths);
  const lines: FileLine[] = [];
  let portraitBefore: number | null = null;
  let index = start ?? records.length;
  let y = 0;
  for (; index < records.length; index++) {
    if (page === 0 && index === portraitAt) portraitBefore = lines.length;
    const title = page === 0 && index === 0;
    const placed = column(index, y);
    y = placed.y;
    const text = records[index] ?? '';
    const h = measure(placed.column.width, title, text);
    if (y + h >= g.pageSize) break;
    lines.push({ record: index, text, x: placed.column.x, y: g.viewerY + TEXT_TOP + y, width: placed.column.width, title });
    y += h;
  }
  return { lines, portraitBefore, onLastPage: index >= records.length };
}

export function enricoFilePage(records: readonly string[], measure: Measure, page: number, g: FileGeometry): FilePage {
  const full: Column = { x: g.viewerX + TEXT_INDENT, width: FULL_WIDTH };
  const beside: Column = { x: g.viewerX + PICTURE_COLUMN_INDENT, width: PICTURE_COLUMN_WIDTH };
  const placed = layoutPage(
    records,
    measure,
    page,
    g,
    enricoWidthRecords(g.pageSize),
    (record, y) => {
      if (record === FILES_COUNTER_1_WIDTH) return { column: full, y: page === 0 ? g.pageSize : y };
      if (record === FILES_COUNTER_2_WIDTH || record === FILES_COUNTER_3_WIDTH) return { column: beside, y };
      return { column: full, y };
    },
    null,
  );
  return { ...placed, picture: picture(page) };
}

export function terroristFilePage(records: readonly string[], measure: Measure, page: number, g: FileGeometry): FilePage {
  const full: Column = { x: g.viewerX + TEXT_INDENT, width: FULL_WIDTH };
  const beside: Column = { x: g.viewerX + PORTRAIT_COLUMN_INDENT, width: PORTRAIT_COLUMN_WIDTH };
  const placed = layoutPage(
    records,
    measure,
    page,
    g,
    terroristWidthRecords(),
    (record, y) => ({ column: record >= PORTRAIT_RECORD && record < PORTRAIT_RECORDS_END ? beside : full, y }),
    PORTRAIT_RECORD,
  );
  return { ...placed, picture: null };
}

export function lastUnreadFile(files: readonly { readonly read: boolean }[]): number {
  let line = NO_FILE_LINE;
  files.forEach((f, i) => {
    if (!f.read) line = i;
  });
  return line;
}
