// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Credits.cc gCreditFaces (the blink frequencies), InitCreditEyeBlinking, HandleCreditEyeBlinking (eyes
// @src closed CRDT_EYES_CLOSED_TIME + Random(CRDT_EYES_CLOSED_TIME) ms; the unsigned clock difference blinks every face at
// @src once on entry), SelectCreditFaceMovementRegionCallBack, HandleCreditScreen (gzCreditNames, gzCreditNameTitle,
// @src gzCreditNameFunny of the hovered face; the screen ends when the rows run out), GetCreditScreenUserInput, AddCreditNode
// @src (the node height is the wrapped height + 1), DisplayCreditNode.

import type { CreditNode } from '../../../content/formats/credits.ts';
import type { Area, DrawList, FontColors } from '../../draw-list.ts';
import { type ControllerContract, ViewModelController } from '../../layout/controller.ts';
import type { LayoutModel } from '../../layout/model.ts';
import type { ColorJson } from '../../layout/types.ts';
import type { LayoutView } from '../../layout/view.ts';
import { type BitmapFont, fontHeight } from '../../text/bitmap-font.ts';
import type { FontSet } from '../../text/fonts.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { displayWrappedString, lineWrap, TextFlag } from '../../text/wrap.ts';
import { UiScreenKind } from '../../widgets/button-sounds.ts';
import { CreditRoll, type RowFeed } from '../credit-roll.ts';
import { type FrontEndEnvironment, FrontEndLayout, FrontEndScreen } from './environment.ts';

export const CREDITS_SCREEN = 'credits';

export const CREDITS_CONTRACT: ControllerContract = {
  id: CREDITS_SCREEN,
  actions: { hoverFace: { args: 2 }, end: {} },
  bindings: { faceSelected: 'boolean', name: 'string', title: 'string', funny: 'string' },
};

export const CREDIT_BLINK_FREQUENCIES: readonly number[] = [
  2500, 3700, 3000, 4000, 3500, 4000, 3500, 3700, 4000, 3600, 4600, 2800, 4500, 4000, 3500,
];
const EYES_CLOSED_TIME = 150;
const NO_FACE = -1;
const HOVER_ON = 1;
const U32 = 0x1_0000_0000;
const NAMES = 'gzCreditNames';
const TITLES = 'gzCreditNameTitle';
const JOKES = 'gzCreditNameFunny';

export type CreditsOutcome = 'finished' | 'escaped';

export interface CreditsDeps {
  readonly text: UiTextService;
  readonly random: (range: number) => number;
  readonly finished: (outcome: CreditsOutcome) => void;
}

export interface CreditsModel {
  faceSelected: boolean;
  name: string;
  title: string;
  funny: string;
}

interface Blink {
  last: number;
  closedUntil: number;
}

function u32(value: number): number {
  return ((value % U32) + U32) % U32;
}

export class CreditsController extends ViewModelController {
  readonly view: CreditsModel;
  readonly #deps: CreditsDeps;
  readonly #blinks: Blink[];
  #roll: CreditRoll | null = null;
  #face = NO_FACE;
  #done = false;
  #now = 0;

  constructor(deps: CreditsDeps) {
    const view: CreditsModel = { faceSelected: false, name: '', title: '', funny: '' };
    super(CREDITS_CONTRACT, view as unknown as Record<string, unknown>, {
      hoverFace: ([face, on]) => this.#hover(face ?? NO_FACE, on === HOVER_ON),
      end: () => this.#finish('escaped'),
    });
    this.view = view;
    this.#deps = deps;
    this.#blinks = CREDIT_BLINK_FREQUENCIES.map(() => ({ last: 0, closedUntil: 0 }));
  }

  get roll(): CreditRoll | null {
    return this.#roll;
  }

  start(now: number, feed: RowFeed, measure: (node: CreditNode) => number): void {
    this.#now = now;
    this.#roll = new CreditRoll(now, feed, measure);
    CREDIT_BLINK_FREQUENCIES.forEach((frequency, i) => {
      const blink = this.#blinks[i];
      if (blink) blink.last = now + this.#deps.random(frequency * 2);
    });
  }

  #hover(face: number, on: boolean): void {
    if (on) this.#face = face;
    else if (this.#face === face) this.#face = NO_FACE;
    const selected = this.#face !== NO_FACE;
    this.view.faceSelected = selected;
    this.view.name = selected ? (this.#deps.text.string(NAMES, this.#face) ?? '') : '';
    this.view.title = selected ? (this.#deps.text.string(TITLES, this.#face) ?? '') : '';
    this.view.funny = selected ? (this.#deps.text.string(JOKES, this.#face) ?? '') : '';
  }

  eyesClosed(face: number): boolean {
    const blink = this.#blinks[face];
    return blink !== undefined && blink.closedUntil !== 0 && this.#now <= blink.closedUntil;
  }

  update(now: number): void {
    this.#now = now;
    if (this.#done) return;
    this.#roll?.update(now);
    CREDIT_BLINK_FREQUENCIES.forEach((frequency, i) => {
      const blink = this.#blinks[i];
      if (!blink) return;
      if (u32(now - blink.last) > frequency) {
        blink.last = now;
        blink.closedUntil = now + EYES_CLOSED_TIME + this.#deps.random(EYES_CLOSED_TIME);
      } else if (now > blink.closedUntil) blink.closedUntil = 0;
    });
    if (this.#roll?.finished) this.#finish('finished');
  }

  #finish(outcome: CreditsOutcome): void {
    if (this.#done) return;
    this.#done = true;
    this.#deps.finished(outcome);
  }
}

type JsonObject = Readonly<Record<string, unknown>>;

interface RollStyle {
  readonly titleFont: BitmapFont;
  readonly bodyFont: BitmapFont;
  readonly gap: number;
  readonly shadow: number;
}

function rollStyle(model: LayoutModel, fonts: FontSet): RollStyle {
  const style = model.style('roll') as JsonObject;
  return {
    titleFont: fonts.get(model.font(String(style.titleFont))),
    bodyFont: fonts.get(model.font(String(style.bodyFont))),
    gap: model.number(style.gap as number),
    shadow: model.color(style.shadow as ColorJson, 0),
  };
}

function nodeFont(style: RollStyle, node: CreditNode): BitmapFont {
  return node.title ? style.titleFont : style.bodyFont;
}

export function creditNodeHeight(style: RollStyle, width: number, node: CreditNode): number {
  const font = nodeFont(style, node);
  return lineWrap(font, width, node.text).length * (fontHeight(font) + style.gap) + 1;
}

const JUSTIFICATION_FLAGS: Readonly<Record<CreditNode['justification'], number>> = {
  left: TextFlag.LEFT_JUSTIFIED,
  center: TextFlag.CENTER_JUSTIFIED,
  right: TextFlag.RIGHT_JUSTIFIED,
};

function drawRoll(controller: CreditsController, style: RollStyle) {
  return (list: DrawList, rect: Area, _params: JsonObject, view: LayoutView): void => {
    const roll = controller.roll;
    if (!roll) return;
    const frame = view.frame;
    for (const rolled of roll.nodes) {
      const top = frame.y + rolled.y;
      const font = nodeFont(style, rolled.node);
      const colors: FontColors = { foreground: rolled.node.colour, shadow: style.shadow, background: 0 };
      list.pushClip(rect.x, Math.max(top, frame.y), rect.x + rect.width, Math.min(top + rolled.height, frame.y + frame.height));
      displayWrappedString(
        list,
        rect.x,
        top + 1,
        rect.width,
        style.gap,
        font,
        colors,
        rolled.node.text,
        JUSTIFICATION_FLAGS[rolled.node.justification],
      );
      list.popClip();
    }
  };
}

function drawEyes(controller: CreditsController, model: LayoutModel) {
  const eyes = model.style('eyes') as JsonObject;
  const asset = model.asset(String(eyes.asset)).path;
  const perFace = model.number(eyes.framesPerFace as number);
  const positions = (eyes.positions as readonly (readonly [number, number])[]) ?? [];
  return (list: DrawList, rect: Area): void => {
    positions.forEach(([x, y], face) => {
      if (controller.eyesClosed(face)) list.image(asset, face * perFace, rect.x + x, rect.y + y);
    });
  };
}

export interface CreditsScreenDeps {
  readonly feed: () => RowFeed;
}

export function creditsScreen(env: FrontEndEnvironment, controller: CreditsController, deps: CreditsScreenDeps): FrontEndScreen {
  const model = env.layout(FrontEndLayout.CREDITS);
  const style = rollStyle(model, env.runtime.fonts);
  const width = model.number('CRDT_WIDTH_OF_TEXT_AREA');
  return new FrontEndScreen(env, {
    id: CREDITS_SCREEN,
    layout: FrontEndLayout.CREDITS,
    controller,
    soundScreen: UiScreenKind.OTHER,
    custom: { creditRoll: drawRoll(controller, style), creditEyes: drawEyes(controller, model) },
    onEnter: () => controller.start(env.runtime.clock.ja2Now, deps.feed(), (node) => creditNodeHeight(style, width, node)),
    onUpdate: () => controller.update(env.runtime.clock.ja2Now),
  });
}
