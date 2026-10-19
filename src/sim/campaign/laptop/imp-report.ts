// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/EMail.cc HandleIMPCharProfileResultsMessage, the IMP_RESULTS_*, IMP_PERSONALITY_*, IMP_ATTITUDE_*,
// @src IMP_SKILLS_*, IMP_PHYSICAL_* and IMP_PORTRAIT_* defines; Laptop/IMP_Compile_Character.cc IMPCharacterHasBigBody,
// @src FindIMPPortraitByFace; Tactical/Soldier_Profile_Type.h SUPER_STAT_VALUE and the other thresholds. The Random(32767)
// @src parity that picks one of the two looks paragraphs is the caller's fixed choice. See docs/21 §6.1.

import { Personality, SkillTrait } from '../../tactical/soldier.ts';

const SUPER_STAT_VALUE = 80;
const NEEDS_TRAINING_STAT_VALUE = 50;
const NO_CHANCE_IN_HELL_STAT_VALUE = 40;
const SUPER_SKILL_VALUE = 80;
const NEEDS_TRAINING_SKILL_VALUE = 50;
const NO_CHANCE_IN_HELL_SKILL_VALUE = 0;
const BIG_BODY_MIN_STRENGTH = 75;
const MALE = 0;

const INTRO_LENGTH = 9;
const PERSONALITY_INTRO = INTRO_LENGTH;
const PERSONALITY_INTRO_LENGTH = 5;
const PERSONALITY_NORMAL = PERSONALITY_INTRO + PERSONALITY_INTRO_LENGTH;
const PERSONALITY_LENGTH = 4;
const PERSONALITY_HEAT = PERSONALITY_NORMAL + PERSONALITY_LENGTH;
const PERSONALITY_NERVOUS = PERSONALITY_HEAT + PERSONALITY_LENGTH;
const PERSONALITY_CLAUSTROPHOBIC = PERSONALITY_NERVOUS + PERSONALITY_LENGTH;
const PERSONALITY_NONSWIMMER = PERSONALITY_CLAUSTROPHOBIC + PERSONALITY_LENGTH;
const PERSONALITY_FEAR_OF_INSECTS = PERSONALITY_NONSWIMMER + PERSONALITY_LENGTH;
const PERSONALITY_FORGETFUL = PERSONALITY_FEAR_OF_INSECTS + PERSONALITY_LENGTH + 1;
const PERSONALITY_PSYCHO = PERSONALITY_FORGETFUL + PERSONALITY_LENGTH;
const ATTITUDE_INTRO = PERSONALITY_PSYCHO + PERSONALITY_LENGTH + 1;
const ATTITUDE_INTRO_LENGTH = 5;
const ATTITUDE_LENGTH = 5;
const ATTITUDE_NORMAL = ATTITUDE_INTRO + ATTITUDE_INTRO_LENGTH;
const ATTITUDE_FRIENDLY = ATTITUDE_NORMAL + ATTITUDE_LENGTH;
const ATTITUDE_LONER = ATTITUDE_FRIENDLY + ATTITUDE_LENGTH + 1;
const ATTITUDE_OPTIMIST = ATTITUDE_LONER + ATTITUDE_LENGTH + 1;
const ATTITUDE_PESSIMIST = ATTITUDE_OPTIMIST + ATTITUDE_LENGTH + 1;
const ATTITUDE_AGGRESSIVE = ATTITUDE_PESSIMIST + ATTITUDE_LENGTH + 1;
const ATTITUDE_ARROGANT = ATTITUDE_AGGRESSIVE + ATTITUDE_LENGTH + 1;
const ATTITUDE_ASSHOLE = ATTITUDE_ARROGANT + ATTITUDE_LENGTH + 1;
const ATTITUDE_COWARD = ATTITUDE_ASSHOLE + ATTITUDE_LENGTH;
const SKILLS = ATTITUDE_COWARD + ATTITUDE_LENGTH + 1;
const SKILLS_LENGTH = 7;
const IMPERIAL_SKILLS = SKILLS + SKILLS_LENGTH + 1;
const NEED_TRAIN_SKILLS = IMPERIAL_SKILLS + 5;
const NO_SKILL = NEED_TRAIN_SKILLS + 5;
const SKILL_OFFSET = { marksmanship: 1, mechanical: 2, explosives: 3, medical: 4 } as const;
const SPECIAL_INTRO = NO_SKILL + 5;
const SPECIAL_INTRO_LENGTH = 2;
const SPECIAL_LOCK = SPECIAL_INTRO + SPECIAL_INTRO_LENGTH;
const PHYSICAL = SPECIAL_LOCK + 13;
const PHYSICAL_LENGTH = 7;
const PHYSICAL_SUPER = PHYSICAL + PHYSICAL_LENGTH;
const PHYSICAL_LOW = PHYSICAL_SUPER + 7;
const PHYSICAL_VERY_LOW = PHYSICAL_LOW + 8;
const PHYSICAL_END = PHYSICAL_VERY_LOW + 7;
const PHYSICAL_END_LENGTH = 3;
const PORTRAIT = PHYSICAL_END + PHYSICAL_END_LENGTH;
const PORTRAIT_LENGTH = 6;
const PORTRAIT_MALE_1 = PORTRAIT + PORTRAIT_LENGTH;
const PORTRAIT_STEP = 4;
const PORTRAIT_FEMALE_1 = PORTRAIT_MALE_1 + 6 * PORTRAIT_STEP;
const RESULTS_END = PORTRAIT_FEMALE_1 + 5 * PORTRAIT_STEP + 1;
const RESULTS_END_LENGTH = 3;
const LOOKS_RECORDS = 2;
const LOOKS_ALTERNATIVE = 2;

const PERSONALITY_OFFSETS: Readonly<Record<number, number>> = {
  [Personality.NONE]: PERSONALITY_NORMAL,
  [Personality.HEAT_INTOLERANT]: PERSONALITY_HEAT,
  [Personality.NERVOUS]: PERSONALITY_NERVOUS,
  [Personality.CLAUSTROPHOBIC]: PERSONALITY_CLAUSTROPHOBIC,
  [Personality.NONSWIMMER]: PERSONALITY_NONSWIMMER,
  [Personality.FEAR_OF_INSECTS]: PERSONALITY_FEAR_OF_INSECTS,
  [Personality.FORGETFUL]: PERSONALITY_FORGETFUL,
  [Personality.PSYCHO]: PERSONALITY_PSYCHO,
};

const Attitude = {
  NORMAL: 0,
  FRIENDLY: 1,
  LONER: 2,
  OPTIMIST: 3,
  PESSIMIST: 4,
  AGGRESSIVE: 5,
  ARROGANT: 6,
  ASSHOLE: 8,
  COWARD: 9,
} as const;

const ATTITUDE_OFFSETS: Readonly<Record<number, number>> = {
  [Attitude.NORMAL]: ATTITUDE_NORMAL,
  [Attitude.FRIENDLY]: ATTITUDE_FRIENDLY,
  [Attitude.LONER]: ATTITUDE_LONER,
  [Attitude.OPTIMIST]: ATTITUDE_OPTIMIST,
  [Attitude.PESSIMIST]: ATTITUDE_PESSIMIST,
  [Attitude.AGGRESSIVE]: ATTITUDE_AGGRESSIVE,
  [Attitude.ARROGANT]: ATTITUDE_ARROGANT,
  [Attitude.ASSHOLE]: ATTITUDE_ASSHOLE,
  [Attitude.COWARD]: ATTITUDE_COWARD,
};

const SPECIAL_TRAITS: readonly (readonly [number, number])[] = [
  [SkillTrait.KNIFING, SPECIAL_LOCK + 12],
  [SkillTrait.LOCKPICKING, SPECIAL_LOCK],
  [SkillTrait.HANDTOHAND, SPECIAL_LOCK + 1],
  [SkillTrait.ELECTRONICS, SPECIAL_LOCK + 2],
  [SkillTrait.NIGHTOPS, SPECIAL_LOCK + 3],
  [SkillTrait.THROWING, SPECIAL_LOCK + 4],
  [SkillTrait.TEACHING, SPECIAL_LOCK + 5],
  [SkillTrait.HEAVY_WEAPS, SPECIAL_LOCK + 6],
  [SkillTrait.AUTO_WEAPS, SPECIAL_LOCK + 7],
  [SkillTrait.STEALTHY, SPECIAL_LOCK + 8],
  [SkillTrait.AMBIDEXT, SPECIAL_LOCK + 9],
  [SkillTrait.THIEF, SPECIAL_LOCK + 10],
  [SkillTrait.MARTIALARTS, SPECIAL_LOCK + 11],
];

type Skill = keyof typeof SKILL_OFFSET;
type Physical = 'life' | 'agility' | 'dexterity' | 'strength' | 'leadership' | 'wisdom';

const SKILL_ORDERS = {
  imperial: ['marksmanship', 'medical', 'mechanical', 'explosives'],
  needsTraining: ['marksmanship', 'medical', 'mechanical', 'explosives'],
  noSkill: ['mechanical', 'marksmanship', 'medical', 'explosives'],
} as const satisfies Readonly<Record<string, readonly Skill[]>>;

const PHYSICAL_OFFSETS: Readonly<Record<'super' | 'low' | 'veryLow', Readonly<Record<Physical, number>>>> = {
  super: { life: 1, agility: 2, dexterity: 3, strength: 4, leadership: 5, wisdom: 6 },
  low: { life: 1, agility: 2, dexterity: 4, strength: 5, leadership: 6, wisdom: 7 },
  veryLow: { life: 1, agility: 2, dexterity: 3, strength: 4, leadership: 5, wisdom: 6 },
};
const PHYSICAL_ORDER: readonly Physical[] = ['life', 'dexterity', 'strength', 'agility', 'wisdom', 'leadership'];

export interface ImpReportStats {
  readonly life: number;
  readonly agility: number;
  readonly dexterity: number;
  readonly strength: number;
  readonly leadership: number;
  readonly wisdom: number;
  readonly marksmanship: number;
  readonly mechanical: number;
  readonly explosives: number;
  readonly medical: number;
}

export interface ImpReportCharacter {
  readonly sex: number;
  readonly faceIndex: number;
  readonly personalityTrait: number;
  readonly attitude: number;
  readonly skillTrait: number;
  readonly skillTrait2: number;
  readonly initial: ImpReportStats;
}

export interface ImpReportPortrait {
  readonly face: number;
  readonly bigBody: boolean;
}

export interface ImpReportRecord {
  readonly row: number;
  readonly appendName: boolean;
}

function range(first: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => first + i);
}

function hasSkillTrait(c: ImpReportCharacter, trait: number): boolean {
  return c.skillTrait === trait || c.skillTrait2 === trait;
}

function skillSection(header: number, order: readonly Skill[], test: (value: number) => boolean, initial: ImpReportStats): number[] {
  const held = order.filter((skill) => test(initial[skill]));
  return held.length === 0 ? [] : [header, ...held.map((skill) => header + SKILL_OFFSET[skill])];
}

function physicalSection(
  header: number,
  offsets: Readonly<Record<Physical, number>>,
  test: (value: number) => boolean,
  initial: ImpReportStats,
): number[] {
  const held = PHYSICAL_ORDER.filter((stat) => test(initial[stat]));
  return held.length === 0 ? [] : [header, ...held.map((stat) => header + offsets[stat])];
}

function personalityRows(c: ImpReportCharacter): number[] {
  const offset = PERSONALITY_OFFSETS[c.personalityTrait] ?? PERSONALITY_INTRO;
  const rows = [...range(PERSONALITY_INTRO, PERSONALITY_INTRO_LENGTH + 1), offset + 1, offset + PERSONALITY_LENGTH];
  if (c.personalityTrait === Personality.FEAR_OF_INSECTS) rows.push(offset + PERSONALITY_LENGTH + 1);
  return rows;
}

function attitudeRows(c: ImpReportCharacter): number[] {
  const offset = ATTITUDE_OFFSETS[c.attitude] ?? ATTITUDE_INTRO;
  const rows = [...range(ATTITUDE_INTRO, ATTITUDE_INTRO_LENGTH), offset, offset + 1, offset + ATTITUDE_LENGTH - 1];
  if (offset !== ATTITUDE_NORMAL) rows.push(offset + ATTITUDE_LENGTH);
  return rows;
}

function skillRows(c: ImpReportCharacter): number[] {
  const s = c.initial;
  return [
    ...range(SKILLS, SKILLS_LENGTH),
    ...skillSection(IMPERIAL_SKILLS, SKILL_ORDERS.imperial, (v) => v >= SUPER_SKILL_VALUE, s),
    ...skillSection(
      NEED_TRAIN_SKILLS,
      SKILL_ORDERS.needsTraining,
      (v) => v > NO_CHANCE_IN_HELL_SKILL_VALUE && v <= NEEDS_TRAINING_SKILL_VALUE,
      s,
    ),
    ...skillSection(NO_SKILL, SKILL_ORDERS.noSkill, (v) => v <= NO_CHANCE_IN_HELL_SKILL_VALUE, s),
    ...range(SPECIAL_INTRO, SPECIAL_INTRO_LENGTH),
    ...SPECIAL_TRAITS.flatMap(([trait, row]) => (hasSkillTrait(c, trait) ? [row] : [])),
  ];
}

function physicalRows(c: ImpReportCharacter): number[] {
  const s = c.initial;
  return [
    ...range(PHYSICAL, PHYSICAL_LENGTH),
    ...physicalSection(PHYSICAL_SUPER, PHYSICAL_OFFSETS.super, (v) => v >= SUPER_STAT_VALUE, s),
    ...physicalSection(PHYSICAL_LOW, PHYSICAL_OFFSETS.low, (v) => v < NEEDS_TRAINING_STAT_VALUE && v > NO_CHANCE_IN_HELL_STAT_VALUE, s),
    ...physicalSection(PHYSICAL_VERY_LOW, PHYSICAL_OFFSETS.veryLow, (v) => v <= NO_CHANCE_IN_HELL_STAT_VALUE, s),
  ];
}

export function impPortraitIndex(portraits: readonly ImpReportPortrait[], face: number): number {
  return portraits.findIndex((p) => p.face === face);
}

export function impHasBigBody(c: ImpReportCharacter, portraits: readonly ImpReportPortrait[]): boolean {
  if (c.sex !== MALE) return false;
  const portrait = portraits[impPortraitIndex(portraits, c.faceIndex)];
  return portrait?.bigBody === true && c.initial.strength >= BIG_BODY_MIN_STRENGTH;
}

function looksOffset(c: ImpReportCharacter, portraits: readonly ImpReportPortrait[]): number {
  const big = impHasBigBody(c, portraits);
  const male = (n: number) => PORTRAIT_MALE_1 + (n - 1) * PORTRAIT_STEP;
  const female = (n: number) => PORTRAIT_FEMALE_1 + (n - 1) * PORTRAIT_STEP;
  switch (impPortraitIndex(portraits, c.faceIndex)) {
    case 0:
      return big ? male(1) : male(2);
    case 1:
      return male(2);
    case 2:
      return male(3);
    case 3:
      return male(4);
    case 4:
    case 5:
      return male(5);
    case 6:
    case 7:
      return big ? male(6) : male(2);
    case 8:
      return female(1);
    case 9:
      return female(2);
    case 10:
      return female(3);
    case 11:
    case 12:
      return female(4);
    case 13:
    case 14:
      return female(5);
    default:
      return c.sex !== MALE ? female(1) : big ? male(1) : male(2);
  }
}

export function impReportRows(c: ImpReportCharacter, portraits: readonly ImpReportPortrait[], evenLooks: boolean): ImpReportRecord[] {
  const looks = looksOffset(c, portraits) + (evenLooks ? LOOKS_ALTERNATIVE : 0);
  const rows = [
    ...range(1, INTRO_LENGTH - 1),
    ...personalityRows(c),
    ...attitudeRows(c),
    ...skillRows(c),
    ...physicalRows(c),
    ...range(PORTRAIT, PORTRAIT_LENGTH),
    ...range(looks, LOOKS_RECORDS),
    ...range(RESULTS_END, RESULTS_END_LENGTH),
  ];
  return [{ row: 0, appendName: true }, ...rows.map((row) => ({ row, appendName: false }))];
}
