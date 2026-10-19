import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { stubFontSet } from '../../../../../tests/support/ui-fonts.ts';
import { fontHeight } from '../../../text/bitmap-font.ts';
import { FontName, type FontSet } from '../../../text/fonts.ts';
import { ianWrappedStringHeight } from '../../../text/wrap.ts';
import { canGoToNextPage, type EmailLayoutMetrics, emailPages, maxPageHeight, onlyOnePage, recordsOfPage } from './email-paging.ts';

const METRICS: EmailLayoutMetrics = { lineHeight: 10, gap: 2, screenBottom: 427, viewerY: 91, bodyStartY: 163 };
const STUB_MAILS = join(import.meta.dirname, '../../../../../stubs/text/email.json');
const MESSAGE_WIDTH = 403;
const MESSAGE_GAP = 2;

describe('email paging', () => {
  it('fits a short mail on one page with the minimum height and the original page count', () => {
    const pages = emailPages([12, 24, 12], true, METRICS);
    expect(pages.viewerOffset).toBe(0);
    expect(pages.totalHeight).toBe(METRICS.lineHeight * 5 + 10);
    expect(pages.firstRecords).toEqual([1]);
    expect(pages.pageCount).toBe(2);
    expect(onlyOnePage(pages)).toBe(true);
    expect(recordsOfPage(pages, 0, 3)).toEqual([1, 2]);
    expect(pages.strips).toBe(6);
  });

  it('breaks a long mail between records and counts its pages over the whole list, the subject included', () => {
    const max = maxPageHeight(METRICS);
    const heights = [12, 100, 100, 100, 100];
    const pages = emailPages(heights, true, METRICS);
    expect(max).toBe(240);
    expect(pages.totalHeight).toBe(max + 10);
    expect(pages.firstRecords).toEqual([1, 3]);
    expect(pages.pageCount).toBe(3);
    expect(onlyOnePage(pages)).toBe(false);
    expect(recordsOfPage(pages, 0, heights.length)).toEqual([1, 2]);
    expect(recordsOfPage(pages, 1, heights.length)).toEqual([3, 4]);
    expect(canGoToNextPage(pages, 0)).toBe(true);
    expect(canGoToNextPage(pages, 1)).toBe(false);
  });

  it('keeps the I.M.P. report from its first record', () => {
    const pages = emailPages([60, 60, 60], false, METRICS);
    expect(pages.firstRecords).toEqual([0]);
    expect(pages.pageCount).toBe(2);
  });

  describe('on the stub fonts', () => {
    let fonts: FontSet;

    beforeAll(async () => {
      fonts = await stubFontSet();
    });

    it('pages the stub I.M.P. intro mail in two', async () => {
      const mails = JSON.parse(await readFile(STUB_MAILS, 'utf8')) as { mails: Record<string, string[]> };
      const records = mails.mails.IMP_EMAIL_INTRO ?? [];
      const font = fonts.get(FontName.FONT10ARIAL);
      const bold = fonts.get(FontName.FONT10ARIALBOLD);
      const heights = records.map((r) => ianWrappedStringHeight(MESSAGE_WIDTH, MESSAGE_GAP, font, r, bold));
      const pages = emailPages(heights, true, { ...METRICS, lineHeight: fontHeight(font), gap: MESSAGE_GAP });
      expect(pages.pageCount - 1).toBe(2);
      expect(pages.firstRecords).toHaveLength(2);
    });
  });
});
