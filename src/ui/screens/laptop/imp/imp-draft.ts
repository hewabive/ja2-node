// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/CharProfile.h the I.M.P. pages; CharProfile.cc iCurrentImpPage, ResetCharacterStats,
// @src BtnIMPCancelCallback; IMP_MainPage.cc iCurrentProfileMode, BtnIMPMainPageBackCallback, BtnIMPMainPageBeginCallback,
// @src BeginMessageBoxCallBack, UpDateIMPMainPageButtons, CheckIfFinishedCharacterGeneration; IMP_HomePage.cc
// @src ProcessPlayerInputActivationString; IMP_Begin_Screen.cc EnterIMPBeginScreen, ExitIMPBeginScreen,
// @src BtnIMPBeginScreenDoneCallback, SelectMaleRegionCallBack, SelectFemaleRegionCallBack; IMP_Personality_Quiz.cc
// @src EnterIMPPersonalityQuiz, ExitIMPPersonalityQuiz, BtnQuizAnswerCallback, BtnIMPPersonalityQuizAnswerConfirmCallback,
// @src BtnIMPPersonalityQuizStartOverCallback, MoveAheadAQuestion, MoveBackAQuestion, ToggleQuestionNumberButtonOn;
// @src IMP_Personality_Finish.cc the yes/no/ok buttons; IMP_Attribute_Selection.cc EnterIMPAttributeSelection, SetAttributes,
// @src IncrementStat, DecrementStat, ProcessAttributes, StatAtZeroBoxCallBack, MouseXPosToSkillValue, SetGeneratedCharacterAttributes;
// @src IMP_Attribute_Finish.cc the yes/no buttons; IMP_SkillTraits.cc the ImpSkillTrait order, EnterIMPSkillTrait and
// @src AddImpSkillTraitButtons (the picks cleared and None picked unless the character is done, the last picks forgotten),
// @src HandleIMPSkillTraitAnswers, HandleLastSelectedTraits (a third pick drops the oldest of the two before it, None
// @src included), CountNumSkillStraitsSelected, BtnIMPSkillTraitFinishCallback, CameBackToSpecialtiesPageButNotFinished,
// @src DoesPlayerHaveExtraAttibutePointsToDistributeBasedOnSkillSelection, AddSelectedSkillsToSkillsList; IMP_Portraits.cc IncrementPictureIndex, DecrementPicture,
// @src BtnIMPPortraitDoneCallback; IMP_Voices.cc IncrementVoice, DecrementVoice, BtnIMPVoicesDoneCallback; IMP_Finish.cc
// @src EnterIMPFinish, BtnIMPFinishDoneCallback, FinishMessageBoxCallBack; IMP_Confirm.cc BtnIMPConfirmYes, BtnIMPConfirmNo.

import { idiv } from '../../../../core/int.ts';
import type { ImpAttributeName, ImpAttributeRulesView } from '../../../../protocol/view.ts';

export const ImpPage = {
  HOME: 0,
  BEGIN: 1,
  FINISH: 2,
  MAIN: 3,
  PERSONALITY: 4,
  QUIZ: 5,
  SKILLTRAITS: 6,
  PERSONALITY_FINISH: 7,
  ATTRIBUTE_ENTRANCE: 8,
  ATTRIBUTE_PAGE: 9,
  ATTRIBUTE_FINISH: 10,
  PORTRAIT: 11,
  VOICE: 12,
  ABOUT_US: 13,
  CONFIRM: 14,
} as const;

export const ProfileMode = { BEGINNING: 0, PERSONALITY: 1, ATTRIBUTES: 2, PORTRAIT: 3, VOICE: 4, DONE: 5 } as const;

export const QUIZ_QUESTIONS = 16;
export const NO_ANSWER = -1;
export const NO_GENDER = -1;
export const FEMALE = 0;
export const MALE = 1;
export const MAX_NICKNAME_LENGTH = 8;
const LAST_QUESTION = QUIZ_QUESTIONS - 1;

export const Specialty = { MARTIAL_ARTS: 13, NONE: 14 } as const;
export const SPECIALTY_COUNT = Specialty.NONE + 1;
const NO_SPECIALTY = -1;

export const ATTRIBUTE_NAMES: readonly ImpAttributeName[] = [
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
];

export const DEFAULT_ATTRIBUTE_RULES: ImpAttributeRulesView = {
  start: 55,
  min: 35,
  max: 85,
  bonus: 40,
  zeroBonus: 15,
  order: ['health', 'dexterity', 'agility', 'strength', 'wisdom', 'leadership', 'marksmanship', 'explosives', 'medical', 'mechanical'],
  zeroable: ['marksmanship', 'medical', 'mechanical', 'explosives'],
  specialtyBonus: null,
};

export type ImpAttributes = Record<ImpAttributeName, number>;

export type BeginOutcome = 'main' | 'needsNameAndGender';

export interface ImpRequestDraft {
  readonly code: string;
  readonly name: string;
  readonly nickname: string;
  readonly gender: 'male' | 'female';
  readonly answers?: readonly number[];
  readonly skills?: readonly number[];
  readonly attributes: ImpAttributes;
  readonly portrait: number;
  readonly voice: number;
}

function startingAttributes(start: number): ImpAttributes {
  return Object.fromEntries(ATTRIBUTE_NAMES.map((name) => [name, start])) as ImpAttributes;
}

export class ImpDraft {
  page: number = ImpPage.HOME;
  profileMode: number = ProfileMode.BEGINNING;
  code = '';
  fullName = '';
  nickName = '';
  male = true;
  genderFlag: number = NO_GENDER;
  beginFullName = '';
  beginNickName = '';
  readonly answers: number[] = new Array<number>(QUIZ_QUESTIONS).fill(NO_ANSWER);
  question = 0;
  previousQuestion = -1;
  maxQuestion = 0;
  answer = NO_ANSWER;
  startOver = false;
  readonly specialties: boolean[] = new Array<boolean>(SPECIALTY_COUNT).fill(false);
  readonly #lastSpecialties: number[] = [NO_SPECIALTY, NO_SPECIALTY];
  rules: ImpAttributeRulesView = DEFAULT_ATTRIBUTE_RULES;
  current: ImpAttributes = startingAttributes(DEFAULT_ATTRIBUTE_RULES.start);
  committed: ImpAttributes = startingAttributes(DEFAULT_ATTRIBUTE_RULES.start);
  bonusPoints = DEFAULT_ATTRIBUTE_RULES.bonus;
  firstAttributeTime = true;
  returnStatus = false;
  reviewStats = false;
  statAtZero: ImpAttributeName | null = null;
  personalityEndState = 0;
  portrait = 0;
  portraitNumber = 0;
  voice = 0;
  voiceId = 0;

  enterFromBookmark(): void {
    this.page = ImpPage.HOME;
  }

  resetCharacterStats(): void {
    this.committed = startingAttributes(this.rules.start);
    this.fullName = '';
    this.nickName = '';
  }

  backToHome(): void {
    this.page = ImpPage.HOME;
    this.profileMode = ProfileMode.BEGINNING;
    this.resetCharacterStats();
  }

  acceptCode(code: string): void {
    this.code = code;
    this.page = ImpPage.MAIN;
  }

  restartFromMain(): void {
    this.page = ImpPage.BEGIN;
    this.profileMode = ProfileMode.BEGINNING;
  }

  enterMain(): void {
    this.reviewStats = false;
    if (this.profileMode === ProfileMode.DONE) this.page = ImpPage.FINISH;
  }

  mainButtonEnabled(button: 'personality' | 'attributes' | 'portrait' | 'voice'): boolean {
    switch (this.profileMode) {
      case ProfileMode.PERSONALITY:
        return button === 'personality';
      case ProfileMode.ATTRIBUTES:
        return button === 'attributes';
      case ProfileMode.PORTRAIT:
        return button === 'attributes' || button === 'portrait';
      case ProfileMode.VOICE:
        return button !== 'personality';
      default:
        return false;
    }
  }

  mainBlockerEnabled(index: number): boolean {
    const blocked: Readonly<Record<number, readonly number[]>> = {
      [ProfileMode.BEGINNING]: [0, 1, 2, 3],
      [ProfileMode.PERSONALITY]: [1, 2, 3],
      [ProfileMode.ATTRIBUTES]: [0, 2, 3],
      [ProfileMode.PORTRAIT]: [0, 3],
      [ProfileMode.VOICE]: [0],
    };
    return (blocked[this.profileMode] ?? []).includes(index);
  }

  enterBegin(): void {
    this.genderFlag = this.profileMode !== ProfileMode.BEGINNING ? (this.male ? MALE : FEMALE) : NO_GENDER;
    this.firstAttributeTime = true;
  }

  selectGender(male: boolean, canCreate: boolean): void {
    if (canCreate) this.tickGender(male);
  }

  tickGender(male: boolean): void {
    this.genderFlag = male ? MALE : FEMALE;
  }

  beginDone(fullName: string, nickName: string): BeginOutcome {
    this.beginFullName = fullName.trim();
    this.beginNickName = nickName.trim();
    if (this.beginFullName === '' || this.genderFlag === NO_GENDER) {
      this.profileMode = ProfileMode.BEGINNING;
      return 'needsNameAndGender';
    }
    if (this.beginNickName === '')
      this.beginNickName = [...(this.beginFullName.split(' ')[0] ?? '')].slice(0, MAX_NICKNAME_LENGTH).join('');
    if (this.profileMode < ProfileMode.PERSONALITY) this.profileMode = ProfileMode.PERSONALITY;
    this.page = ImpPage.MAIN;
    return 'main';
  }

  exitBegin(): void {
    this.fullName = this.beginFullName;
    this.nickName = this.beginNickName;
    this.male = this.genderFlag !== FEMALE;
  }

  enterQuiz(): void {
    this.answers.fill(NO_ANSWER);
    if (this.question === QUIZ_QUESTIONS) this.question = 0;
    this.previousQuestion = -1;
  }

  exitQuiz(): void {
    this.previousQuestion = this.question;
    if (this.startOver) {
      this.startOver = false;
      this.question = 0;
    }
  }

  chooseAnswer(answer: number): void {
    this.answer = answer;
  }

  confirmAnswer(): boolean {
    if (this.answer === NO_ANSWER) return false;
    this.answers[this.question] = this.answer;
    this.answer = NO_ANSWER;
    if (this.question === this.maxQuestion) this.maxQuestion++;
    this.question++;
    if (this.question > LAST_QUESTION) {
      this.page = ImpPage.PERSONALITY_FINISH;
      return true;
    }
    return false;
  }

  startQuizOver(): void {
    this.previousQuestion = this.question;
    this.maxQuestion = 0;
    this.startOver = true;
    this.page = ImpPage.PERSONALITY;
    this.answer = NO_ANSWER;
  }

  nextQuestion(): void {
    if (this.question < this.maxQuestion) {
      this.question++;
      this.answer = this.answers[this.question] ?? NO_ANSWER;
    }
  }

  previousQuestionAnswer(): void {
    if (this.question > 0) {
      this.question--;
      this.answer = this.answers[this.question] ?? NO_ANSWER;
    }
  }

  showRecordedAnswer(): void {
    const recorded = this.answers[this.question] ?? NO_ANSWER;
    if (this.question <= this.maxQuestion && recorded !== NO_ANSWER) this.answer = recorded;
  }

  get canGoForward(): boolean {
    return this.question < this.maxQuestion;
  }

  get canGoBack(): boolean {
    return this.question !== 0;
  }

  enterPersonalityFinish(): void {
    this.personalityEndState = 0;
  }

  personalityConfirmed(yes: boolean): void {
    this.personalityEndState = yes ? 1 : 2;
  }

  personalityOk(): void {
    if (this.profileMode < ProfileMode.ATTRIBUTES) this.profileMode = ProfileMode.ATTRIBUTES;
    this.page = ImpPage.MAIN;
  }

  enterSpecialties(): void {
    if (this.profileMode !== ProfileMode.DONE) {
      this.specialties.fill(false);
      this.specialties[Specialty.NONE] = true;
    }
    this.#lastSpecialties.fill(NO_SPECIALTY);
  }

  pickSpecialty(specialty: number): boolean {
    if (this.profileMode === ProfileMode.DONE) return false;
    if (specialty < 0 || specialty >= SPECIALTY_COUNT || this.specialties[specialty]) return false;
    this.#rememberSpecialty(specialty);
    this.specialties[specialty] = true;
    if (specialty === Specialty.NONE) {
      this.specialties.fill(false);
      this.specialties[Specialty.NONE] = true;
    } else this.specialties[Specialty.NONE] = false;
    return true;
  }

  #rememberSpecialty(specialty: number): void {
    const [newest, older] = this.#lastSpecialties as [number, number];
    if (newest !== NO_SPECIALTY && older !== NO_SPECIALTY) this.specialties[older] = false;
    this.#lastSpecialties[1] = newest;
    this.#lastSpecialties[0] = specialty;
  }

  specialtiesFinished(): void {
    if (this.profileMode === ProfileMode.DONE) {
      this.page = ImpPage.FINISH;
      return;
    }
    this.page = ImpPage.MAIN;
    if (this.profileMode !== ProfileMode.ATTRIBUTES) this.profileMode = ProfileMode.ATTRIBUTES;
  }

  #pickedSpecialties(): number[] {
    const picked: number[] = [];
    for (let s = 0; s < Specialty.NONE; s++) if (this.specialties[s]) picked.push(s);
    return picked;
  }

  #specialtyBonus(rules: ImpAttributeRulesView): number {
    const bonus = rules.specialtyBonus;
    if (!bonus) return 0;
    const picked = this.#pickedSpecialties();
    if (picked.length === 0) return bonus.withoutSpecialty;
    return picked.length === 1 ? (bonus.loneSpecialty[picked[0] ?? NO_SPECIALTY] ?? 0) : 0;
  }

  setAttributes(rules: ImpAttributeRulesView = this.rules): void {
    this.rules = rules;
    this.current = startingAttributes(rules.start);
    this.bonusPoints = rules.bonus + this.#specialtyBonus(rules);
  }

  enterAttributes(rules: ImpAttributeRulesView): void {
    this.rules = rules;
    if (!this.returnStatus && this.firstAttributeTime) this.setAttributes(rules);
    this.returnStatus = true;
    this.firstAttributeTime = false;
  }

  exitAttributes(): void {
    this.returnStatus = false;
  }

  #zeroable(name: ImpAttributeName): boolean {
    return this.rules.zeroable.includes(name);
  }

  increment(name: ImpAttributeName): void {
    if (this.reviewStats) return;
    const value = this.current[name];
    if (value === 0) {
      if (this.bonusPoints >= this.rules.zeroBonus) {
        this.current[name] = this.rules.min;
        this.bonusPoints -= this.rules.zeroBonus;
        this.statAtZero = null;
      }
    } else if (value < this.rules.max && this.bonusPoints >= 1) {
      this.current[name] = value + 1;
      this.bonusPoints--;
    }
  }

  decrement(name: ImpAttributeName): void {
    if (this.reviewStats) return;
    const value = this.current[name];
    if (value > this.rules.min) {
      this.current[name] = value - 1;
      this.bonusPoints++;
    } else if (this.#zeroable(name) && value === this.rules.min) {
      this.current[name] = 0;
      this.bonusPoints += this.rules.zeroBonus;
      this.statAtZero = name;
    }
  }

  moveToward(name: ImpAttributeName, value: number): void {
    const now = this.current[name];
    if (value > now) for (let k = value - now; k > 0; k--) this.increment(name);
    else for (let k = now - value; k > 0; k--) this.decrement(name);
  }

  jumpTo(name: ImpAttributeName, value: number): void {
    const now = this.current[name];
    const target = Math.min(value, this.rules.max);
    const delta = now - target;
    if (delta > 0) for (let k = 0; k < delta; k++) this.decrement(name);
    else
      for (let k = delta; k < 0; k++) {
        if (now === 0) k = 0;
        this.increment(name);
      }
  }

  takeZeroWarning(): ImpAttributeName | null {
    const name = this.statAtZero;
    this.statAtZero = null;
    return name;
  }

  attributesFinished(): void {
    this.page = this.reviewStats ? ImpPage.FINISH : ImpPage.ATTRIBUTE_FINISH;
  }

  attributesAccepted(): void {
    this.page = ImpPage.MAIN;
    if (this.profileMode < ProfileMode.PORTRAIT) this.profileMode = ProfileMode.PORTRAIT;
    if (this.profileMode === ProfileMode.DONE) this.page = ImpPage.FINISH;
    this.committed = { ...this.current };
  }

  attributesRejected(): void {
    this.page = ImpPage.ATTRIBUTE_PAGE;
    this.returnStatus = true;
  }

  enterPortraits(count: number): void {
    if (this.portrait >= count) this.portrait = 0;
  }

  stepPortrait(delta: 1 | -1, count: number): void {
    this.portrait = (this.portrait + delta + count) % count;
  }

  portraitDone(): void {
    this.page = ImpPage.MAIN;
    if (this.profileMode < ProfileMode.VOICE) this.profileMode = ProfileMode.VOICE;
    if (this.profileMode === ProfileMode.DONE) this.page = ImpPage.FINISH;
    this.portraitNumber = this.portrait;
  }

  enterVoices(count: number): void {
    if (this.voice >= count) this.voice = 0;
  }

  stepVoice(delta: 1 | -1, count: number): void {
    this.voice = (this.voice + delta + count) % count;
  }

  voiceDone(): void {
    this.page = ImpPage.MAIN;
    if (this.profileMode === ProfileMode.DONE) this.page = ImpPage.FINISH;
    else if (this.profileMode < ProfileMode.VOICE) this.profileMode = ProfileMode.VOICE;
    else if (this.profileMode === ProfileMode.VOICE) {
      this.profileMode = ProfileMode.DONE;
      this.page = ImpPage.FINISH;
    }
    this.voiceId = this.voice;
  }

  enterFinish(): void {
    this.reviewStats = true;
    this.profileMode = ProfileMode.DONE;
  }

  finishDone(): void {
    this.page = ImpPage.CONFIRM;
    this.profileMode = ProfileMode.BEGINNING;
  }

  confirmed(): void {
    this.page = ImpPage.HOME;
    this.resetCharacterStats();
  }

  cancel(): void {
    switch (this.page) {
      case ImpPage.MAIN:
        this.backToHome();
        return;
      case ImpPage.FINISH:
        this.page = ImpPage.MAIN;
        this.profileMode = ProfileMode.VOICE;
        return;
      case ImpPage.QUIZ:
      case ImpPage.SKILLTRAITS:
      case ImpPage.PERSONALITY_FINISH:
        this.maxQuestion = 0;
        this.startOver = true;
        this.answer = NO_ANSWER;
        this.page = ImpPage.PERSONALITY;
        return;
      case ImpPage.ATTRIBUTE_PAGE:
        this.setAttributes();
        this.page = ImpPage.MAIN;
        this.answer = NO_ANSWER;
        return;
      default:
        this.page = ImpPage.MAIN;
        this.answer = NO_ANSWER;
    }
  }

  request(specialtySkills: readonly number[] | null = null): ImpRequestDraft {
    const choice = specialtySkills
      ? { skills: this.#pickedSpecialties().map((s) => specialtySkills[s] ?? NO_SPECIALTY) }
      : { answers: [...this.answers] };
    return {
      code: this.code,
      name: this.fullName,
      nickname: this.nickName,
      gender: this.male ? 'male' : 'female',
      ...choice,
      attributes: { ...this.committed },
      portrait: this.portraitNumber,
      voice: this.voiceId,
    };
  }
}

export function skillValueAt(relativeX: number, rules: ImpAttributeRulesView, pixelUnit: number): number {
  return idiv(relativeX * (rules.max - rules.min), pixelUnit) + rules.min;
}

export function sliderOffset(value: number, rules: ImpAttributeRulesView, pixelUnit: number): number {
  return idiv(Math.max(0, value - rules.min) * pixelUnit, rules.max - rules.min);
}
