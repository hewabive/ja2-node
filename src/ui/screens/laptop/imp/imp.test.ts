import { describe, expect, it } from 'vitest';
import { AttributeSliders } from './imp-attributes.ts';
import { FEMALE, ImpDraft, ImpPage, MALE, NO_ANSWER, ProfileMode, QUIZ_QUESTIONS } from './imp-draft.ts';
import { questionRecord, quizIndent } from './imp-quiz.ts';

const ANSWER_COUNTS = [6, 4, 4, 5, 4, 5, 4, 4, 4, 4, 5, 8, 4, 4, 4, 4];
const RECORDS = { firstQuestion: 54, lastFinishRecord: 208 };
const GEOMETRY = { startX: 297, barWidth: 226, thumbWidth: 37, pixelUnit: 193 };

function begun(): ImpDraft {
  const draft = new ImpDraft();
  draft.acceptCode('XEP624');
  draft.restartFromMain();
  draft.enterBegin();
  draft.selectGender(true, true);
  draft.beginDone('Ivan Testovich Petrov', '');
  draft.exitBegin();
  return draft;
}

describe('the I.M.P. draft', () => {
  it('needs a name and a gender, derives the nickname from the first name and unlocks the personality', () => {
    const draft = new ImpDraft();
    draft.enterBegin();
    expect(draft.beginDone('  ', 'x')).toBe('needsNameAndGender');
    draft.selectGender(false, false);
    expect(draft.genderFlag).toBe(-1);
    draft.selectGender(false, true);
    expect(draft.genderFlag).toBe(FEMALE);
    expect(draft.beginDone(' Annabelle-Marie Smith ', '')).toBe('main');
    draft.exitBegin();
    expect([draft.fullName, draft.nickName, draft.male, draft.page, draft.profileMode]).toEqual([
      'Annabelle-Marie Smith',
      'Annabell',
      false,
      ImpPage.MAIN,
      ProfileMode.PERSONALITY,
    ]);
    expect(draft.mainButtonEnabled('personality')).toBe(true);
    expect([0, 1, 2, 3].map((i) => draft.mainBlockerEnabled(i))).toEqual([false, true, true, true]);
  });

  it('keeps the gender of an earlier pass when the begin page is entered again', () => {
    const draft = begun();
    draft.enterBegin();
    expect(draft.genderFlag).toBe(MALE);
  });

  it('records answers, walks back and forth over answered questions and finishes after the last', () => {
    const draft = begun();
    draft.enterQuiz();
    expect(draft.confirmAnswer()).toBe(false);
    draft.chooseAnswer(2);
    draft.confirmAnswer();
    expect([draft.question, draft.maxQuestion, draft.answer]).toEqual([1, 1, NO_ANSWER]);
    draft.previousQuestionAnswer();
    expect([draft.question, draft.answer]).toEqual([0, 2]);
    draft.nextQuestion();
    draft.showRecordedAnswer();
    expect(draft.answer).toBe(NO_ANSWER);
    for (let q = 1; q < QUIZ_QUESTIONS; q++) {
      draft.chooseAnswer(0);
      draft.confirmAnswer();
    }
    expect(draft.page).toBe(ImpPage.PERSONALITY_FINISH);
    draft.personalityConfirmed(true);
    draft.personalityOk();
    expect([draft.page, draft.profileMode]).toEqual([ImpPage.MAIN, ProfileMode.ATTRIBUTES]);
  });

  it('starts the quiz over from the cancel button and from the start over button', () => {
    const draft = begun();
    draft.page = ImpPage.QUIZ;
    draft.enterQuiz();
    draft.chooseAnswer(1);
    draft.confirmAnswer();
    draft.cancel();
    draft.exitQuiz();
    expect([draft.page, draft.question, draft.maxQuestion]).toEqual([ImpPage.PERSONALITY, 0, 0]);
  });

  it('spends the bonus points within the bounds, zeroes a skill for the bonus and restores it', () => {
    const draft = begun();
    draft.enterAttributes(draft.rules);
    draft.increment('health');
    expect([draft.current.health, draft.bonusPoints]).toEqual([56, 39]);
    for (let i = 0; i < 25; i++) draft.decrement('strength');
    expect(draft.current.strength).toBe(35);
    for (let i = 0; i < 21; i++) draft.decrement('marksmanship');
    expect([draft.current.marksmanship, draft.takeZeroWarning()]).toEqual([0, 'marksmanship']);
    const bonus = draft.bonusPoints;
    draft.jumpTo('marksmanship', 70);
    expect([draft.current.marksmanship, draft.bonusPoints]).toEqual([35, bonus - 15]);
    draft.jumpTo('health', 99);
    expect(draft.current.health).toBe(85);
  });

  it('keeps the attributes when returning to the page and resets them on cancel', () => {
    const draft = begun();
    draft.page = ImpPage.ATTRIBUTE_PAGE;
    draft.enterAttributes(draft.rules);
    draft.increment('wisdom');
    draft.attributesFinished();
    draft.exitAttributes();
    draft.attributesRejected();
    draft.enterAttributes(draft.rules);
    expect(draft.current.wisdom).toBe(56);
    draft.cancel();
    expect([draft.current.wisdom, draft.page]).toEqual([55, ImpPage.MAIN]);
  });

  it('wraps the portraits and voices, finishes after the voice and builds the request', () => {
    const draft = begun();
    draft.enterAttributes(draft.rules);
    draft.increment('agility');
    draft.attributesFinished();
    draft.attributesAccepted();
    draft.enterPortraits(8);
    draft.stepPortrait(-1, 8);
    draft.portraitDone();
    expect([draft.portraitNumber, draft.profileMode]).toEqual([7, ProfileMode.VOICE]);
    draft.enterVoices(3);
    draft.stepVoice(1, 3);
    draft.stepVoice(1, 3);
    draft.stepVoice(1, 3);
    draft.voiceDone();
    expect([draft.page, draft.profileMode, draft.voiceId]).toEqual([ImpPage.FINISH, ProfileMode.DONE, 0]);
    draft.enterFinish();
    expect(draft.reviewStats).toBe(true);
    draft.finishDone();
    expect(draft.page).toBe(ImpPage.CONFIRM);
    expect(draft.request()).toMatchObject({
      code: 'XEP624',
      name: 'Ivan Testovich Petrov',
      nickname: 'Ivan',
      gender: 'male',
      portrait: 7,
      voice: 0,
      attributes: { agility: 56, health: 55 },
    });
    draft.confirmed();
    expect([draft.page, draft.fullName]).toEqual([ImpPage.HOME, '']);
  });

  it('sends the finish page back to the main page in the voice step on cancel', () => {
    const draft = begun();
    draft.page = ImpPage.FINISH;
    draft.enterFinish();
    draft.cancel();
    expect([draft.page, draft.profileMode]).toEqual([ImpPage.MAIN, ProfileMode.VOICE]);
  });
});

describe('the I.M.P. quiz text records', () => {
  it('sums the question lengths for men and moves five questions behind the confirm page for women', () => {
    expect(questionRecord(0, ANSWER_COUNTS, true, RECORDS)).toBe(54);
    expect(questionRecord(2, ANSWER_COUNTS, true, RECORDS)).toBe(54 + 7 + 5);
    expect(questionRecord(2, ANSWER_COUNTS, false, RECORDS)).toBe(54 + 7 + 5);
    expect(questionRecord(0, ANSWER_COUNTS, false, RECORDS)).toBe(211);
    expect(questionRecord(3, ANSWER_COUNTS, false, RECORDS)).toBe(211 + 7);
    expect(questionRecord(13, ANSWER_COUNTS, false, RECORDS)).toBe(211 + 7 + 6 + 5 + 5);
  });

  it('chooses the long, short and short2 indents like BltAnswerIndents', () => {
    expect([0, 1, 2, 3].map((i) => quizIndent(i, 4, 1))).toEqual(['long', 'long', 'long', 'long']);
    expect([0, 3, 4, 5].map((i) => quizIndent(i, 6, 0))).toEqual(['short', 'short', 'short', 'short']);
    expect([3, 4].map((i) => quizIndent(i, 5, 5))).toEqual(['short2', 'short2']);
    expect(quizIndent(4, 5, 10)).toBe('short2');
    expect(quizIndent(5, 6, 19)).toBe('short2');
  });
});

describe('the I.M.P. attribute sliders', () => {
  function sliders(): { draft: ImpDraft; s: AttributeSliders } {
    const draft = begun();
    draft.enterAttributes(draft.rules);
    return { draft, s: new AttributeSliders(draft, GEOMETRY) };
  }

  it('drags from the slider, follows the mouse while held and ends the drag on release', () => {
    const { draft, s } = sliders();
    s.down(0, 380);
    expect(s.slideActive).toBe(true);
    s.repeat(0, 380);
    s.repeat(0, 400);
    expect(draft.current.health).toBe(61);
    expect(s.scrollBox).toBe(0);
    s.repeat(1, 450);
    expect(draft.current.dexterity).toBe(55);
    s.frame(true, 600);
    expect(draft.current.health).toBe(62);
    s.up(0, 600);
    expect([s.slideActive, draft.current.health]).toEqual([false, 62]);
    s.frame(false, 600);
    expect(s.scrollBox).toBe(-1);
  });

  it('jumps to a clicked value away from the slider', () => {
    const { draft, s } = sliders();
    s.down(3, 320);
    expect(s.slideActive).toBe(false);
    s.up(3, 320);
    expect(draft.current.strength).toBe(40);
  });
});
