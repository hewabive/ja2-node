import type { FontSet } from '../text/fonts.ts';
import type { MercTextBoxArt } from '../widgets/merc-text-box.ts';
import type { MessageBoxStyle } from '../widgets/message-box.ts';
import { DEFAULT_POPUP_COLORS, type PopupBoxStyle, type PopupColors } from '../widgets/popup-box.ts';
import type { LayoutModel } from './model.ts';
import type { ColorJson, NumberExpr } from './types.ts';

export const MESSAGE_BOX_STYLES = 'messageBoxes';

type JsonObject = Readonly<Record<string, unknown>>;

function object(value: unknown, what: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${what} is not an object`);
  return value as JsonObject;
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(`${what} is not a string`);
  return value;
}

export function textBoxArt(model: LayoutModel, value: unknown): MercTextBoxArt {
  const style = object(value, 'a text box style');
  const icon = (key: string) => (typeof style[key] === 'string' ? model.asset(style[key] as string).path : undefined);
  const stopIcon = icon('stopIcon');
  const skullIcon = icon('skullIcon');
  return {
    background: model.asset(text(style.background, 'a text box background')).path,
    border: model.asset(text(style.border, 'a text box border')).path,
    backgroundIndex: model.number(style.backgroundIndex as NumberExpr),
    ...(stopIcon ? { stopIcon } : {}),
    ...(skullIcon ? { skullIcon } : {}),
  };
}

export function messageBoxStyles(model: LayoutModel): MessageBoxStyle[] {
  const styles = model.style(MESSAGE_BOX_STYLES);
  if (!Array.isArray(styles)) throw new Error(`${MESSAGE_BOX_STYLES} is not a list`);
  return styles.map((value, i) => {
    const style = object(value, `message box style ${i}`);
    return {
      textBox: textBoxArt(model, style.textBox),
      buttons: model.asset(text(style.buttons, `message box style ${i} buttons`)).path,
      buttonOff: model.number(style.off as NumberExpr),
      buttonOn: model.number(style.on as NumberExpr),
      fontColor: model.color(style.color as ColorJson, 0),
      shadowColor: model.color(style.shadow as ColorJson, 0),
      cursor: model.cursor(text(style.cursor, `message box style ${i} cursor`)),
    };
  });
}

function popupColors(model: LayoutModel, value: unknown, fallback: PopupColors): PopupColors {
  if (value === undefined) return fallback;
  const colors = object(value, 'popup colours');
  return {
    foreground: model.color(colors.foreground as ColorJson, fallback.foreground),
    background: model.color(colors.background as ColorJson, fallback.background),
    highlight: model.color(colors.highlight as ColorJson, fallback.highlight),
    shade: model.color(colors.shade as ColorJson, fallback.shade),
    secondaryShade: model.color(colors.secondaryShade as ColorJson, fallback.secondaryShade),
  };
}

export function popupBoxStyle(
  model: LayoutModel,
  json: JsonObject,
  fonts: FontSet,
  variables: Readonly<Record<string, number>> = {},
): PopupBoxStyle {
  const margins = Array.isArray(json.margins) ? json.margins : [0, 0, 0, 0];
  const margin = (i: number) => model.number((margins[i] ?? 0) as NumberExpr, variables);
  const colors = popupColors(model, json.colors, DEFAULT_POPUP_COLORS);
  return {
    border: model.asset(text(json.border, 'a popup border')).path,
    background: model.asset(text(json.background, 'a popup background')).path,
    font: fonts.get(model.font(text(json.font, 'a popup font'))),
    marginLeft: margin(0),
    marginTop: margin(1),
    marginBottom: margin(2),
    marginRight: margin(3),
    lineSpace: model.number((json.lineSpace ?? 0) as NumberExpr, variables),
    colors,
    secondColors: popupColors(model, json.secondColors, colors),
    shadow: model.color(json.shadow as ColorJson, 2),
    centerText: json.center === true,
    resize: json.resize !== false,
    minWidth: model.number((json.minWidth ?? 0) as NumberExpr, variables),
    secondColumnMinOffset: model.number((json.secondColumnOffset ?? 0) as NumberExpr, variables),
  };
}
