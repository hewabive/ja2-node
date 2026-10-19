import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withGraphicFacts } from '../content/rules/graphic-facts.ts';
import { loadUiStrings } from '../content/text/strings.ts';
import { vfsFileReader } from '../content/vfs/vfs.ts';
import { type DataVfs, openDataVfs } from '../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../node/repo.ts';
import { impReportRows } from '../sim/campaign/laptop/imp-report.ts';
import { mailSpec, sender } from '../sim/campaign/laptop/mail.ts';
import { createCampaignSession } from './campaign-factory.ts';
import type { CampaignSession } from './campaign-session.ts';

const dataDir = process.env.JA2_DATA_DIR ?? '';
const SEED = 7;

describe.skipIf(!dataDir)('the laptop texts on the original data', () => {
  let data: DataVfs;
  let session: CampaignSession;
  const read = withGraphicFacts((path) => vfsFileReader(data.vfs)(path));

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir });
    session = await createCampaignSession(read, (p) => data.vfs.stat(p) !== undefined, SEED, { hire: [] });
    session.useLabels(await loadUiStrings(read, 'eng'));
  });
  afterAll(async () => {
    await data.close();
  });

  it('renders every starting mail: a subject in the view and one paragraph per body record', () => {
    const laptop = session.view().laptop;
    expect(laptop?.emails.length).toBeGreaterThan(0);
    for (const mail of laptop?.emails ?? []) {
      expect(mail.subject.length).toBeGreaterThan(0);
      const text = session.dispatch({ type: 'emailText', id: mail.id });
      expect(text.ok).toBe(true);
      const body = text.data as { subject: string; paragraphs: string[] };
      expect(body.subject).toBe(mail.subject);
      expect(body.paragraphs).toHaveLength(mail.length - 1);
    }
    expect(laptop?.finances[0]?.text.length).toBeGreaterThan(0);
  });

  it("builds the I.M.P. report from impass.edt with the character's name", () => {
    const intro = session.view().laptop?.emails.find((m) => m.type === 'IMP_EMAIL_INTRO');
    session.dispatch({ type: 'readEmail', id: intro?.id ?? -1 });
    const created = session.dispatch({
      type: 'impCreate',
      code: 'XEP624',
      name: 'Oracle Tester',
      gender: 'male',
      answers: [1, 0, 0, 1, 0, 1, 0, 2, 2, 1, 2, 1, 1, 1, 0, 0],
      attributes: {
        health: 85,
        agility: 75,
        dexterity: 70,
        strength: 80,
        wisdom: 60,
        leadership: 35,
        marksmanship: 75,
        medical: 0,
        mechanical: 40,
        explosives: 0,
      },
      portrait: 0,
      voice: 0,
    });
    expect(created.ok).toBe(true);
    const profile = (created.data as { profile: number }).profile;
    const flow = session.campaign.laptop;
    const record = flow?.profileRecord(profile);
    if (!flow || !record) throw new Error('no character');
    const c = flow.content;
    const mail = flow.mail(mailSpec(c, 'IMP_EMAIL_PROFILE_RESULTS'), sender(c, 'IMP_PROFILE_RESULTS'), { firstData: profile });
    const text = session.dispatch({ type: 'emailText', id: mail.id });
    const report = text.data as { paragraphs: string[] };
    expect(report.paragraphs).toHaveLength(impReportRows({ ...record, initial: record }, c.imp.portraits, mail.id % 2 === 0).length);
    expect(report.paragraphs[0]?.endsWith(' Oracle Tester')).toBe(true);
  });
});
