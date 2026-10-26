import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../../tests/support/original-data.ts';
import { type DataVfs, openDataVfs } from '../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import { TextService } from '../../server/text-service.ts';
import { CREDITS_FILE, FIRST_CREDIT_ROW, INITIAL_CREDIT_STYLE, readCreditRow } from './credits.ts';

const CREDIT_ROWS = 248;

describe.skipIf(!ORIGINAL_DATA_DIR)('credits of the original data', () => {
  let data: DataVfs;

  beforeAll(async () => {
    data = await openDataVfs({ dataDir: ORIGINAL_DATA_DIR, projectDataDir: PROJECT_DATA_DIR });
  });
  afterAll(async () => {
    await data.close();
  });

  it('reads every row of credits.edt with known control codes only', async () => {
    const texts = new TextService({ vfs: data.vfs, dataVersion: 'english' });
    let style = INITIAL_CREDIT_STYLE;
    let row = FIRST_CREDIT_ROW;
    let titles = 0;
    let lines = 0;
    for (; ; row++) {
      const found = await texts.edtRecord(CREDITS_FILE, row);
      if (!found.ok) break;
      const parsed = readCreditRow(found.record.columns[0] ?? '', style);
      expect(parsed.unknownCodes, `row ${row}`).toEqual([]);
      style = parsed.style;
      if (parsed.node?.title) titles++;
      else if (parsed.node) lines++;
    }
    expect(row).toBe(CREDIT_ROWS);
    expect(titles).toBeGreaterThan(10);
    expect(lines).toBeGreaterThan(titles);
  });
});
