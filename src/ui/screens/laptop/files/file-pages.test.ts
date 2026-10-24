import { describe, expect, it } from 'vitest';
import {
  enricoFilePage,
  enricoWidthRecords,
  type FileGeometry,
  FileProfile,
  fileOffset,
  fileProfile,
  firstRecordOnPage,
  lastUnreadFile,
  type Measure,
  NO_FILE_LINE,
  terroristFilePage,
  terroristWidthRecords,
} from './file-pages.ts';

const PAGE = 325;
const GEOMETRY: FileGeometry = { viewerX: 236, viewerY: 81, pageSize: PAGE };

function heights(fixed: number, titleHeight = fixed): { measure: Measure; calls: [number, boolean][] } {
  const calls: [number, boolean][] = [];
  return {
    calls,
    measure: (width, title) => {
      calls.push([width, title]);
      return title ? titleHeight : fixed;
    },
  };
}

const RIS = Array.from({ length: 68 }, (_, i) => `r${i}`);
const FILE = Array.from({ length: 12 }, (_, i) => `t${i}`);

describe('the file pages', () => {
  it('builds the pages record by record until the next record would reach the page size', () => {
    const { measure } = heights(100);
    expect(firstRecordOnPage(FILE, measure, 0, PAGE, [])).toBe(0);
    expect(firstRecordOnPage(FILE, measure, 1, PAGE, [])).toBe(3);
    expect(firstRecordOnPage(FILE, measure, 3, PAGE, [])).toBe(9);
    expect(firstRecordOnPage(FILE, measure, 4, PAGE, [])).toBeNull();
    expect(firstRecordOnPage([], measure, 0, PAGE, [])).toBeNull();
  });

  it('closes the first page of the background report at record 7 and measures the pages with the text font only', () => {
    const { measure, calls } = heights(10, 50);
    expect(firstRecordOnPage(RIS, measure, 1, PAGE, enricoWidthRecords(PAGE))).toBe(7);
    expect(calls.every(([, title]) => !title)).toBe(true);
    const first = enricoFilePage(RIS, measure, 0, GEOMETRY);
    expect(first.lines.map((l) => l.record)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(first.lines[0]).toMatchObject({ title: true, x: 246, y: 85, width: 350 });
    expect(first.lines[1]).toMatchObject({ title: false, y: 85 + 50 });
    expect(first.picture).toBe('map');
    expect(first.onLastPage).toBe(false);
    const second = enricoFilePage(RIS, measure, 1, GEOMETRY);
    expect(second.lines[0]).toMatchObject({ record: 7, title: false, y: 85 });
    expect(second.picture).toBeNull();
  });

  it('puts records 43 and 45 of the report beside the picture', () => {
    const { measure } = heights(10);
    let page = 0;
    while (!enricoFilePage(RIS, measure, page, GEOMETRY).lines.some((l) => l.record === 43)) page++;
    const lines = enricoFilePage(RIS, measure, page, GEOMETRY).lines;
    expect(lines.find((l) => l.record === 43)).toMatchObject({ x: 236 + 150, width: 200 });
    expect(lines.find((l) => l.record === 44)).toMatchObject({ x: 246, width: 350 });
    expect(lines.find((l) => l.record === 45)).toMatchObject({ x: 236 + 150, width: 200 });
  });

  it('marks the last page when every remaining record fits', () => {
    const { measure } = heights(10);
    const last = enricoFilePage(RIS, measure, 2, GEOMETRY);
    expect(last.onLastPage).toBe(true);
    expect(last.lines.at(-1)?.record).toBe(67);
    expect(enricoFilePage(RIS, measure, 9, GEOMETRY)).toMatchObject({ lines: [], onLastPage: true });
  });

  it('draws the portrait before record 4 of a terrorist file and narrows records 4 to 6', () => {
    const { measure, calls } = heights(25);
    const page = terroristFilePage(FILE, measure, 0, GEOMETRY);
    expect(page.portraitBefore).toBe(4);
    expect(page.lines.slice(4, 7).every((l) => l.x === 236 + 180 && l.width === 170)).toBe(true);
    expect(page.lines[7]).toMatchObject({ x: 246, width: 350 });
    expect(page.onLastPage).toBe(true);
    expect(calls.filter(([width]) => width === 170)).toHaveLength(3);
    const tall = heights(100);
    expect(terroristFilePage(FILE, tall.measure, 0, GEOMETRY)).toMatchObject({ portraitBefore: null, onLastPage: false });
    expect(firstRecordOnPage(FILE, tall.measure, 1, PAGE, terroristWidthRecords())).toBe(3);
  });

  it('knows the profile and the records of each file', () => {
    expect(fileProfile(0)).toBeNull();
    expect(fileProfile(1)).toBe(FileProfile.SLAY);
    expect(fileProfile(6)).toBe(FileProfile.DRUGGIST);
    expect([0, 1, 2, 6].map(fileOffset)).toEqual([0, 0, 12, 60]);
  });

  it('opens the last unread file from the new-file icon', () => {
    expect(lastUnreadFile([{ read: true }, { read: false }, { read: true }, { read: false }])).toBe(3);
    expect(lastUnreadFile([{ read: true }])).toBe(NO_FILE_LINE);
  });
});
