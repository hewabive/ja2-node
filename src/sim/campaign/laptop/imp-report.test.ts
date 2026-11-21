import { describe, expect, it } from 'vitest';
import { Personality, SkillTrait } from '../../tactical/soldier.ts';
import { type ImpReportCharacter, impReportRows } from './imp-report.ts';

const AVERAGE = {
  life: 70,
  agility: 70,
  dexterity: 70,
  strength: 70,
  leadership: 70,
  wisdom: 70,
  marksmanship: 70,
  mechanical: 70,
  explosives: 70,
  medical: 70,
};

function character(overrides: Partial<ImpReportCharacter> = {}): ImpReportCharacter {
  return {
    portrait: 1,
    personalityTrait: Personality.NONE,
    attitude: 0,
    skillTrait: SkillTrait.NONE,
    skillTrait2: SkillTrait.NONE,
    stats: AVERAGE,
    ...overrides,
  };
}

function rows(c: ImpReportCharacter, even = false): number[] {
  return impReportRows(c, even).map((r) => r.row);
}

describe('the I.M.P. results mail (HandleIMPCharProfileResultsMessage)', () => {
  it('assembles an average character from the fixed sections', () => {
    const report = impReportRows(character(), false);
    expect(report[0]).toEqual({ row: 0, appendName: true });
    expect(report.filter((r) => r.appendName)).toHaveLength(1);
    expect(rows(character())).toEqual([
      ...[0, 1, 2, 3, 4, 5, 6, 7, 8],
      ...[9, 10, 11, 12, 13, 14],
      15,
      18,
      ...[48, 49, 50, 51, 52],
      53,
      54,
      57,
      ...[105, 106, 107, 108, 109, 110, 111],
      ...[128, 129],
      ...[143, 144, 145, 146, 147, 148, 149],
      ...[175, 176, 177, 178, 179, 180],
      185,
      186,
      ...[226, 227, 228],
    ]);
  });

  it('picks the personality, the attitude and its second paragraph, the insect extra and the big shot fallback', () => {
    const insects = rows(character({ personalityTrait: Personality.FEAR_OF_INSECTS, attitude: 2 }));
    expect(insects.slice(15, 18)).toEqual([35, 38, 39]);
    expect(insects.slice(23, 27)).toEqual([64, 65, 68, 69]);
    const bigShot = rows(character({ attitude: 7 }));
    expect(bigShot.slice(22, 26)).toEqual([48, 49, 52, 53]);
  });

  it('lists the skills, the special traits and the physical extremes in the original order', () => {
    const c = character({
      skillTrait: SkillTrait.KNIFING,
      skillTrait2: SkillTrait.LOCKPICKING,
      stats: {
        ...AVERAGE,
        marksmanship: 85,
        medical: 0,
        mechanical: 45,
        explosives: 0,
        life: 85,
        agility: 45,
        dexterity: 30,
        wisdom: 90,
      },
    });
    const r = rows(c);
    const from = r.indexOf(111) + 1;
    expect(r.slice(from, r.indexOf(175))).toEqual([
      ...[113, 114],
      ...[118, 120],
      ...[123, 127, 126],
      ...[128, 129, 142, 130],
      ...[143, 144, 145, 146, 147, 148, 149],
      ...[150, 151, 156],
      ...[157, 159],
      ...[165, 168],
    ]);
  });

  it('describes the looks by the portrait number alone and the fixed parity choice', () => {
    const looks = (c: ImpReportCharacter, even = false) => rows(c, even).slice(-5, -3);
    expect(looks(character({ portrait: 0, stats: { ...AVERAGE, strength: 40 } }))).toEqual([181, 182]);
    expect(looks(character({ portrait: 0 }), true)).toEqual([183, 184]);
    expect(looks(character({ portrait: 1 }))).toEqual([185, 186]);
    expect(looks(character({ portrait: 7, stats: { ...AVERAGE, strength: 40 } }))).toEqual([201, 202]);
    expect(looks(character({ portrait: 8 }))).toEqual([205, 206]);
    expect(looks(character({ portrait: 14 }), true)).toEqual([223, 224]);
  });

  it("gives the last woman's portrait the portrait section's own opening as her looks, as the switch has no case for it (quirk)", () => {
    const looks = (c: ImpReportCharacter, even = false) => rows(c, even).slice(-5, -3);
    expect(looks(character({ portrait: 15 }))).toEqual([175, 176]);
    expect(looks(character({ portrait: 15 }), true)).toEqual([177, 178]);
  });
});
