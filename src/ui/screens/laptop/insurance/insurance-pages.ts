// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Insurance.cc EnterInsurance (gusCurrentInsuranceMercIndex reset), InitInsuranceDefaults,
// @src SelectInsuranceRegionCallBack, SelectInsuranceTitleLinkRegionCallBack; src/game/Laptop/Insurance_Info.cc
// @src EnterInitInsuranceInfo (only the first INS_INFO_LAST_PAGE - 1 visited flags are cleared on each laptop entry),
// @src EnterInsuranceInfo (the table of contents first), BtnInsPrevButtonCallback, BtnInsNextButtonCallback,
// @src ChangingInsuranceInfoSubPage, SelectInsuranceLinkRegionCallBack, SelectInsuranceInfoHomeLinkRegionCallBack;
// @src src/game/Laptop/Insurance_Contract.cc DisplayOrderGrid (the card texts), BtnInsuranceAcceptClearFormButtonCallback,
// @src HandleAcceptButton, PurchaseOrExtendInsuranceForSoldier (the "not enough funds" box), RenderInsuranceContract (the
// @src box when nobody is insurable), InsContractNoMercsPopupCallBack, BtnInsContractPrevButtonCallback,
// @src BtnInsContractNextButtonCallBack, SelectInsuranceContractRegionCallBack; src/game/Laptop/Insurance_Comments.cc
// @src SelectInsuranceCommentLinkRegionCallBack. See docs/28 §9.8.

import type { InsuranceOfferView } from '../../../../protocol/view.ts';
import type { DrawList } from '../../../draw-list.ts';
import { type ControllerContract, ViewModelController } from '../../../layout/controller.ts';
import type { CustomRenderer } from '../../../layout/view.ts';
import { sprintMoney } from '../../../text/money.ts';
import { MessageBoxFlag, MessageBoxReturn, MessageBoxStyleId } from '../../../widgets/message-box.ts';
import { portraitPath } from '../../../widgets/portrait.ts';
import type { LaptopMemory } from '../laptop-client.ts';
import { LaptopMode } from '../laptop-modes.ts';
import type { LaptopContext, LaptopPage, PageLayout } from '../laptop-page.ts';
import type { LaptopShell } from '../laptop-shell.ts';
import {
  drawInsuranceComments,
  drawInsuranceInfoPage,
  INSURANCE_INFO_PAGES,
  INSURANCE_INFO_TITLES,
  InsuranceInfoPage,
  InsurancePen,
} from './insurance-flow.ts';
import {
  contractStatus,
  displayedGrids,
  INSURANCE_TEXT_FILES,
  InsuranceText,
  insuranceTextRow,
  nextGridIndex,
  nextGridsEnabled,
  previousGridIndex,
  previousGridsEnabled,
} from './insurance-text.ts';

export const INSURANCE_CHROME_LAYOUT = 'insurance-chrome';
export const INSURANCE_HOME_LAYOUT = 'insurance-home';
export const INSURANCE_INFO_LAYOUT = 'insurance-info';
export const INSURANCE_CONTRACT_LAYOUT = 'insurance-contract';
export const INSURANCE_COMMENTS_LAYOUT = 'insurance-comments';

const MESSAGE_STRINGS = 'pMessageStrings';
const MSG_LOWERCASE_NA = 20;
const ZERO_MONEY = '$0';
const NO_INSURED_DAYS = '0';
const SINGLE_FLAG_PAGES = INSURANCE_INFO_PAGES - 1;

export const INSURANCE_CHROME_CONTRACT: ControllerContract = {
  id: 'insuranceChrome',
  actions: { goHome: {} },
  bindings: { home: 'boolean' },
};
export const INSURANCE_HOME_CONTRACT: ControllerContract = {
  id: 'insuranceHome',
  actions: { comments: {}, info: {}, contract: {} },
  bindings: {},
};
export const INSURANCE_INFO_CONTRACT: ControllerContract = {
  id: 'insuranceInfo',
  actions: { previous: {}, next: {}, home: {}, contract: {} },
  bindings: { subPage: 'number', title: 'string', previousEnabled: 'boolean', nextEnabled: 'boolean' },
};
export const INSURANCE_CONTRACT_CONTRACT: ControllerContract = {
  id: 'insuranceContract',
  actions: { accept: { args: 1 }, previous: {}, next: {}, home: {}, info: {} },
  bindings: { cards: 'list', previousEnabled: 'boolean', nextEnabled: 'boolean' },
};
export const INSURANCE_COMMENTS_CONTRACT: ControllerContract = {
  id: 'insuranceComments',
  actions: { home: {}, info: {}, contract: {} },
  bindings: {},
};

export interface InsuranceCard {
  readonly soldier: number;
  readonly face: number;
  readonly state: 'dead' | 'normal';
  readonly nickname: string;
  readonly status: string;
  readonly statusColor: 'red' | 'normal';
  readonly contractLength: string;
  readonly contractDays: string;
  readonly insuredDays: string;
  readonly premium: string;
  readonly offeredLength: string;
  readonly canAccept: boolean;
}

export function insuranceCard(offer: InsuranceOfferView, face: number, text: (n: number) => string, notApplicable: string): InsuranceCard {
  const status = contractStatus(offer);
  const canAccept = offer.offeredLength !== 0;
  return {
    soldier: offer.soldier,
    face,
    state: offer.dead ? 'dead' : 'normal',
    nickname: offer.nickname,
    status: text(status.text),
    statusColor: status.red ? 'red' : 'normal',
    contractLength: String(offer.contractLength),
    contractDays: offer.dead ? notApplicable : String(offer.contractDaysLeft),
    insuredDays: offer.dead ? notApplicable : offer.insured ? String(offer.insuredDaysLeft) : NO_INSURED_DAYS,
    premium: offer.dead ? ZERO_MONEY : sprintMoney(canAccept ? offer.premium : 0),
    offeredLength: String(offer.offeredLength),
    canAccept,
  };
}

function insuranceText(context: LaptopContext): (n: number) => string {
  return (n) => {
    const { file, row } = insuranceTextRow(n);
    return context.text.edt(file, row) ?? '';
  };
}

function chrome(context: LaptopContext, home: boolean): PageLayout {
  return {
    name: INSURANCE_CHROME_LAYOUT,
    controller: new ViewModelController(INSURANCE_CHROME_CONTRACT, { home }, { goHome: () => context.shell.setPage(LaptopMode.INSURANCE) }),
  };
}

function loadTexts(context: LaptopContext): void {
  void context.media.loadTexts(INSURANCE_TEXT_FILES);
}

export function insuranceHomePage(context: LaptopContext): LaptopPage {
  loadTexts(context);
  context.memory.pages.insuranceMercIndex = 0;
  const controller = new ViewModelController(
    INSURANCE_HOME_CONTRACT,
    {},
    {
      comments: () => context.shell.setPage(LaptopMode.INSURANCE_COMMENTS),
      info: () => context.shell.setPage(LaptopMode.INSURANCE_INFO),
      contract: () => context.shell.setPage(LaptopMode.INSURANCE_CONTRACT),
    },
  );
  return { layouts: [chrome(context, true), { name: INSURANCE_HOME_LAYOUT, controller }], update: () => undefined };
}

const visitedThisLaptopSession = new WeakMap<LaptopShell, Set<number>>();
const visitedThisGame = new WeakMap<LaptopMemory, Set<number>>();

export class InfoSubPagesVisited {
  readonly #session: Set<number>;
  readonly #game: Set<number>;

  constructor(session: Set<number>, game: Set<number>) {
    this.#session = session;
    this.#game = game;
  }

  #flags(page: number): Set<number> {
    return page < SINGLE_FLAG_PAGES ? this.#session : this.#game;
  }

  visit(page: number): boolean {
    const flags = this.#flags(page);
    const visited = flags.has(page);
    flags.add(page);
    return visited;
  }
}

function infoVisited(context: LaptopContext): InfoSubPagesVisited {
  const session = visitedThisLaptopSession.get(context.shell) ?? new Set<number>();
  visitedThisLaptopSession.set(context.shell, session);
  const game = visitedThisGame.get(context.memory) ?? new Set<number>();
  visitedThisGame.set(context.memory, game);
  return new InfoSubPagesVisited(session, game);
}

export function insuranceInfoPage(context: LaptopContext): LaptopPage {
  loadTexts(context);
  const text = insuranceText(context);
  const visited = infoVisited(context);
  let subPage: number = InsuranceInfoPage.TOC;
  const model: Record<string, unknown> = {};
  const refresh = () => {
    model.subPage = subPage;
    model.title = subPage === InsuranceInfoPage.TOC ? '' : text(INSURANCE_INFO_TITLES[subPage] ?? 0);
    model.previousEnabled = subPage !== InsuranceInfoPage.TOC;
    model.nextEnabled = subPage !== INSURANCE_INFO_PAGES - 1;
  };
  const change = (page: number) => {
    subPage = page;
    context.shell.connectToSubPage(visited.visit(page));
    refresh();
  };
  const controller = new ViewModelController(INSURANCE_INFO_CONTRACT, model, {
    previous: () => change(subPage > 0 ? subPage - 1 : subPage),
    next: () => change(subPage < INSURANCE_INFO_PAGES - 1 ? subPage + 1 : subPage),
    home: () => context.shell.setPage(LaptopMode.INSURANCE),
    contract: () => context.shell.setPage(LaptopMode.INSURANCE_CONTRACT),
  });
  const draw: CustomRenderer = (list: DrawList, rect, _params, view) =>
    drawInsuranceInfoPage(new InsurancePen(list, view, rect, text), subPage);
  refresh();
  return {
    layouts: [chrome(context, false), { name: INSURANCE_INFO_LAYOUT, controller }],
    custom: { insuranceInfoText: draw },
    update: refresh,
  };
}

export function insuranceContractPage(context: LaptopContext): LaptopPage {
  loadTexts(context);
  const text = insuranceText(context);
  const memory = context.memory.pages;
  const model: Record<string, unknown> = {};
  let noMercsBoxShown = false;
  const offers = () => context.view()?.insurance ?? [];
  const faceOf = (profile: number) => context.data.profile(profile)?.faceIndex ?? profile;
  void context.media.loadImages(offers().map((o) => portraitPath(faceOf(o.profile), 'small')));
  const refresh = () => {
    const all = offers();
    const index = memory.insuranceMercIndex;
    const shown = all.slice(index, index + displayedGrids(all.length, index));
    const notApplicable = context.string(MESSAGE_STRINGS, MSG_LOWERCASE_NA);
    model.cards = shown.map((o) => insuranceCard(o, faceOf(o.profile), text, notApplicable));
    model.previousEnabled = previousGridsEnabled(index);
    model.nextEnabled = nextGridsEnabled(all.length, index);
  };
  const showNoMercsBox = () => {
    const view = context.view();
    if (noMercsBoxShown || !view || view.insurance.length > 0) return;
    noMercsBoxShown = true;
    const message = view.aimMercsOnTeam ? InsuranceText.ALL_AIM_MERCS_ON_SHORT_CONTRACT : InsuranceText.NO_QUALIFIED_MERCS;
    context.messageBox(
      text(message),
      MessageBoxFlag.OK,
      (result) => {
        if (result === MessageBoxReturn.OK) context.shell.setPage(LaptopMode.INSURANCE);
      },
      MessageBoxStyleId.RED_ON_WHITE,
    );
  };
  const accept = (soldier: number) => {
    void context.command({ type: 'insure', soldier }).then((reply) => {
      if (!reply.ok && reply.reason === 'funds')
        context.messageBox(text(InsuranceText.NOT_ENOUGH_FUNDS), MessageBoxFlag.OK, undefined, MessageBoxStyleId.RED_ON_WHITE);
    });
  };
  const controller = new ViewModelController(INSURANCE_CONTRACT_CONTRACT, model, {
    accept: ([i]) => {
      const card = (model.cards as readonly InsuranceCard[] | undefined)?.[i ?? 0];
      if (card?.canAccept) accept(card.soldier);
    },
    previous: () => {
      memory.insuranceMercIndex = previousGridIndex(memory.insuranceMercIndex);
    },
    next: () => {
      memory.insuranceMercIndex = nextGridIndex(memory.insuranceMercIndex);
    },
    home: () => context.shell.setPage(LaptopMode.INSURANCE),
    info: () => context.shell.setPage(LaptopMode.INSURANCE_INFO),
  });
  refresh();
  return {
    layouts: [chrome(context, false), { name: INSURANCE_CONTRACT_LAYOUT, controller }],
    update: () => {
      refresh();
      showNoMercsBox();
    },
  };
}

export function insuranceCommentsPage(context: LaptopContext): LaptopPage {
  loadTexts(context);
  const text = insuranceText(context);
  const controller = new ViewModelController(
    INSURANCE_COMMENTS_CONTRACT,
    {},
    {
      home: () => context.shell.setPage(LaptopMode.INSURANCE),
      info: () => context.shell.setPage(LaptopMode.INSURANCE_INFO),
      contract: () => context.shell.setPage(LaptopMode.INSURANCE_CONTRACT),
    },
  );
  const draw: CustomRenderer = (list, rect, _params, view) => drawInsuranceComments(new InsurancePen(list, view, rect, text));
  return {
    layouts: [chrome(context, false), { name: INSURANCE_COMMENTS_LAYOUT, controller }],
    custom: { insuranceComments: draw },
    update: () => undefined,
  };
}
