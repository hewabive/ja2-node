import { describe, expect, it } from 'vitest';
import { campaignRequest, DEFAULT_CAMPAIGN_FORM, ORIGINAL_OPTIONS, pageUrl, validDeadIsDeadName } from './campaign-form.ts';

describe('new campaign form', () => {
  it("preselects the original's options: easy, sci-fi, reduced guns, save anywhere, blood on", () => {
    expect(ORIGINAL_OPTIONS).toEqual({ difficulty: 1, sciFi: true, gunNut: false, saveMode: 'anywhere', bloodAndGore: true });
    expect(DEFAULT_CAMPAIGN_FORM).toMatchObject({ ...ORIGINAL_OPTIONS, squad: 'default', squadSize: null, land: true, page: 'strategic' });
  });

  it('sends every option, so the API default difficulty never applies', () => {
    const request = campaignRequest(DEFAULT_CAMPAIGN_FORM, null);
    expect(request).toEqual({ ok: true, page: 'strategic', body: { campaign: { options: ORIGINAL_OPTIONS } } });
  });

  it('passes the language, the seed, the squad size and the chosen page', () => {
    const form = {
      ...DEFAULT_CAMPAIGN_FORM,
      difficulty: 3 as const,
      gunNut: true,
      bloodAndGore: false,
      squadSize: 2,
      page: 'tactical' as const,
    };
    expect(campaignRequest(form, 'rus', 7)).toEqual({
      ok: true,
      page: 'tactical',
      body: {
        seed: 7,
        language: 'rus',
        campaign: { options: { difficulty: 3, sciFi: true, gunNut: true, saveMode: 'anywhere', bloodAndGore: false }, mercs: 2 },
      },
    });
  });

  it('starts in the laptop or without landing on the strategic page', () => {
    const laptop = campaignRequest({ ...DEFAULT_CAMPAIGN_FORM, squad: 'laptop', squadSize: 3, page: 'tactical' }, null);
    expect(laptop).toMatchObject({ ok: true, page: 'strategic', body: { campaign: { hire: [] } } });
    expect(laptop.ok && 'mercs' in laptop.body.campaign).toBe(false);
    const noLanding = campaignRequest({ ...DEFAULT_CAMPAIGN_FORM, land: false, page: 'tactical' }, null);
    expect(noLanding).toMatchObject({ ok: true, page: 'strategic', body: { campaign: { land: false } } });
  });

  it('names the Dead is Dead save and refuses names the server would refuse', () => {
    const form = { ...DEFAULT_CAMPAIGN_FORM, saveMode: 'deadIsDead' as const, deadIsDeadName: ' Ironclad_1 ' };
    expect(campaignRequest(form, null)).toMatchObject({ ok: true, body: { campaign: { deadIsDeadName: 'Ironclad_1' } } });
    expect(campaignRequest({ ...form, deadIsDeadName: 'QuickSave' }, null)).toEqual({ ok: false, problem: 'deadIsDeadName' });
    expect(campaignRequest({ ...form, deadIsDeadName: '../x' }, null)).toEqual({ ok: false, problem: 'deadIsDeadName' });
    expect(campaignRequest({ ...DEFAULT_CAMPAIGN_FORM, deadIsDeadName: '../x' }, null).ok).toBe(true);
    expect(validDeadIsDeadName('DeadIsDead')).toBe(true);
    expect(validDeadIsDeadName('-dash')).toBe(false);
  });

  it('refuses a squad size outside 1 to 6', () => {
    expect(campaignRequest({ ...DEFAULT_CAMPAIGN_FORM, squadSize: 7 }, null)).toEqual({ ok: false, problem: 'squadSize' });
    expect(campaignRequest({ ...DEFAULT_CAMPAIGN_FORM, squadSize: 0 }, null)).toEqual({ ok: false, problem: 'squadSize' });
  });

  it('opens the devtools page of the session', () => {
    expect(pageUrl('strategic', 'sandbox-3')).toBe('/src/devtools/strategic/?session=sandbox-3');
    expect(pageUrl('tactical', 'a b')).toBe('/src/devtools/tactical/?session=a%20b');
  });
});
