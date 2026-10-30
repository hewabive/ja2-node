// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/IMP_Compile_Character.cc IsIMPSlot, GetNumberOfIMPCharactersCreated, GetIMPSlotInProgress,
// @src CanCreateAnotherIMPCharacter, MarkIMPCharacterCreated, IMPCharacterHasBigBody, CreateACharacterFromPlayerEnteredStats,
// @src CreatePlayerAttitude, AddAnAttitudeToAttitudeList, AddSkillToSkillList, RemoveSkillFromSkillsList, ValidateSkillsList,
// @src CreatePlayerSkills, AddAPersonalityToPersonalityList, CreatePlayerPersonality, SelectMercFace,
// @src HandleMercStatsForChangesInFace; IMP_Personality_Quiz.cc CompileQuestionsInStatsAndWhatNot (table in data/tables);
// @src IMP_SkillTraits.cc AddSelectedSkillsToSkillsList, DoesPlayerHaveExtraAttibutePointsToDistributeBasedOnSkillSelection,
// @src ShouldTraitBeSkipped; IMP_Attribute_Selection.cc SetAttributes, IncrementStat, DecrementStat, the attribute enum (the
// @src page's value order); IMP_Begin_Screen.cc
// @src BtnIMPBeginScreenDoneCallback (names); IMP_HomePage.cc ProcessPlayerInputActivationString; IMP_MainPage.cc (begin);
// @src IMP_Confirm.cc AddCharacterToPlayersTeam, BtnIMPConfirmYes, FirstFreeBigEnoughPocket, GiveItemsToPC; CharProfile.h
// @src COST_OF_PROFILE; externalized/policy/IMPPolicy.h IMPItemCondition.

import { type MercProfile, zeroProfileNpcFields } from '../../../content/formats/prof.ts';
import { MercType } from '../../../content/strategic/economy-content.ts';
import type { ImpCondition, ImpItemSet, QuizEffect } from '../../../content/strategic/laptop-content.ts';
import { i8, idiv, u8 } from '../../../core/int.ts';
import { InsertionCode } from '../../strategic/forces/constants.ts';
import { EventKind } from '../../strategic/time/constants.ts';
import { addFutureDayStrategicEvent } from '../../strategic/time/event-queue.ts';
import { InvSlot } from '../../tactical/inventory.ts';
import { MercStatus, type ProfileProgress, progressFromProfile } from '../../tactical/profiles.ts';
import { Body, Personality, SKILL_TRAIT_BONUS, SkillTrait } from '../../tactical/soldier.ts';
import { addTransaction, FinanceCode } from '../finances.ts';
import { NUM_PROFILES } from '../profiles.ts';
import { MercKind, type RosterMerc } from '../roster.ts';
import type { LaptopContext } from './context.ts';
import { type HireHooks, hireMercCore, MAX_MERCS_ON_TEAM, numberOfMercsOnPlayerTeam } from './hire.ts';
import { Bookmark } from './laptop-state.ts';
import { History } from './records.ts';

export const COST_OF_PROFILE = 3000;
const QUIZ_QUESTIONS = 16;
const LIST_SIZE = 20;
export const START_ATTRIBUTE = 55;
const EMPTY_PROFILE_LIFE = 15;
const EMPTY_PROFILE_STAT = 1;
const EMPTY_PROFILE_NEED_FOR_SLEEP = 7;
const NAME_LENGTH = 29;
const NICKNAME_LENGTH = 8;
const BIG_BODY_MIN_STRENGTH = 75;
const LOCKPICKING_THRESHOLD = 50;
const PERCENT = 100;
const RANDOM_100 = 'RND100';
const SKILL_CONDITION = 'SKILL';
const MAX_DIRECT_SKILLS = 2;
const NO_EXPERT_LEVEL: ReadonlySet<number> = new Set([SkillTrait.ELECTRONICS, SkillTrait.AMBIDEXT, SkillTrait.CAMOUFLAGED]);
const DIRECT_PICK_BONUS = { none: 10, oneWithoutExpert: 5 } as const;
const IMP_SKILL_ORDER: readonly number[] = [
  SkillTrait.LOCKPICKING,
  SkillTrait.HANDTOHAND,
  SkillTrait.ELECTRONICS,
  SkillTrait.NIGHTOPS,
  SkillTrait.THROWING,
  SkillTrait.TEACHING,
  SkillTrait.HEAVY_WEAPS,
  SkillTrait.AUTO_WEAPS,
  SkillTrait.STEALTHY,
  SkillTrait.AMBIDEXT,
  SkillTrait.KNIFING,
  SkillTrait.ONROOF,
  SkillTrait.CAMOUFLAGED,
  SkillTrait.MARTIALARTS,
];
const NUM_ATTITUDES = 10;
const ATT_NORMAL = 0;
const RESULTS_MAIL_MINUTE = 7 * 60;
const RESULTS_MAIL_DAYS = 2;
const ATTRIBUTE_NAMES: Readonly<Record<string, (p: ProfileProgress) => number>> = {
  AGILITY: (p) => p.stats.agility,
  DEXTERITY: (p) => p.stats.dexterity,
  STRENGTH: (p) => p.stats.strength,
  LEADERSHIP: (p) => p.stats.leadership,
  WISDOM: (p) => p.stats.wisdom,
  EXPLEVEL: (p) => p.stats.experience,
  MARKSMANSHIP: (p) => p.stats.marksmanship,
  EXPLOSIVES: (p) => p.stats.explosives,
  MECHANICAL: (p) => p.stats.mechanical,
  MEDICAL: (p) => p.stats.medical,
};
const SKILL_NAMES: Readonly<Record<string, number>> = {
  NONE: SkillTrait.NONE,
  LOCKPICKING: SkillTrait.LOCKPICKING,
  HANDTOHAND: SkillTrait.HANDTOHAND,
  ELECTRONICS: SkillTrait.ELECTRONICS,
  NIGHTOPS: SkillTrait.NIGHTOPS,
  THROWING: SkillTrait.THROWING,
  TEACHING: SkillTrait.TEACHING,
  HEAVY_WEAPS: SkillTrait.HEAVY_WEAPS,
  AUTO_WEAPS: SkillTrait.AUTO_WEAPS,
  STEALTHY: SkillTrait.STEALTHY,
  AMBIDEXT: SkillTrait.AMBIDEXT,
  THIEF: SkillTrait.THIEF,
  MARTIALARTS: SkillTrait.MARTIALARTS,
  KNIFING: SkillTrait.KNIFING,
  ONROOF: SkillTrait.ONROOF,
  CAMOUFLAGED: SkillTrait.CAMOUFLAGED,
};
export const IMP_ATTRIBUTE_KEYS = [
  'health',
  'agility',
  'dexterity',
  'strength',
  'wisdom',
  'leadership',
  'marksmanship',
  'medical',
  'mechanical',
  'explosives',
] as const;
export type ImpAttributeKey = (typeof IMP_ATTRIBUTE_KEYS)[number];
export const IMP_ZEROABLE_ATTRIBUTES: readonly ImpAttributeKey[] = ['marksmanship', 'medical', 'mechanical', 'explosives'];
const ZEROABLE: ReadonlySet<ImpAttributeKey> = new Set(IMP_ZEROABLE_ATTRIBUTES);
export const IMP_ATTRIBUTE_PAGE_ORDER: readonly ImpAttributeKey[] = [
  'health',
  'dexterity',
  'agility',
  'strength',
  'wisdom',
  'leadership',
  'marksmanship',
  'explosives',
  'medical',
  'mechanical',
];

export type ImpAttributes = Readonly<Record<ImpAttributeKey, number>>;

export interface ImpRequest {
  readonly code: string;
  readonly name: string;
  readonly nickname?: string | undefined;
  readonly gender: 'male' | 'female';
  readonly answers?: readonly number[] | undefined;
  readonly skills?: readonly number[] | undefined;
  readonly attributes: ImpAttributes;
  readonly portrait: number;
  readonly voice: number;
}

export type ImpRefusal =
  | 'noBookmark'
  | 'badCode'
  | 'noSlot'
  | 'funds'
  | 'teamFull'
  | 'badName'
  | 'badAnswers'
  | 'badSkills'
  | 'badAttributes'
  | 'badPortrait'
  | 'badVoice'
  | 'cannotHire';

export interface ImpLists {
  readonly skills: number[];
  readonly attitudes: number[];
  readonly personalities: number[];
}

export type ImpResult =
  | {
      readonly ok: true;
      readonly merc: RosterMerc;
      readonly profile: number;
      readonly arrival: number;
      readonly skills: readonly [number, number];
      readonly personality: number;
      readonly attitude: number;
    }
  | { readonly ok: false; readonly reason: ImpRefusal };

function isImpSlot(ctx: LaptopContext, profile: number): boolean {
  const type = ctx.mercType(profile);
  return type === undefined || type === MercType.IMP;
}

export function impCharactersCreated(ctx: LaptopContext): number {
  return ctx.laptop.imp.taken.filter((id) => isImpSlot(ctx, id)).length;
}

export function impSlotInProgress(ctx: LaptopContext): number | null {
  for (let id = 0; id < NUM_PROFILES; id++) if (isImpSlot(ctx, id) && !ctx.laptop.imp.taken.includes(id)) return id;
  return null;
}

export function canCreateAnotherImpCharacter(ctx: LaptopContext): boolean {
  if (impSlotInProgress(ctx) === null) return false;
  return impCharactersCreated(ctx) < ctx.content.imp.maxCharacters;
}

export type ImpCodeCheck = 'ok' | 'badCode' | 'noSlot';

export function impCheckCode(ctx: LaptopContext, code: string): ImpCodeCheck {
  const accepted = ctx.content.imp.codes.includes(code);
  if (accepted && canCreateAnotherImpCharacter(ctx)) return 'ok';
  return accepted ? 'noSlot' : 'badCode';
}

export function impBeginRefusal(ctx: LaptopContext): 'funds' | 'teamFull' | null {
  if (ctx.state.finances.balance < COST_OF_PROFILE) return 'funds';
  if (numberOfMercsOnPlayerTeam(ctx) >= MAX_MERCS_ON_TEAM) return 'teamFull';
  return null;
}

function addToList(list: number[], value: number): void {
  if (list.length < LIST_SIZE) list.push(value);
}

export function compileQuiz(ctx: LaptopContext, answers: readonly number[], male: boolean): ImpLists {
  const lists: ImpLists = { skills: [], attitudes: [], personalities: [] };
  ctx.content.impQuiz.forEach((question, q) => {
    const effect: QuizEffect | null | undefined = question[answers[q] ?? -1];
    if (!effect) return;
    if ('male' in effect) addToList(lists.skills, male ? effect.male : effect.female);
    else if (effect.list === 'skill') addToList(lists.skills, effect.value);
    else if (effect.list === 'attitude') addToList(lists.attitudes, effect.value);
    else if (effect.value === Personality.PSYCHO) addToList(lists.personalities, effect.value);
  });
  return lists;
}

function directSkillList(skills: readonly number[]): number[] {
  return IMP_SKILL_ORDER.filter((s) => skills.includes(s));
}

export function personalityFromList(lists: ImpLists): number {
  return lists.personalities.length === 0 ? Personality.NONE : Personality.PSYCHO;
}

export function createPlayerAttitude(ctx: LaptopContext, attitudes: readonly number[]): number {
  if (attitudes.length === 0) return ATT_NORMAL;
  const hits = new Array<number>(NUM_ATTITUDES).fill(0);
  for (const a of attitudes) hits[a] = (hits[a] ?? 0) + 1;
  let highest = 0;
  let tied = 0;
  for (const h of hits) {
    if (!h) continue;
    if (h > highest) {
      highest = h;
      tied = 1;
    } else if (h === highest) tied++;
  }
  const dice = ctx.rng.main.int(tied);
  let seen = 0;
  for (let a = 0; a < NUM_ATTITUDES; a++) {
    if (hits[a] !== highest) continue;
    if (seen === dice) return a;
    seen++;
  }
  return ATT_NORMAL;
}

function removeSkill(list: number[], skill: number): void {
  for (let i = 0; i !== list.length; ) {
    if (list[i] === skill) {
      list[i] = list[list.length - 1] ?? 0;
      list.length--;
    } else i++;
  }
}

function validateSkillsList(list: number[], p: ProfileProgress): void {
  const s = p.stats;
  if (s.mechanical === 0) removeSkill(list, SkillTrait.ELECTRONICS);
  const lockpicking = idiv(idiv(s.mechanical * s.wisdom, PERCENT) * s.dexterity, PERCENT);
  if (lockpicking + (SKILL_TRAIT_BONUS[SkillTrait.LOCKPICKING] ?? 0) < LOCKPICKING_THRESHOLD) removeSkill(list, SkillTrait.LOCKPICKING);
  if (s.marksmanship === 0) {
    removeSkill(list, SkillTrait.AUTO_WEAPS);
    removeSkill(list, SkillTrait.HEAVY_WEAPS);
  }
}

function createPlayerSkills(ctx: LaptopContext, list: number[], p: ProfileProgress, direct: boolean): [number, number] {
  validateSkillsList(list, p);
  if (direct) {
    const first = list[0] ?? SkillTrait.NONE;
    if (list.length === 1) return [first, NO_EXPERT_LEVEL.has(first) ? SkillTrait.NONE : first];
    if (list.length === 2) return [first, list[1] ?? SkillTrait.NONE];
    return [SkillTrait.NONE, SkillTrait.NONE];
  }
  const a = list.length === 0 ? SkillTrait.NONE : (list[ctx.rng.main.int(list.length)] ?? SkillTrait.NONE);
  if (a === SkillTrait.ELECTRONICS || a === SkillTrait.AMBIDEXT) removeSkill(list, a);
  const b = list.length === 0 ? SkillTrait.NONE : (list[ctx.rng.main.int(list.length)] ?? SkillTrait.NONE);
  return [a, b];
}

function attributeCost(key: ImpAttributeKey, value: number, ctx: LaptopContext): number | null {
  const imp = ctx.content.imp;
  if (value === 0 && ZEROABLE.has(key)) return imp.minAttributePoints - START_ATTRIBUTE - imp.zeroAttributePointsBonus;
  if (!Number.isInteger(value) || value < imp.minAttributePoints || value > imp.maxAttributePoints) return null;
  return value - START_ATTRIBUTE;
}

export function directPickBonus(skills: readonly number[]): number {
  if (skills.length === 0) return DIRECT_PICK_BONUS.none;
  if (skills.length === 1 && NO_EXPERT_LEVEL.has(skills[0] ?? SkillTrait.NONE)) return DIRECT_PICK_BONUS.oneWithoutExpert;
  return 0;
}

export function attributesValid(ctx: LaptopContext, attributes: ImpAttributes, skills: readonly number[]): boolean {
  let pool = ctx.content.imp.bonusAttributePoints;
  if (ctx.content.imp.pickSkillsDirectly) pool += directPickBonus(skills);
  let cost = 0;
  for (const key of IMP_ATTRIBUTE_KEYS) {
    const c = attributeCost(key, attributes[key], ctx);
    if (c === null) return false;
    cost += c;
  }
  return cost <= pool;
}

export function impNames(name: string, nickname: string | undefined): { readonly name: string; readonly nickname: string } | null {
  const full = name.trim();
  if (!full || full.length > NAME_LENGTH) return null;
  const nick = (nickname ?? '').trim();
  if (nick.length > NICKNAME_LENGTH) return null;
  return { name: full, nickname: nick || (full.split(' ')[0] ?? full).slice(0, NICKNAME_LENGTH) };
}

function genderIndex<T extends { readonly male: boolean }>(entries: readonly T[], male: boolean, nth: number): number {
  let seen = 0;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i]?.male !== male) continue;
    if (seen++ === nth) return i;
  }
  return -1;
}

function validAnswers(ctx: LaptopContext, answers: readonly number[] | undefined): boolean {
  if (!answers || answers.length !== QUIZ_QUESTIONS) return false;
  return answers.every((a, q) => Number.isInteger(a) && a >= 0 && a < (ctx.content.impQuiz[q]?.length ?? 0));
}

function validDirectSkills(skills: readonly number[] | undefined, male: boolean): boolean {
  if (!skills || skills.length > MAX_DIRECT_SKILLS || new Set(skills).size !== skills.length) return false;
  return skills.every((s) => IMP_SKILL_ORDER.includes(s) && (male || s !== SkillTrait.MARTIALARTS));
}

export function impRefusal(ctx: LaptopContext, r: ImpRequest): ImpRefusal | null {
  const imp = ctx.content.imp;
  if (!ctx.laptop.bookmarks.includes(Bookmark.IMP)) return 'noBookmark';
  if (!imp.codes.includes(r.code)) return 'badCode';
  if (!canCreateAnotherImpCharacter(ctx)) return 'noSlot';
  if (ctx.state.finances.balance < COST_OF_PROFILE) return 'funds';
  if (numberOfMercsOnPlayerTeam(ctx) >= MAX_MERCS_ON_TEAM) return 'teamFull';
  if (!impNames(r.name, r.nickname) || (r.gender !== 'male' && r.gender !== 'female')) return 'badName';
  const male = r.gender === 'male';
  if (imp.pickSkillsDirectly) {
    if (!validDirectSkills(r.skills, male)) return 'badSkills';
  } else if (!validAnswers(ctx, r.answers)) return 'badAnswers';
  if (!attributesValid(ctx, r.attributes, r.skills ?? [])) return 'badAttributes';
  if (genderIndex(imp.portraits, male, r.portrait) < 0) return 'badPortrait';
  if (genderIndex(imp.voices, male, r.voice) < 0) return 'badVoice';
  return null;
}

export function emptyProfile(id: number): MercProfile {
  const zeros = (n: number) => new Array<number>(n).fill(0);
  const none = (n: number) => new Array<number>(n).fill(-1);
  const stat = { expLevel: 0, life: 0, agility: 0, dexterity: 0, wisdom: 0, marksmanship: 0, medical: 0, mechanical: 0, explosives: 0 };
  return {
    id,
    name: '',
    nickname: '',
    palettes: { hair: '', skin: '', vest: '', pants: '' },
    sex: 0,
    bodyType: Body.REGMALE,
    bodyTypeSubFlags: 0,
    life: EMPTY_PROFILE_LIFE,
    lifeMax: EMPTY_PROFILE_LIFE,
    strength: EMPTY_PROFILE_STAT,
    agility: EMPTY_PROFILE_STAT,
    dexterity: EMPTY_PROFILE_STAT,
    wisdom: EMPTY_PROFILE_STAT,
    marksmanship: 0,
    medical: 0,
    mechanical: 0,
    explosives: 0,
    leadership: EMPTY_PROFILE_STAT,
    experience: EMPTY_PROFILE_STAT,
    skillTrait: 0,
    skillTrait2: 0,
    personalityTrait: 0,
    civilianGroup: 0,
    sectorX: 0,
    sectorY: 0,
    sectorZ: 0,
    gridNo: 0,
    inventory: zeros(InvSlot.SMALLPOCK8 + 1),
    inventoryStatus: zeros(InvSlot.SMALLPOCK8 + 1),
    inventoryCount: zeros(InvSlot.SMALLPOCK8 + 1),
    inventoryUndroppable: 0,
    money: 0,
    evolution: 0,
    attitude: 0,
    buddies: none(5),
    hated: none(5),
    gains: { ...stat, leadership: 0, strength: 0 },
    needForSleep: EMPTY_PROFILE_NEED_FOR_SLEEP,
    town: 0,
    townAttachment: 0,
    mercOpinion: zeros(75),
    sexist: 0,
    deathRate: 0,
    hatedTime: zeros(5),
    hatedCount: zeros(5),
    learnToHate: -1,
    learnToHateTime: 0,
    learnToHateCount: 0,
    learnToLike: -1,
    learnToLikeTime: 0,
    learnToLikeCount: 0,
    timeTillNextHatedComplaint: 0,
    statChangeChances: zeros(12),
    statChangeSuccesses: zeros(12),
    reputationTolerance: 0,
    armourAttractiveness: -1,
    mainGunAttractiveness: -1,
    miscFlags: 0,
    miscFlags2: 0,
    miscFlags3: 0,
    dayBecomesAvailable: 0,
    totalDaysServed: 0,
    salary: 0,
    weeklySalary: 0,
    biWeeklySalary: 0,
    medicalDeposit: 0,
    medicalDepositAmount: 0,
    optionalGearCost: 0,
    mercStatus: 0,
    balance: 0,
    daysOfMoraleHangover: 0,
    precedentQuoteSaid: 0,
    suspiciousDeath: 0,
    mercMercContractLength: 0,
    totalCostToDate: 0,
    ...zeroProfileNpcFields(),
  };
}

function conditionHolds(ctx: LaptopContext, c: ImpCondition, p: ProfileProgress): boolean {
  const [one, two] = c;
  let check: string;
  let value: number;
  let reverse = false;
  if (typeof one === 'number' && typeof two === 'string') {
    value = one;
    check = two;
    reverse = true;
  } else if (typeof two === 'number' && typeof one === 'string') {
    value = two;
    check = one;
  } else if (typeof one === 'string' && typeof two === 'string') {
    if (one === RANDOM_100) {
      value = ctx.rng.pre.int(PERCENT);
      check = two;
    } else if (two === RANDOM_100) {
      value = ctx.rng.pre.int(PERCENT);
      check = one;
    } else if (one === SKILL_CONDITION) {
      const skill = SKILL_NAMES[two] ?? SkillTrait.NONE;
      return p.skillTrait === skill || p.skillTrait2 === skill;
    } else return false;
  } else return false;
  const read = ATTRIBUTE_NAMES[check];
  if (!read) return false;
  const actual = u8(read(p));
  return reverse ? value >= actual : actual >= value;
}

function setHolds(ctx: LaptopContext, set: ImpItemSet, p: ProfileProgress): boolean {
  for (const c of set.conditions) if (!conditionHolds(ctx, c, p)) return false;
  return true;
}

function firstFreeBigEnoughPocket(ctx: LaptopContext, p: ProfileProgress, item: number): number {
  const fitsSmall = (ctx.tactical.items.byIndex.get(item)?.perPocket ?? 0) !== 0;
  if (fitsSmall) for (let pos = InvSlot.SMALLPOCK1; pos <= InvSlot.SMALLPOCK8; pos++) if (!p.inventory[pos]) return pos;
  for (let pos = InvSlot.BIGPOCK1; pos <= InvSlot.BIGPOCK4; pos++) if (!p.inventory[pos]) return pos;
  return -1;
}

function giveItemsToPc(ctx: LaptopContext, p: ProfileProgress): void {
  const FULL = 100;
  for (const set of ctx.content.imp.inventory) {
    if (!setHolds(ctx, set, p)) continue;
    for (const item of set.items) {
      const pos = set.slot ?? firstFreeBigEnoughPocket(ctx, p, item);
      if (pos < 0) continue;
      p.inventory[pos] = item;
      p.inventoryStatus[pos] = FULL;
      p.inventoryCount[pos] = 1;
    }
  }
}

function impRecord(ctx: LaptopContext, slot: number, r: ImpRequest, names: { name: string; nickname: string }): MercProfile {
  const imp = ctx.content.imp;
  const male = r.gender === 'male';
  const portrait = imp.portraits[genderIndex(imp.portraits, male, r.portrait)];
  const a = r.attributes;
  const base = ctx.profileRecord(slot) ?? emptyProfile(slot);
  return {
    ...base,
    name: names.name,
    nickname: names.nickname,
    sex: male ? 0 : 1,
    palettes: { ...base.palettes, hair: portrait?.hair ?? base.palettes.hair, skin: portrait?.skin ?? base.palettes.skin },
    faceIndex: portrait?.face ?? base.faceIndex,
    eyesX: 0,
    eyesY: 0,
    mouthX: 0,
    mouthY: 0,
    life: a.health,
    lifeMax: a.health,
    agility: a.agility,
    strength: a.strength,
    dexterity: a.dexterity,
    wisdom: a.wisdom,
    leadership: a.leadership,
    marksmanship: a.marksmanship,
    medical: a.medical,
    mechanical: a.mechanical,
    explosives: a.explosives,
    experience: imp.startingLevel,
    mercStatus: MercStatus.OK,
  };
}

export function impCreate(ctx: LaptopContext, r: ImpRequest, hooks: HireHooks): ImpResult {
  const refusal = impRefusal(ctx, r);
  if (refusal) return { ok: false, reason: refusal };
  const imp = ctx.content.imp;
  const male = r.gender === 'male';
  const names = impNames(r.name, r.nickname) as { name: string; nickname: string };
  const slot = impSlotInProgress(ctx) as number;
  const lists = imp.pickSkillsDirectly
    ? { skills: directSkillList(r.skills ?? []), attitudes: [], personalities: [] }
    : compileQuiz(ctx, r.answers ?? [], male);
  const personality = imp.pickSkillsDirectly ? Personality.NONE : personalityFromList(lists);
  const attitude = imp.pickSkillsDirectly ? ATT_NORMAL : createPlayerAttitude(ctx, lists.attitudes);
  const record = impRecord(ctx, slot, r, names);
  const p = progressFromProfile({ ...record, personalityTrait: personality, attitude });
  const portraitIndex = genderIndex(imp.portraits, male, r.portrait);
  const voiceIndex = genderIndex(imp.voices, male, r.voice);
  let [skillA, skillB] = createPlayerSkills(ctx, lists.skills, p, imp.pickSkillsDirectly);
  const bigBody = male && imp.portraits[portraitIndex]?.bigBody === true && p.stats.strength >= BIG_BODY_MIN_STRENGTH;
  const bodyType = male ? (bigBody ? Body.BIGMALE : Body.REGMALE) : Body.REGFEMALE;
  if (bodyType !== Body.REGMALE) {
    if (skillA === SkillTrait.MARTIALARTS) skillA = SkillTrait.HANDTOHAND;
    if (skillB === SkillTrait.MARTIALARTS) skillB = SkillTrait.HANDTOHAND;
  }
  const finished: ProfileProgress = { ...p, skillTrait: skillA, skillTrait2: skillB };
  giveItemsToPc(ctx, finished);
  const character: MercProfile = {
    ...record,
    bodyType,
    skillTrait: skillA,
    skillTrait2: skillB,
    personalityTrait: personality,
    attitude,
    inventory: [...finished.inventory],
    inventoryStatus: [...finished.inventoryStatus],
    inventoryCount: [...finished.inventoryCount],
  };
  ctx.laptop.imp.profiles.set(slot, character);
  ctx.laptop.imp.voices.set(slot, imp.voices[voiceIndex]?.profile ?? slot);
  ctx.state.profiles.set(slot, finished);
  ctx.laptop.imp.voiceId = voiceIndex;
  const outcome = hireMercCore(
    ctx,
    {
      profile: slot,
      kind: MercKind.PLAYER_CHARACTER,
      length: -1,
      copyItems: true,
      insertion: InsertionCode.ARRIVING_GAME,
      useLandingZone: true,
    },
    hooks,
  );
  if (outcome === 'failed' || outcome === 'teamFull') return { ok: false, reason: outcome === 'teamFull' ? 'teamFull' : 'cannotHire' };
  ctx.laptop.imp.taken.push(slot);
  ctx.laptop.imp.completed = true;
  const now = ctx.now();
  ctx.emitMoney(addTransaction(ctx.state.finances, FinanceCode.IMP_PROFILE, slot, now, -COST_OF_PROFILE));
  ctx.history(History.CHARACTER_GENERATED, 0, null);
  if (imp.sendsProfileResultsEmail)
    addFutureDayStrategicEvent(
      ctx.state.queue,
      ctx.state.clock,
      EventKind.DAY2_ADD_EMAIL_FROM_IMP,
      RESULTS_MAIL_MINUTE,
      slot,
      RESULTS_MAIL_DAYS,
    );
  return {
    ok: true,
    merc: outcome.merc,
    profile: slot,
    arrival: outcome.arrival,
    skills: [skillA, skillB],
    personality,
    attitude: i8(attitude),
  };
}

export function impPreview(ctx: LaptopContext, answers: readonly number[], male: boolean): ImpLists {
  return compileQuiz(ctx, answers, male);
}
