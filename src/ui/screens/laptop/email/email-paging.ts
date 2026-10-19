// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/EMail.cc PreProcessEmail (the subject record skipped except for the I.M.P. results, the viewer
// @src centred on the body height and clamped at 0, the minimum of MIN_MESSAGE_HEIGHT_IN_LINES lines, the cap at
// @src MAX_EMAIL_MESSAGE_PAGE_SIZE, the total height + 10, one page below the cap, otherwise pages that never break a
// @src record), GetFirstRecordOnThisPage, GetNumberOfPagesToEmail (counted over the whole record list, the subject
// @src included, one more than the pages), DisplayEmailMessage (the strip tiles, the bottom piece with or without the page
// @src indent), NextMailPage, HandleEmailViewerButtonStates. See docs/28 §9.3.

import { idiv } from '../../../../core/int.ts';

export const MESSAGE_LINES_PER_PAGE = 20;
export const MIN_MESSAGE_HEIGHT_IN_LINES = 5;
export const TOTAL_HEIGHT_MARGIN = 10;

export interface EmailLayoutMetrics {
  readonly lineHeight: number;
  readonly gap: number;
  readonly screenBottom: number;
  readonly viewerY: number;
  readonly bodyStartY: number;
}

export interface EmailPages {
  readonly viewerOffset: number;
  readonly totalHeight: number;
  readonly firstRecords: readonly number[];
  readonly pageCount: number;
  readonly strips: number;
}

export function maxPageHeight(m: EmailLayoutMetrics): number {
  return (m.lineHeight + m.gap) * MESSAGE_LINES_PER_PAGE;
}

function firstRecordOnPage(heights: readonly number[], start: number, page: number, max: number): number | null {
  let record = start;
  if (record >= heights.length) return null;
  for (let current = 0; current < page; current++) {
    let position = 0;
    let advanced = false;
    for (;;) {
      const h = heights[record] ?? 0;
      if (position + h > max) break;
      position += h;
      record++;
      advanced = true;
      if (record >= heights.length) return null;
    }
    if (!advanced) return null;
  }
  return record;
}

export function emailPages(heights: readonly number[], skipsSubject: boolean, m: EmailLayoutMetrics): EmailPages {
  const start = skipsSubject && heights.length > 0 ? 1 : 0;
  const max = maxPageHeight(m);
  let h = 0;
  for (let i = start; i < heights.length; i++) h += heights[i] ?? 0;
  const viewerOffset = Math.max(0, idiv(m.screenBottom - 2 * m.viewerY - 2 * m.bodyStartY - h, 2));
  if (h < m.lineHeight * MIN_MESSAGE_HEIGHT_IN_LINES) h = m.lineHeight * MIN_MESSAGE_HEIGHT_IN_LINES;
  else if (h > max) h = max;
  const totalHeight = h + TOTAL_HEIGHT_MARGIN;
  const firstRecords: number[] = [];
  if (totalHeight < max) {
    if (start < heights.length) firstRecords.push(start);
  } else {
    for (let page = 0; ; page++) {
      const first = firstRecordOnPage(heights, start, page, max);
      if (first === null) break;
      firstRecords.push(first);
    }
  }
  let pageCount = 0;
  if (heights.length > 0) {
    for (let next: number | null = 0; next !== null; pageCount++) next = firstRecordOnPage(heights, 0, pageCount, max);
  }
  const strips = 1 + Math.max(0, Math.floor(totalHeight / m.lineHeight) - 1);
  return { viewerOffset, totalHeight, firstRecords, pageCount, strips };
}

export function onlyOnePage(pages: EmailPages): boolean {
  return pages.pageCount <= 2;
}

export function canGoToNextPage(pages: EmailPages, page: number): boolean {
  return page + 1 < pages.pageCount - 1 && pages.firstRecords[page + 1] !== undefined;
}

export function recordsOfPage(pages: EmailPages, page: number, recordCount: number): readonly number[] {
  const first = pages.firstRecords[page];
  if (first === undefined) return [];
  const next = pages.firstRecords[page + 1] ?? recordCount;
  return Array.from({ length: next - first }, (_, i) => first + i);
}
