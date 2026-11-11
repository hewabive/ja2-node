import { describe, expect, it } from 'vitest';
import { campaignRequest, DEFAULT_CAMPAIGN_FORM, ORIGINAL_OPTIONS, playUrl, validDeadIsDeadName } from './campaign-form.ts';

describe('new campaign form', () => {
  it("preselects the original's options: easy, sci-fi, reduced guns, save anywhere, blood on", () => {
    expect(ORIGINAL_OPTIONS).toEqual({ difficulty: 1, sciFi: true, gunNut: false, saveMode: 'anywhere', bloodAndGore: true });
    expect(DEFAULT_CAMPAIGN_FORM).toMatchObject({ ...ORIGINAL_OPTIONS, squad: 'default', squadSize: null, land: true });
  });

  it('sends every option, so the API default difficulty never applies', () => {
    const request = campaignRequest(DEFAULT_CAMPAIGN_FORM, null);
    expect(request).toEqual({ ok: true, body: { campaign: { options: ORIGINAL_OPTIONS } } });
  });

  it('passes the language, the seed and the squad size', () => {
    const form = {
      ...DEFAULT_CAMPAIGN_FORM,
      difficulty: 3 as const,
      gunNut: true,
      bloodAndGore: false,
      squadSize: 2,
    };
    expect(campaignRequest(form, 'rus', 7)).toEqual({
      ok: true,
      body: {
        seed: 7,
        language: 'rus',
        campaign: { options: { difficulty: 3, sciFi: true, gunNut: true, saveMode: 'anywhere', bloodAndGore: false }, mercs: 2 },
      },
    });
  });

  it('hires in the laptop without a squad size, or starts the squad without landing', () => {
    const laptop = campaignRequest({ ...DEFAULT_CAMPAIGN_FORM, squad: 'laptop', squadSize: 3 }, null);
    expect(laptop).toMatchObject({ ok: true, body: { campaign: { hire: [] } } });
    expect(laptop.ok && 'mercs' in laptop.body.campaign).toBe(false);
    const noLanding = campaignRequest({ ...DEFAULT_CAMPAIGN_FORM, land: false }, null);
    expect(noLanding).toMatchObject({ ok: true, body: { campaign: { land: false } } });
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

  it('sends a typed Dead is Dead description instead of a name, for the server to derive the save name', () => {
    const form = { ...DEFAULT_CAMPAIGN_FORM, saveMode: 'deadIsDead' as const, deadIsDeadDescription: ' Last stand ' };
    const request = campaignRequest(form, null);
    expect(request).toMatchObject({ ok: true, body: { campaign: { deadIsDeadDescription: 'Last stand' } } });
    expect(request.ok && 'deadIsDeadName' in request.body.campaign).toBe(false);
    expect(campaignRequest({ ...form, saveMode: 'anywhere' }, null)).toMatchObject({ ok: true, body: { campaign: {} } });
  });

  it('refuses a squad size outside 1 to 6', () => {
    expect(campaignRequest({ ...DEFAULT_CAMPAIGN_FORM, squadSize: 7 }, null)).toEqual({ ok: false, problem: 'squadSize' });
    expect(campaignRequest({ ...DEFAULT_CAMPAIGN_FORM, squadSize: 0 }, null)).toEqual({ ok: false, problem: 'squadSize' });
  });

  it('opens the game page on the session', () => {
    expect(playUrl('sandbox-3')).toBe('/play?session=sandbox-3');
    expect(playUrl('a b')).toBe('/play?session=a%20b');
  });
});
