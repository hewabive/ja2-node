import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_DATA_DIR } from '../../../../tests/support/original-data.ts';
import { withGraphicFacts } from '../../../content/rules/graphic-facts.ts';
import { vfsFileReader } from '../../../content/vfs/vfs.ts';
import { type DataVfs, openDataVfs } from '../../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../../node/repo.ts';
import { createCampaignSession } from '../../../server/campaign-factory.ts';
import type { CampaignSession } from '../../../server/campaign-session.ts';
import { detectDataVersion } from '../../../server/data-version.ts';
import { TextService } from '../../../server/text-service.ts';
import { Bookmark } from '../../../sim/campaign/laptop/laptop-state.ts';
import { portraitPath } from '../../widgets/portrait.ts';
import { voiceSample } from './imp/imp-looks.ts';
import { questionRecord } from './imp/imp-quiz.ts';
import { IMP_TEXT_FILE } from './imp/imp-site.ts';
import { SPECK } from './merc/merc-pages.ts';

const dataDir = ORIGINAL_DATA_DIR;
const SEED = 11;
const IMP_QUESTION_1 = 54;
const IMP_PERS_F1 = 144;
const IMP_CON_3 = 208;
const ATTRIBUTE_LABELS = [164, 166, 165, 167, 169, 168, 170, 172, 173, 171];
const SPECK_REPLY_QUOTES = [9, 14, 45, 46, 69, 70, 71];
const RECORDS = { firstQuestion: IMP_QUESTION_1, lastFinishRecord: IMP_CON_3 };

describe.skipIf(!dataDir)('the U11 laptop pages on the original data', () => {
  let data: DataVfs;
  let session: CampaignSession;
  let texts: TextService;
  const read = withGraphicFacts((path) => vfsFileReader(data.vfs)(path));

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir });
    session = await createCampaignSession(read, (p) => data.vfs.stat(p) !== undefined, SEED, { hire: [] });
    texts = new TextService({ vfs: data.vfs, dataVersion: detectDataVersion(data.vfs, true, {}).version });
  });
  afterAll(async () => {
    await data.close();
  });

  async function row(file: string, record: number): Promise<string> {
    const found = await texts.edtRecord(file, record);
    return found.ok ? (found.record.columns[0] ?? '') : '';
  }

  it("lays the quiz out in imptext.edt as the answer counts say, men's and women's questions alike", async () => {
    const counts = session.view().laptop?.imp.quizAnswers ?? [];
    expect(counts).toHaveLength(16);
    for (const male of [true, false])
      for (let q = 0; q < counts.length; q++) {
        const record = questionRecord(q, counts, male, RECORDS);
        expect(await row(IMP_TEXT_FILE, record), `question ${q + 1} ${male ? 'male' : 'female'}`).not.toBe('');
        for (let a = 1; a <= (counts[q] ?? 0); a++) expect(await row(IMP_TEXT_FILE, record + a), `q${q + 1} a${a}`).not.toBe('');
      }
    expect(questionRecord(counts.length, counts, true, RECORDS)).toBeLessThanOrEqual(IMP_PERS_F1);
    const firstFemaleAnswer = await row(IMP_TEXT_FILE, questionRecord(0, counts, false, RECORDS) + 1);
    expect(firstFemaleAnswer).not.toBe(await row(IMP_TEXT_FILE, IMP_QUESTION_1 + 1));
    for (const record of ATTRIBUTE_LABELS) expect(await row(IMP_TEXT_FILE, record)).not.toBe('');
  });

  it('finds the I.M.P. faces, portraits and voice samples', () => {
    const imp = session.view().laptop?.imp;
    for (const face of [...(imp?.portraits.male ?? []), ...(imp?.portraits.female ?? [])]) {
      expect(data.vfs.stat(portraitPath(face, 'big')), `big ${face}`).toBeDefined();
      expect(data.vfs.stat(portraitPath(face, 'small')), `small ${face}`).toBeDefined();
    }
    for (const profile of [...(imp?.voices.male ?? []), ...(imp?.voices.female ?? [])])
      expect(data.vfs.stat(voiceSample(profile)), `voice ${profile}`).toBeDefined();
  });

  it("has a line for every quote Speck says in the replies and on the first visit, and Speck's face", async () => {
    session.campaign.state.laptop.bookmarks.push(Bookmark.MERC);
    const reply = session.dispatch({ type: 'visitSite', site: 'merc' });
    const opening = (reply.data as { speck?: number[] } | undefined)?.speck ?? [];
    expect(opening.length).toBeGreaterThan(0);
    const file = `npcdata/${String(SPECK).padStart(3, '0')}.edt`;
    for (const quote of [...opening, ...SPECK_REPLY_QUOTES]) expect(await row(file, quote), `quote ${quote}`).not.toBe('');
    expect(data.vfs.stat(portraitPath(SPECK, 'small'))).toBeDefined();
  });
});
