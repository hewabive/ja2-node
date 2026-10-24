// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/IMP_Personality_Quiz.cc EnterIMPPersonalityQuiz, ExitIMPPersonalityQuiz, HandleIMPPersonalityQuiz
// @src (the confirm button disabled without an answer), CreateIMPPersonalityQuizAnswerButtons, AddIMPPersonalityQuizAnswerButtons
// @src (button_6.sti, four to a column, the number at 23, 12), BtnQuizAnswerCallback (on the press),
// @src BtnIMPPersonalityQuizAnswerConfirmCallback, BtnIMPPersonalityQuizStartOverCallback, BltAnswerIndents (long indents
// @src for up to four answers, short ones beyond, the short2 indents of questions 5, 10 and 19), PrintQuizQuestionNumber,
// @src CheckAndUpdateNextPreviousIMPQuestionButtonStates, ToggleQuestionNumberButtonOn; IMP_Text_System.cc
// @src PrintIMPPersonalityQuizQuestionAndAnswers (the records after IMP_QUESTION_1, answer widths 390 or 160),
// @src OffSetQuestionForFemaleSpecificQuestions (questions 0, 3, 8, 9 and 13 after IMP_CON_3 for women);
// @src IMP_Personality_Finish.cc EnterIMPPersonalityFinish, the yes and no buttons replaced by OK once one is chosen,
// @src BtnIMPPersonalityFinishOkCallback. See docs/28 §9.7.

import type { ControllerContract } from '../../../layout/controller.ts';
import { ViewModelController } from '../../../layout/controller.ts';
import type { LaptopPage } from '../laptop-page.ts';
import { QUIZ_QUESTIONS } from './imp-draft.ts';
import type { ImpContext } from './imp-site.ts';

export const IMP_QUIZ_LAYOUT = 'imp-quiz';
export const IMP_PERSONALITY_FINISH_LAYOUT = 'imp-personality-finish';

const ANSWERS_PER_COLUMN = 4;
const FEMALE_SPECIFIC_QUESTIONS: readonly number[] = [0, 3, 8, 9, 13];
const FEMALE_QUESTIONS_GAP = 3;
const SHORT2_FOURTH_ANSWER_QUESTION = 5;
const SHORT2_FIFTH_ANSWER_QUESTIONS: readonly number[] = [10, 5];
const SHORT2_SIXTH_ANSWER_QUESTION = 19;
const LONG_ANSWER_WIDTH = 390;
const SHORT_ANSWER_WIDTH = 160;
const FIFTH_ANSWER = 4;
const SIXTH_ANSWER = 5;

export type QuizIndent = 'long' | 'short' | 'short2';

export const IMP_QUIZ_CONTRACT: ControllerContract = {
  id: 'impQuiz',
  actions: { answer: { args: 1 }, confirm: {}, startOver: {}, previous: {}, next: {} },
  bindings: {
    answers: 'list',
    firstCount: 'number',
    secondCount: 'number',
    answerWidth: 'number',
    question: 'string',
    questionNumber: 'string',
    questionCount: 'string',
    confirmEnabled: 'boolean',
    previousEnabled: 'boolean',
    nextEnabled: 'boolean',
  },
};

export const IMP_PERSONALITY_FINISH_CONTRACT: ControllerContract = {
  id: 'impPersonalityFinish',
  actions: { yes: {}, no: {}, ok: {} },
  bindings: { choosing: 'boolean', chosen: 'boolean', endState: 'number' },
};

export function quizIndent(answer: number, answers: number, question: number): QuizIndent {
  if (answer < ANSWERS_PER_COLUMN) {
    if (answer === ANSWERS_PER_COLUMN - 1 && question === SHORT2_FOURTH_ANSWER_QUESTION) return 'short2';
    return answers < ANSWERS_PER_COLUMN + 1 ? 'long' : 'short';
  }
  if (answer === FIFTH_ANSWER && SHORT2_FIFTH_ANSWER_QUESTIONS.includes(question)) return 'short2';
  if (answer === SIXTH_ANSWER && question === SHORT2_SIXTH_ANSWER_QUESTION) return 'short2';
  return 'short';
}

export interface QuizRecords {
  readonly firstQuestion: number;
  readonly lastFinishRecord: number;
}

export function questionRecord(question: number, answerCounts: readonly number[], male: boolean, records: QuizRecords): number {
  const length = (q: number) => (answerCounts[q] ?? 0) + 1;
  const female = FEMALE_SPECIFIC_QUESTIONS.indexOf(question);
  if (!male && female >= 0) {
    let extra = 0;
    for (let k = 0; k < female; k++) extra += length(FEMALE_SPECIFIC_QUESTIONS[k] as number);
    return records.lastFinishRecord + FEMALE_QUESTIONS_GAP + extra;
  }
  let offset = 0;
  for (let q = 0; q < question; q++) offset += length(q);
  return records.firstQuestion + offset;
}

export function quizPage(imp: ImpContext): LaptopPage {
  const { draft, context } = imp;
  draft.enterQuiz();
  const records: QuizRecords = {
    firstQuestion: context.constant(IMP_QUIZ_LAYOUT, 'IMP_QUESTION_1'),
    lastFinishRecord: context.constant(IMP_QUIZ_LAYOUT, 'IMP_CON_3'),
  };
  const model: Record<string, unknown> = { questionCount: String(QUIZ_QUESTIONS) };
  let shownQuestion = -1;
  const refresh = () => {
    if (draft.question !== shownQuestion) {
      shownQuestion = draft.question;
      draft.showRecordedAnswer();
    }
    const counts = imp.site()?.quizAnswers ?? [];
    const question = Math.min(draft.question, QUIZ_QUESTIONS - 1);
    const answers = counts[question] ?? 0;
    const record = questionRecord(question, counts, draft.male, records);
    model.question = imp.impText(record);
    model.answers = Array.from({ length: answers }, (_, i) => ({
      number: String(i + 1),
      text: imp.impText(record + 1 + i),
      indent: quizIndent(i, answers, question),
      high: draft.answer === i,
      checked: draft.answer === i,
    }));
    model.firstCount = Math.min(answers, ANSWERS_PER_COLUMN);
    model.secondCount = Math.max(0, answers - ANSWERS_PER_COLUMN);
    model.answerWidth = answers <= ANSWERS_PER_COLUMN ? LONG_ANSWER_WIDTH : SHORT_ANSWER_WIDTH;
    model.questionNumber = String(draft.question + 1);
    model.confirmEnabled = draft.answer !== -1;
    model.previousEnabled = draft.canGoBack;
    model.nextEnabled = draft.canGoForward;
  };
  const controller = new ViewModelController(IMP_QUIZ_CONTRACT, model, {
    answer: ([answer]) => {
      if (answer !== undefined) draft.chooseAnswer(answer);
    },
    confirm: () => draft.confirmAnswer(),
    startOver: () => draft.startQuizOver(),
    previous: () => draft.previousQuestionAnswer(),
    next: () => draft.nextQuestion(),
  });
  refresh();
  return { layouts: [{ name: IMP_QUIZ_LAYOUT, controller }], update: refresh, dispose: () => draft.exitQuiz() };
}

export function personalityFinishPage(imp: ImpContext): LaptopPage {
  const { draft } = imp;
  draft.enterPersonalityFinish();
  const model: Record<string, unknown> = {};
  const refresh = () => {
    model.endState = draft.personalityEndState;
    model.chosen = draft.personalityEndState !== 0;
    model.choosing = draft.personalityEndState === 0;
  };
  const controller = new ViewModelController(IMP_PERSONALITY_FINISH_CONTRACT, model, {
    yes: () => {
      if (draft.personalityEndState === 0) draft.personalityConfirmed(true);
    },
    no: () => {
      if (draft.personalityEndState === 0) draft.personalityConfirmed(false);
    },
    ok: () => draft.personalityOk(),
  });
  refresh();
  return { layouts: [{ name: IMP_PERSONALITY_FINISH_LAYOUT, controller }], update: refresh };
}
