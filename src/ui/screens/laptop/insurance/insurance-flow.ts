// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Insurance_Info.cc DisplayInfoTocPage, DisplaySubmitClaimPage, DisplayPremiumPage,
// @src DisplayRenewingPremiumPage, DisplayCancelationPagePage (paragraphs stacked by their DisplayWrappedString heights and
// @src INS_INFO_SPACE_BN_PARAGRAPHS, the bullets, the big red FRAUD followed by a paragraph that starts after its width);
// @src src/game/Laptop/Insurance_Comments.cc DisplayComment (the bullet, the comment, the red line under it and the
// @src commenter's name right-aligned 4 pixels lower); src/game/Laptop/Insurance.cc DisplaySmallRedLineWithShadow (a red
// @src line and a black one a pixel lower right). See docs/28 §9.8.

import { type Area, type DrawList, rgb } from '../../../draw-list.ts';
import type { LayoutView } from '../../../layout/view.ts';
import { stringPixLength } from '../../../text/measure.ts';
import { displayWrappedString, drawTextToScreen, TextFlag } from '../../../text/wrap.ts';
import { InsuranceText } from './insurance-text.ts';

export type InsuranceFontName = 'INS_FONT_BIG' | 'INS_FONT_MED' | 'INS_FONT_SMALL';

const RED_LINE = rgb(255, 0, 0);
const LINE_SHADOW = rgb(0, 0, 0);
const BLACK_BACKGROUND = 0;
const PARAGRAPH_GAP = 2;
const FRAUD_TEXT_GAP = 2;
const SUBTITLE_LINE_DY = 12;
const BULLET_ASSET = 'bullet';
const COMMENT_NAME_DY = 4;

export const InsuranceInfoPage = { TOC: 0, SUBMIT_CLAIM: 1, PREMIUMS: 2, RENEWAL: 3, CANCELLATION: 4 } as const;
export const INSURANCE_INFO_PAGES = 5;

export const INSURANCE_COMMENTS: readonly (readonly [name: number, comment: number])[] = [
  [InsuranceText.GUS_TARBALLS, InsuranceText.GUS_SPEECH],
  [InsuranceText.ALI_HUSSEAN, InsuranceText.ALI_HUSSEAN_SPEECH],
  [InsuranceText.LANCE_ALLOT, InsuranceText.LANCE_ALLOT_SPEECH],
  [InsuranceText.FRED_COUSTEAU, InsuranceText.FRED_COUSTEAU_SPEECH],
];

export const INSURANCE_INFO_TITLES: readonly number[] = [
  InsuranceText.HOW_DOES_INS_WORK,
  InsuranceText.SUBMITTING_CLAIM,
  InsuranceText.PREMIUMS,
  InsuranceText.RENEWL_PREMIUMS,
  InsuranceText.POLICY_CANCELATIONS,
];

export class InsurancePen {
  readonly #list: DrawList;
  readonly #view: LayoutView;
  readonly #origin: Area;
  readonly #text: (n: number) => string;

  constructor(list: DrawList, view: LayoutView, origin: Area, text: (n: number) => string) {
    this.#list = list;
    this.#view = view;
    this.#origin = origin;
    this.#text = text;
  }

  c(name: string): number {
    return this.#view.model.number(name);
  }

  text(n: number): string {
    return this.#text(n);
  }

  #font(name: InsuranceFontName) {
    return this.#view.services.fonts.get(this.#view.model.font(name));
  }

  #colors(color: string) {
    const model = this.#view.model;
    return { foreground: model.color(color, 0), shadow: model.color('INS_FONT_SHADOW', 0), background: BLACK_BACKGROUND };
  }

  width(n: number, font: InsuranceFontName): number {
    return stringPixLength(this.#text(n), this.#font(font));
  }

  wrapped(x: number, y: number, width: number, font: InsuranceFontName, color: string, n: number): number {
    const o = this.#origin;
    return displayWrappedString(
      this.#list,
      o.x + x,
      o.y + y,
      width,
      PARAGRAPH_GAP,
      this.#font(font),
      this.#colors(color),
      this.#text(n),
      TextFlag.LEFT_JUSTIFIED,
    );
  }

  draw(x: number, y: number, width: number, font: InsuranceFontName, color: string, n: number, flags: number): void {
    const o = this.#origin;
    drawTextToScreen(this.#list, this.#text(n), o.x + x, o.y + y, width, this.#font(font), this.#colors(color), flags);
  }

  bullet(x: number, y: number): void {
    this.#list.image(this.#view.model.asset(BULLET_ASSET).path, 0, this.#origin.x + x, this.#origin.y + y);
  }

  redLine(x1: number, y: number, x2: number): void {
    const o = this.#origin;
    this.#list.line(o.x + x1, o.y + y, o.x + x2, o.y + y, RED_LINE);
    this.#list.line(o.x + x1 + 1, o.y + y + 1, o.x + x2 + 1, o.y + y + 1, LINE_SHADOW);
  }
}

function paragraph(pen: InsurancePen, y: number, n: number): number {
  const x = pen.c('INS_INFO_FIRST_PARAGRAPH_X');
  return (
    y +
    pen.wrapped(x, y, pen.c('INS_INFO_FIRST_PARAGRAPH_WIDTH'), 'INS_FONT_MED', 'INS_FONT_COLOR', n) +
    pen.c('INS_INFO_SPACE_BN_PARAGRAPHS')
  );
}

function bulleted(pen: InsurancePen, y: number, n: number): number {
  const x = pen.c('INS_INFO_FIRST_PARAGRAPH_X');
  pen.bullet(x, y);
  const width = pen.c('INS_INFO_FIRST_PARAGRAPH_WIDTH');
  return (
    y +
    pen.wrapped(x + pen.c('INSURANCE_BULLET_TEXT_OFFSET_X'), y, width, 'INS_FONT_MED', 'INS_FONT_COLOR', n) +
    pen.c('INS_INFO_SPACE_BN_PARAGRAPHS')
  );
}

function bigRed(pen: InsurancePen, y: number, n: number): void {
  pen.wrapped(
    pen.c('INS_INFO_FIRST_PARAGRAPH_X'),
    y - 1,
    pen.c('INS_INFO_FIRST_PARAGRAPH_WIDTH'),
    'INS_FONT_BIG',
    'INS_INFO_FRAUD_TEXT_COLOR',
    n,
  );
}

function tocPage(pen: InsurancePen): void {
  let y = pen.c('INS_INFO_FIRST_PARAGRAPH_Y');
  y = paragraph(pen, y, InsuranceText.HIRING_4_SHORT_TERM_HIGH_RISK_1);
  y = paragraph(pen, y, InsuranceText.HIRING_4_SHORT_TERM_HIGH_RISK_2);
  const subtitleX = pen.c('INS_INFO_TOC_SUBTITLE_X');
  pen.draw(subtitleX, y, 0, 'INS_FONT_BIG', 'INS_FONT_COLOR', InsuranceText.WE_CAN_OFFER_U, TextFlag.LEFT_JUSTIFIED);
  const lineX = pen.c('INS_INFO_SUBTITLE_X');
  pen.redLine(lineX, y + SUBTITLE_LINE_DY, lineX + pen.c('INS_INFO_SUBTITLE_LINE_WIDTH'));
  y += 2 * pen.c('INS_INFO_SPACE_BN_PARAGRAPHS');
  y = bulleted(pen, y, InsuranceText.REASONABLE_AND_FLEXIBLE);
  bulleted(pen, y, InsuranceText.QUICKLY_AND_EFFICIENT);
}

function submitClaimPage(pen: InsurancePen): void {
  let y = pen.c('INS_INFO_FIRST_PARAGRAPH_Y');
  y = paragraph(pen, y, InsuranceText.U_CAN_REST_ASSURED);
  y = paragraph(pen, y, InsuranceText.HAD_U_HIRED_AN_INDIVIDUAL);
  bigRed(pen, y, InsuranceText.FRAUD);
  const firstX = pen.c('INS_INFO_FIRST_PARAGRAPH_X');
  const width = pen.c('INS_INFO_FIRST_PARAGRAPH_WIDTH');
  const afterFraud = firstX + pen.width(InsuranceText.FRAUD, 'INS_FONT_BIG') + FRAUD_TEXT_GAP;
  y += pen.wrapped(afterFraud, y, width, 'INS_FONT_MED', 'INS_FONT_COLOR', InsuranceText.WE_RESERVE_THE_RIGHT);
  y += pen.wrapped(firstX, y, width, 'INS_FONT_MED', 'INS_FONT_COLOR', InsuranceText.SHOULD_THERE_BE_GROUNDS);
  y += pen.c('INS_INFO_SPACE_BN_PARAGRAPHS');
  paragraph(pen, y, InsuranceText.SHOULD_SUCH_A_SITUATION);
}

function premiumPage(pen: InsurancePen): void {
  let y = pen.c('INS_INFO_FIRST_PARAGRAPH_Y');
  y = paragraph(pen, y, InsuranceText.EACH_TIME_U_COME_TO_US);
  y = bulleted(pen, y, InsuranceText.LENGTH_OF_EMPLOYMENT_CONTRACT);
  y = bulleted(pen, y, InsuranceText.EMPLOYEES_AGE_AND_HEALTH);
  bulleted(pen, y, InsuranceText.EMPLOOYEES_TRAINING_AND_EXP);
}

function renewalPage(pen: InsurancePen): void {
  let y = pen.c('INS_INFO_FIRST_PARAGRAPH_Y');
  y = paragraph(pen, y, InsuranceText.WHEN_IT_COMES_TIME_TO_RENEW);
  y = paragraph(pen, y, InsuranceText.SHOULD_THE_PROJECT_BE_GOING_WELL);
  bigRed(pen, y, InsuranceText.LOWER_PREMIUMS_4_RENEWING);
}

function cancellationPage(pen: InsurancePen): void {
  let y = pen.c('INS_INFO_FIRST_PARAGRAPH_Y');
  y = paragraph(pen, y, InsuranceText.WE_WILL_ACCEPT_INS_CANCELATION);
  y = paragraph(pen, y, InsuranceText.ONE_HOUR_EXCLUSION_A);
  paragraph(pen, y, InsuranceText.ONE_HOUR_EXCLUSION_B);
}

const INFO_PAGES: readonly ((pen: InsurancePen) => void)[] = [tocPage, submitClaimPage, premiumPage, renewalPage, cancellationPage];

export function drawInsuranceInfoPage(pen: InsurancePen, page: number): void {
  INFO_PAGES[page]?.(pen);
}

export function drawInsuranceComments(pen: InsurancePen): void {
  const bulletX = pen.c('INS_CMNT_FIRST_BULLET_X');
  const textX = bulletX + pen.c('INSURANCE_BULLET_TEXT_OFFSET_X');
  const lineEnd = bulletX + pen.c('INS_CMNT_REDLINE_WIDTH');
  let y = pen.c('INS_CMNT_FIRST_BULLET_Y');
  for (const [name, comment] of INSURANCE_COMMENTS) {
    pen.bullet(bulletX, y);
    const height = pen.wrapped(textX, y, pen.c('INS_CMNT_COMMENT_TEXT_WIDTH'), 'INS_FONT_MED', 'INS_FONT_COLOR', comment);
    pen.redLine(textX, y + height, lineEnd);
    const nameY = y + height + COMMENT_NAME_DY;
    pen.draw(textX, nameY, pen.c('INS_CMNT_REDLINE_WIDTH'), 'INS_FONT_MED', 'INS_FONT_COLOR', name, TextFlag.RIGHT_JUSTIFIED);
    y += pen.c('INS_CMNT_NEXT_COMMENT_OFFSET_Y');
  }
}
