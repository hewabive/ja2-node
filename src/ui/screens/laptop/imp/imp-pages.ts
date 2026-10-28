// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/IMP_HomePage.cc ProcessPlayerInputActivationString (the code accepted and a slot free, otherwise
// @src pImpPopUpStrings[6] or [0]), GetPlayerKeyBoardInputForIMPHomePage (Enter on key up), BtnIMPAboutUsCallback;
// @src IMP_AboutUs.cc BtnIMPBackCallback; IMP_MainPage.cc CreateIMPMainPageButtons (the begin label, pImpButtonText[1]
// @src or [22], the voice label), BtnIMPMainPageBeginCallback (the restart question past the attributes, the balance and
// @src the team size), UpDateIMPMainPageButtons, IMPMainPageNotSelectableBtnCallback, LoadCharacterPortraitForMainPage
// @src (the face from the voice step on); IMP_Text_System.cc PrintImpText (the main page's status line: IMP_MAIN_2 or
// @src pExtraIMPStrings); IMP_Begin_Screen.cc EnterIMPBeginScreen, BtnIMPBeginScreenDoneCallback, Select*RegionCallBack,
// @src RenderGender; IMP_Personality_Entrance.cc and IMP_Attribute_Entrance.cc the begin buttons; IMP_Finish.cc
// @src RenderCharFullName, BtnIMPFinishStartOverCallback, BtnIMPFinishDoneCallback, BtnIMPFinishPersonalityCallback (the
// @src analysing label and the icon flipping every ANIMATE_MIN_TIME while pressed), BtnIMPFinishAttributesCallback;
// @src IMP_Confirm.cc BtnIMPConfirmYes, BtnIMPConfirmNo.

import type { ControllerContract } from '../../../layout/controller.ts';
import { ViewModelController } from '../../../layout/controller.ts';
import { printf } from '../../../text/printf.ts';
import { MessageBoxFlag, MessageBoxReturn } from '../../../widgets/message-box.ts';
import { portraitPath } from '../../../widgets/portrait.ts';
import type { LaptopPage } from '../laptop-page.ts';
import { FEMALE, ImpPage, MALE, ProfileMode } from './imp-draft.ts';
import { currentPortraitFace, IMP_BUTTON_TEXT, type ImpContext, ImpPopUp } from './imp-site.ts';

export const IMP_HOME_LAYOUT = 'imp-home';
export const IMP_ABOUT_US_LAYOUT = 'imp-about-us';
export const IMP_MAIN_LAYOUT = 'imp-main';
export const IMP_BEGIN_LAYOUT = 'imp-begin';
export const IMP_PERSONALITY_LAYOUT = 'imp-personality';
export const IMP_ATTRIBUTE_ENTRANCE_LAYOUT = 'imp-attribute-entrance';
export const IMP_FINISH_LAYOUT = 'imp-finish';
export const IMP_CONFIRM_LAYOUT = 'imp-confirm';

const EXTRA_IMP_STRINGS = 'pExtraIMPStrings';
const FINISH_STRINGS = 'pIMPFinishStrings';
const IMP_MAIN_2 = 'IMP_MAIN_2';
const ANIMATE_MIN_TIME = 'ANIMATE_MIN_TIME';
const MAIN_BLOCKERS = 4;
const GENDER_MARK = 'X';

const ButtonText = {
  BEGIN: 1,
  PERSONALITY: 2,
  VOICE_NUMBER: 5,
  CONTINUE: 22,
  ANALYSING: 23,
  VOICE: 25,
  SKILLS: 26,
} as const;

export const IMP_HOME_CONTRACT: ControllerContract = {
  id: 'impHome',
  actions: { aboutUs: {}, activate: {}, setCode: { payload: 'string' } },
  bindings: { code: 'string' },
};

export const IMP_ABOUT_US_CONTRACT: ControllerContract = { id: 'impAboutUs', actions: { back: {} }, bindings: {} };

export const IMP_MAIN_CONTRACT: ControllerContract = {
  id: 'impMain',
  actions: { back: {}, begin: {}, personality: {}, attributes: {}, portrait: {}, voice: {}, blocked: {} },
  bindings: {
    beginLabel: 'string',
    personalityLabel: 'string',
    voiceLabel: 'string',
    status: 'string',
    personalityEnabled: 'boolean',
    attributesEnabled: 'boolean',
    portraitEnabled: 'boolean',
    voiceEnabled: 'boolean',
    blockers: 'list',
    face: 'number',
    faceShown: 'boolean',
  },
};

export const IMP_BEGIN_CONTRACT: ControllerContract = {
  id: 'impBegin',
  actions: { done: {}, setFullName: { payload: 'string' }, setNickName: { payload: 'string' }, male: {}, female: {} },
  bindings: { fullName: 'string', nickName: 'string', maleChecked: 'boolean', femaleChecked: 'boolean', genderMark: 'string' },
};

export const IMP_PERSONALITY_CONTRACT: ControllerContract = { id: 'impPersonality', actions: { begin: {} }, bindings: {} };

export const IMP_ATTRIBUTE_ENTRANCE_CONTRACT: ControllerContract = { id: 'impAttributeEntrance', actions: { begin: {} }, bindings: {} };

export const IMP_FINISH_CONTRACT: ControllerContract = {
  id: 'impFinish',
  actions: {
    startOver: {},
    done: {},
    personalityDown: {},
    personalityPress: {},
    personalityUp: {},
    attributes: {},
    portrait: {},
    voice: {},
  },
  bindings: { fullName: 'string', personalityLabel: 'string', voiceLabel: 'string', analyseFrame: 'number', face: 'number' },
};

export const IMP_CONFIRM_CONTRACT: ControllerContract = { id: 'impConfirm', actions: { yes: {}, no: {} }, bindings: {} };

function buttonText(imp: ImpContext, index: number): string {
  return imp.context.string(IMP_BUTTON_TEXT, index);
}

function personalityLabel(imp: ImpContext): string {
  return buttonText(imp, imp.site()?.pickSkillsDirectly === true ? ButtonText.SKILLS : ButtonText.PERSONALITY);
}

function loadFace(imp: ImpContext): number | null {
  const face = currentPortraitFace(imp);
  if (face !== null) void imp.context.media.loadImages([portraitPath(face, 'small')]);
  return face;
}

export function homePage(imp: ImpContext): LaptopPage {
  const model: Record<string, unknown> = { code: '' };
  let checking = false;
  let disposed = false;
  const activate = () => {
    if (checking) return;
    checking = true;
    const code = String(model.code ?? '');
    void imp.context.command({ type: 'impCheckCode', code }).then((reply) => {
      checking = false;
      if (disposed) return;
      const result = (reply.data as { result?: string } | undefined)?.result;
      if (reply.ok && result === 'ok') {
        imp.draft.acceptCode(code);
        return;
      }
      imp.popUp(result === 'noSlot' ? ImpPopUp.NO_SLOT : ImpPopUp.BAD_CODE, MessageBoxFlag.OK);
    });
  };
  const controller = new ViewModelController(IMP_HOME_CONTRACT, model, {
    aboutUs: () => {
      imp.draft.page = ImpPage.ABOUT_US;
    },
    activate,
    setCode: (_args, text) => {
      model.code = text ?? '';
    },
  });
  return {
    layouts: [{ name: IMP_HOME_LAYOUT, controller }],
    update: () => undefined,
    dispose: () => {
      disposed = true;
    },
  };
}

export function aboutUsPage(imp: ImpContext): LaptopPage {
  const controller = new ViewModelController(
    IMP_ABOUT_US_CONTRACT,
    {},
    {
      back: () => {
        imp.draft.page = ImpPage.HOME;
      },
    },
  );
  return { layouts: [{ name: IMP_ABOUT_US_LAYOUT, controller }], update: () => undefined };
}

function mainStatus(imp: ImpContext): string {
  const mode = imp.draft.profileMode;
  if (mode === ProfileMode.BEGINNING) return imp.impText(imp.context.constant(IMP_MAIN_LAYOUT, IMP_MAIN_2));
  return mode <= ProfileMode.VOICE ? imp.context.string(EXTRA_IMP_STRINGS, mode - 1) : '';
}

export function mainPage(imp: ImpContext): LaptopPage {
  const { draft } = imp;
  draft.enterMain();
  const mode = draft.profileMode;
  const face = mode >= ProfileMode.VOICE ? loadFace(imp) : null;
  const model: Record<string, unknown> = {
    beginLabel: buttonText(imp, mode === ProfileMode.BEGINNING || mode > ProfileMode.ATTRIBUTES ? ButtonText.BEGIN : ButtonText.CONTINUE),
    personalityLabel: personalityLabel(imp),
    voiceLabel:
      mode === ProfileMode.DONE ? printf(buttonText(imp, ButtonText.VOICE_NUMBER), [draft.voice + 1]) : buttonText(imp, ButtonText.VOICE),
    status: mainStatus(imp),
    face: face ?? 0,
    faceShown: face !== null,
  };
  const refresh = () => {
    if (draft.profileMode === ProfileMode.DONE) draft.page = ImpPage.FINISH;
    model.personalityEnabled = draft.mainButtonEnabled('personality');
    model.attributesEnabled = draft.mainButtonEnabled('attributes');
    model.portraitEnabled = draft.mainButtonEnabled('portrait');
    model.voiceEnabled = draft.mainButtonEnabled('voice');
    model.blockers = Array.from({ length: MAIN_BLOCKERS }, (_, i) => draft.mainBlockerEnabled(i));
  };
  const begin = () => {
    if (draft.profileMode > ProfileMode.ATTRIBUTES) {
      imp.popUp(ImpPopUp.START_OVER, MessageBoxFlag.YESNO, (result) => {
        if (result === MessageBoxReturn.YES) draft.restartFromMain();
      });
      return;
    }
    const refusal = imp.site()?.beginRefusal ?? null;
    if (refusal === 'funds') imp.popUp(ImpPopUp.FUNDS, MessageBoxFlag.OK);
    else if (refusal === 'teamFull') imp.popUp(ImpPopUp.TEAM_FULL, MessageBoxFlag.OK);
    else draft.page = ImpPage.BEGIN;
  };
  const controller = new ViewModelController(IMP_MAIN_CONTRACT, model, {
    back: () => draft.backToHome(),
    begin,
    personality: () => {
      if (draft.mainButtonEnabled('personality')) draft.page = ImpPage.PERSONALITY;
    },
    attributes: () => {
      if (draft.mainButtonEnabled('attributes')) draft.page = ImpPage.ATTRIBUTE_ENTRANCE;
    },
    portrait: () => {
      if (draft.mainButtonEnabled('portrait')) draft.page = ImpPage.PORTRAIT;
    },
    voice: () => {
      if (draft.mainButtonEnabled('voice')) draft.page = ImpPage.VOICE;
    },
    blocked: () => imp.popUp(ImpPopUp.NOT_YET, MessageBoxFlag.OK),
  });
  refresh();
  return { layouts: [{ name: IMP_MAIN_LAYOUT, controller }], update: refresh };
}

export function beginPage(imp: ImpContext): LaptopPage {
  const { draft } = imp;
  draft.enterBegin();
  const model: Record<string, unknown> = { fullName: draft.fullName, nickName: draft.nickName, genderMark: GENDER_MARK };
  const refresh = () => {
    model.maleChecked = draft.genderFlag === MALE;
    model.femaleChecked = draft.genderFlag === FEMALE;
  };
  const canCreate = () => imp.site()?.canCreate ?? false;
  const controller = new ViewModelController(IMP_BEGIN_CONTRACT, model, {
    done: () => {
      if (draft.beginDone(String(model.fullName ?? ''), String(model.nickName ?? '')) === 'needsNameAndGender')
        imp.popUp(ImpPopUp.NAME_AND_GENDER, MessageBoxFlag.OK);
    },
    setFullName: (_args, text) => {
      model.fullName = text ?? '';
    },
    setNickName: (_args, text) => {
      model.nickName = text ?? '';
    },
    male: () => draft.selectGender(true, canCreate()),
    female: () => draft.selectGender(false, canCreate()),
  });
  refresh();
  return { layouts: [{ name: IMP_BEGIN_LAYOUT, controller }], update: refresh, dispose: () => draft.exitBegin() };
}

export function personalityEntrancePage(imp: ImpContext): LaptopPage {
  const controller = new ViewModelController(
    IMP_PERSONALITY_CONTRACT,
    {},
    {
      begin: () => {
        imp.draft.page = imp.site()?.pickSkillsDirectly === true ? ImpPage.SKILLTRAITS : ImpPage.QUIZ;
      },
    },
  );
  return { layouts: [{ name: IMP_PERSONALITY_LAYOUT, controller }], update: () => undefined };
}

export function attributeEntrancePage(imp: ImpContext): LaptopPage {
  const controller = new ViewModelController(
    IMP_ATTRIBUTE_ENTRANCE_CONTRACT,
    {},
    {
      begin: () => {
        imp.draft.page = ImpPage.ATTRIBUTE_PAGE;
      },
    },
  );
  return { layouts: [{ name: IMP_ATTRIBUTE_ENTRANCE_LAYOUT, controller }], update: () => undefined };
}

export function finishPage(imp: ImpContext): LaptopPage {
  const { draft, context } = imp;
  draft.enterFinish();
  const face = loadFace(imp);
  const model: Record<string, unknown> = {
    fullName: printf(context.string(FINISH_STRINGS, 0), [draft.fullName]),
    personalityLabel: personalityLabel(imp),
    voiceLabel: printf(buttonText(imp, ButtonText.VOICE_NUMBER), [draft.voice + 1]),
    analyseFrame: 0,
    face: face ?? 0,
  };
  const animateTime = context.constant(IMP_FINISH_LAYOUT, ANIMATE_MIN_TIME);
  const now = () => context.services.clock.ja2Now;
  let animating = false;
  let flipped = false;
  let baseTime = 0;
  const animate = () => {
    if (!animating || now() - baseTime <= animateTime) return;
    baseTime = now();
    flipped = !flipped;
    model.analyseFrame = flipped ? 0 : 1;
  };
  const controller = new ViewModelController(IMP_FINISH_CONTRACT, model, {
    startOver: () =>
      imp.popUp(ImpPopUp.START_OVER, MessageBoxFlag.YESNO, (result) => {
        if (result === MessageBoxReturn.YES) draft.backToHome();
      }),
    done: () => draft.finishDone(),
    personalityDown: () => {
      baseTime = now();
      model.personalityLabel = buttonText(imp, ButtonText.ANALYSING);
      animating = true;
    },
    personalityPress: animate,
    personalityUp: () => {
      baseTime = 0;
      animating = false;
      model.personalityLabel = personalityLabel(imp);
      if (imp.site()?.pickSkillsDirectly === true) draft.page = ImpPage.SKILLTRAITS;
    },
    attributes: () => {
      draft.page = ImpPage.ATTRIBUTE_PAGE;
      model.personalityLabel = personalityLabel(imp);
    },
    portrait: () => {
      draft.page = ImpPage.PORTRAIT;
    },
    voice: () => {
      draft.page = ImpPage.VOICE;
    },
  });
  return { layouts: [{ name: IMP_FINISH_LAYOUT, controller }], update: () => undefined };
}

export function confirmPage(imp: ImpContext): LaptopPage {
  const { draft } = imp;
  let busy = false;
  let disposed = false;
  const controller = new ViewModelController(
    IMP_CONFIRM_CONTRACT,
    {},
    {
      yes: () => {
        if (busy) return;
        busy = true;
        void imp.context.command({ type: 'impCreate', ...draft.request() }).then((reply) => {
          busy = false;
          if (!disposed && reply.ok) draft.confirmed();
        });
      },
      no: () => {
        draft.page = ImpPage.FINISH;
      },
    },
  );
  return {
    layouts: [{ name: IMP_CONFIRM_LAYOUT, controller }],
    update: () => undefined,
    dispose: () => {
      disposed = true;
    },
  };
}
