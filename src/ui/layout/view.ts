import { DEFAULT_SHADOW, FontColor } from '../../content/text/font-colors.ts';
import { idiv } from '../../core/int.ts';
import { type Area, type DrawList, type ImageEffect, type PaletteShade, rgb, SHADOW_FACTOR } from '../draw-list.ts';
import { isPointerEvent, type UiInputEvent } from '../input/events.ts';
import { findHotkey, type Hotkey } from '../input/hotkeys.ts';
import { MouseButtonMask, MouseReason, NO_CURSOR, Priority } from '../input/mouse.ts';
import type { MouseRegion } from '../input/regions.ts';
import type { UiServices } from '../services.ts';
import { type BitmapFont, fontHeight } from '../text/bitmap-font.ts';
import { centerAlign, rightAlign } from '../text/measure.ts';
import { sprintMoney } from '../text/money.ts';
import { mprint } from '../text/print.ts';
import { printf } from '../text/printf.ts';
import type { UiTextService } from '../text/text-service.ts';
import { displayWrappedString, drawTextToScreen, ianDisplayWrappedString, reduceStringLength, TextFlag } from '../text/wrap.ts';
import { type Button, type ButtonImage, type ButtonKind, type DisabledStyle, NO_IMAGE, type TextJustification } from '../widgets/button.ts';
import { type MercIcon, MercTextBox } from '../widgets/merc-text-box.ts';
import { MessageBox, type MessageBoxFlag, type MessageBoxLabels, type MessageBoxStyle } from '../widgets/message-box.ts';
import { type LineShade, PopupBox, type PopupLine, PopupMenu } from '../widgets/popup-box.ts';
import { ProgressBar, type ProgressBarStyle } from '../widgets/progress-bar.ts';
import type { Slider, SliderSystem } from '../widgets/slider.ts';
import { defaultTextFieldScheme, type TextField, type TextFieldGroup, TextFieldGroup as TextFields } from '../widgets/text-field.ts';
import { type WidgetInfo, widgetRect } from '../widgets/widget-info.ts';
import type { Variables } from './constants.ts';
import { type LayoutController, parseAction, substituteIndex } from './controller.ts';
import { anchorPoint, type FrameRect, frameRect } from './frames.ts';
import type { LayoutModel } from './model.ts';
import { popupBoxStyle, textBoxArt } from './styles.ts';
import type { AnchorName, ColorJson, Condition, NumberExpr, TextSourceJson, WidgetJson } from './types.ts';

export type CustomRenderer = (list: DrawList, rect: Area, params: Readonly<Record<string, unknown>>, view: LayoutView) => void;

export interface LayoutViewOptions {
  readonly model: LayoutModel;
  readonly controller: LayoutController;
  readonly services: UiServices;
  readonly sliders: SliderSystem;
  readonly text: UiTextService;
  readonly messageBoxStyle?: (style: number) => MessageBoxStyle;
  readonly messageBoxLabels?: MessageBoxLabels;
  readonly custom?: Readonly<Record<string, CustomRenderer>>;
  readonly owner?: unknown;
}

interface Live {
  readonly id: string;
  readonly kind: string;
  sync(): void;
  render(list: DrawList): void;
  dispose(): void;
  describe(): WidgetInfo[];
}

type JsonObject = Readonly<Record<string, unknown>>;

const NOOP_DISPOSE = () => undefined;
const DEFAULT_TEXT_FOREGROUND = FontColor.MCOLOR_WHITE;
const PRIMARY_UP = MouseReason.LBUTTON_UP;
const SECONDARY_UP = MouseReason.RBUTTON_UP;
const BUTTON_FRAME_KEYS = ['grayed', 'offNormal', 'offHilite', 'onNormal', 'onHilite'] as const;
const HOVER_ON = 1;
const HOVER_OFF = 0;

function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

function asObject(value: unknown): JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonObject) : {};
}

export class LayoutView {
  readonly model: LayoutModel;
  readonly controller: LayoutController;
  readonly services: UiServices;
  readonly owner: unknown;
  readonly #options: LayoutViewOptions;
  #widgets: Live[] = [];
  #frame: FrameRect = { x: 0, y: 0, width: 0, height: 0 };
  #geometryKey = '';
  #fields: TextFieldGroup | null = null;
  #counter = 0;
  readonly #groups = new Map<string, { readonly group: JsonObject; readonly index: number }>();

  constructor(options: LayoutViewOptions) {
    this.#options = options;
    this.model = options.model;
    this.controller = options.controller;
    this.services = options.services;
    this.owner = options.owner ?? this;
    this.#collectGroups(this.model.json.widgets ?? []);
  }

  get frame(): FrameRect {
    return this.#frame;
  }

  get textFields(): TextFieldGroup | null {
    return this.#fields;
  }

  build(): void {
    this.dispose();
    const geometry = this.services.geometry();
    this.#geometryKey = `${geometry.width}x${geometry.height}`;
    this.#frame = frameRect(this.model.json.frame, geometry);
    this.#counter = 0;
    this.#widgets = (this.model.json.widgets ?? []).map((json) => this.#build(json, {}, 0, 0));
  }

  dispose(): void {
    for (const widget of this.#widgets) widget.dispose();
    this.#widgets = [];
    this.#fields?.dispose();
    this.#fields = null;
    this.services.buttons.removeOwner(this.owner);
    this.services.regions.removeOwner(this.owner);
    this.#options.sliders.removeOwner(this.owner);
  }

  update(): void {
    const geometry = this.services.geometry();
    if (`${geometry.width}x${geometry.height}` !== this.#geometryKey) this.build();
    for (const widget of this.#widgets) widget.sync();
  }

  render(list: DrawList): void {
    for (const widget of this.#widgets) widget.render(list);
  }

  input(event: UiInputEvent): boolean {
    if (isPointerEvent(event)) return false;
    if (this.#fields?.input(event)) return true;
    if (event.kind === 'text') return false;
    const hotkey = findHotkey((this.model.json.hotkeys ?? []) as readonly Hotkey[], event, (when) => this.condition(when, {}));
    if (!hotkey) return false;
    const action = parseAction(hotkey.action);
    this.controller.invoke(action.name, hotkey.args ?? action.args);
    return true;
  }

  describe(): WidgetInfo[] {
    return [...this.#widgets.flatMap((w) => w.describe()), ...(this.#fields?.describe() ?? [])];
  }

  get(path: string, vars: Variables): unknown {
    return this.controller.get(substituteIndex(path, vars.i ?? 0));
  }

  condition(condition: Condition | undefined, vars: Variables, fallback = true): boolean {
    if (condition === undefined) return fallback;
    if (typeof condition === 'boolean') return condition;
    if (typeof condition === 'string')
      return condition.startsWith('!') ? !truthy(this.get(condition.slice(1), vars)) : truthy(this.get(condition, vars));
    if ('not' in condition) return !this.condition(condition.not, vars);
    const [path, literal] = condition.eq;
    return this.get(path, vars) === literal;
  }

  number(expression: NumberExpr | undefined, vars: Variables, fallback = 0): number {
    if (expression === undefined) return fallback;
    if (typeof expression === 'object') return Number(this.get(expression.bind, vars) ?? fallback);
    return this.model.number(expression, vars);
  }

  text(source: TextSourceJson | undefined, vars: Variables): string {
    if (source === undefined) return '';
    if (typeof source === 'string') return source;
    if ('literal' in source) return source.literal;
    if ('bind' in source) return String(this.get(source.bind, vars) ?? '');
    if ('key' in source) return this.#options.text.string(source.key[0], this.number(source.key[1], vars)) ?? '';
    if ('edt' in source) return this.#options.text.edt(source.edt[0], this.number(source.edt[1], vars)) ?? '';
    if ('money' in source) return sprintMoney(this.number(source.money, vars));
    const args = source.args.map((a) => (typeof a === 'number' ? a : this.text(a, vars)));
    return printf(this.text(source.format, vars), args);
  }

  invoke(action: unknown, vars: Variables, extra: readonly number[] = [], payload?: string): void {
    if (typeof action !== 'string') return;
    const parsed = parseAction(substituteIndex(action, vars.i ?? 0));
    this.controller.invoke(parsed.name, [...parsed.args, ...extra], payload);
  }

  #font(name: unknown): BitmapFont {
    return this.services.fonts.get(this.model.font(String(name)));
  }

  #collectGroups(widgets: readonly WidgetJson[]): void {
    for (const json of widgets) {
      if (json.type !== 'group' || !Array.isArray(json.members)) continue;
      json.members.forEach((member, index) => {
        if (typeof member === 'string') this.#groups.set(member, { group: json, index });
      });
    }
  }

  #id(json: WidgetJson, vars: Variables): string {
    this.#counter++;
    const base = json.id ?? `${json.type}${this.#counter}`;
    return vars.i === undefined || json.id?.includes('$i') ? substituteIndex(base, vars.i ?? 0) : `${base}.${vars.i}`;
  }

  #position(json: WidgetJson, vars: Variables, dx: number, dy: number, width = 0): { x: number; y: number } {
    const anchor = anchorPoint(this.#frame, (json.anchor as AnchorName | undefined) ?? 'topLeft');
    let x = anchor.x + this.number(json.x as NumberExpr | undefined, vars) + dx;
    if (json.centerX === true)
      x = this.#frame.x + idiv(this.#frame.width - width, 2) + this.number(json.x as NumberExpr | undefined, vars) + dx;
    return { x, y: anchor.y + this.number(json.y as NumberExpr | undefined, vars) + dy };
  }

  #visible(json: WidgetJson, vars: Variables): boolean {
    return this.condition(json.visible as Condition | undefined, vars);
  }

  #build(json: WidgetJson, vars: Variables, dx: number, dy: number): Live {
    switch (json.type) {
      case 'image':
        return this.#image(json, vars, dx, dy);
      case 'fill':
      case 'shade':
      case 'hatch':
      case 'line':
      case 'rect':
        return this.#primitive(json, vars, dx, dy);
      case 'text':
        return this.#textWidget(json, vars, dx, dy);
      case 'frame':
        return this.#frameWidget(json, vars, dx, dy);
      case 'textBox':
        return this.#textBox(json, vars, dx, dy);
      case 'region':
        return this.#region(json, vars, dx, dy);
      case 'button':
        return this.#button(json, vars, dx, dy);
      case 'group':
        return this.#static(json, vars, () => undefined);
      case 'slider':
        return this.#slider(json, vars, dx, dy);
      case 'textField':
        return this.#textField(json, vars, dx, dy);
      case 'popupMenu':
        return this.#popupMenu(json, vars, dx, dy);
      case 'list':
      case 'repeat':
        return this.#repeat(json, vars, dx, dy);
      case 'progressBar':
        return this.#progressBar(json, vars, dx, dy);
      case 'modal':
        return this.#modal(json, vars);
      case 'custom':
        return this.#custom(json, vars, dx, dy);
      default:
        throw new Error(`${this.model.json.screen}: unknown widget type ${json.type}`);
    }
  }

  #static(json: WidgetJson, vars: Variables, draw: (list: DrawList) => void, describe?: () => WidgetInfo[]): Live {
    const id = this.#id(json, vars);
    return {
      id,
      kind: json.type,
      sync: () => undefined,
      render: (list) => {
        if (this.#visible(json, vars)) draw(list);
      },
      dispose: NOOP_DISPOSE,
      describe: describe ?? (() => []),
    };
  }

  #image(json: WidgetJson, vars: Variables, dx: number, dy: number): Live {
    const asset = this.model.asset(String(json.asset));
    const effectName = json.effect as string | undefined;
    const effect: ImageEffect =
      effectName === 'outline'
        ? {
            kind: 'outline',
            color: json.outline === null ? null : this.model.rgbColor(json.outline as ColorJson | undefined, rgb(255, 255, 255)),
          }
        : effectName === 'outlineShadow'
          ? { kind: 'outlineShadow' }
          : { kind: 'normal' };
    const shadeJson = json.shade as PaletteShade | undefined;
    return this.#static(json, vars, (list) => {
      const { x, y } = this.#position(json, vars, dx, dy);
      list.image(asset.path, this.number(json.frame as NumberExpr | undefined, vars), x, y, { shade: shadeJson ?? null, effect });
    });
  }

  #primitive(json: WidgetJson, vars: Variables, dx: number, dy: number): Live {
    return this.#static(json, vars, (list) => {
      const { x, y } = this.#position(json, vars, dx, dy);
      const w = this.number(json.width as NumberExpr | undefined, vars);
      const h = this.number(json.height as NumberExpr | undefined, vars);
      const color = this.model.rgbColor(json.color as ColorJson | undefined, rgb(0, 0, 0));
      switch (json.type) {
        case 'fill':
          list.fill(x, y, x + w, y + h, color);
          return;
        case 'shade':
          list.shadow(x, y, x + w - 1, y + h - 1, typeof json.factor === 'number' ? json.factor : SHADOW_FACTOR);
          return;
        case 'hatch':
          if (json.pattern === 'loose') list.looseHatch(x, y, x + w - 1, y + h - 1, color);
          else list.hatch(x, y, x + w - 1, y + h - 1);
          return;
        default: {
          const x2 = this.#frame.x + this.number(json.x2 as NumberExpr | undefined, vars) + dx;
          const y2 = this.#frame.y + this.number(json.y2 as NumberExpr | undefined, vars) + dy;
          if (json.type === 'line') list.line(x, y, x2, y2, color);
          else list.rectangle(x, y, x2, y2, color);
        }
      }
    });
  }

  #textWidget(json: WidgetJson, vars: Variables, dx: number, dy: number): Live {
    const id = this.#id(json, vars);
    let last = '';
    const draw = (list: DrawList) => {
      const font = this.#font(json.font);
      const { x, y } = this.#position(json, vars, dx, dy);
      const width = this.number(json.width as NumberExpr | undefined, vars);
      const height = this.number(json.height as NumberExpr | undefined, vars);
      const colors = {
        foreground: this.model.color(json.color as ColorJson | undefined, DEFAULT_TEXT_FOREGROUND),
        shadow: this.model.color(json.shadow as ColorJson | undefined, DEFAULT_SHADOW),
        background: this.model.color(json.background as ColorJson | undefined, FontColor.MCOLOR_BLACK),
      };
      let text = this.text(json.text as TextSourceJson | undefined, vars);
      if (json.ellipsis === true && width > 0) text = reduceStringLength(text, width, font);
      last = text;
      const align = (json.align as TextJustification | undefined) ?? 'left';
      const flags =
        (align === 'center' ? TextFlag.CENTER_JUSTIFIED : align === 'right' ? TextFlag.RIGHT_JUSTIFIED : TextFlag.LEFT_JUSTIFIED) |
        (json.shadowed === true ? TextFlag.TEXT_SHADOWED : 0);
      const wrap = asObject(json.wrap);
      const gap = this.number(wrap.gap as NumberExpr | undefined, vars);
      const top = json.valign === 'center' && height > 0 ? y + idiv(height - fontHeight(font), 2) : y;
      if (json.ian === true) {
        ianDisplayWrappedString(list, x, top, width, gap, font, colors, text, { bold: this.services.fonts.get('FONT10ARIALBOLD') });
        return;
      }
      if (json.wrap !== undefined) {
        displayWrappedString(list, x, top, width, gap, font, colors, text, flags);
        return;
      }
      if (json.alignRule === 'font' && align !== 'left') {
        const at = align === 'center' ? centerAlign(x, top, width, text, font) : rightAlign(x, top, width, text, font);
        mprint(list, font, at.x, at.y, text, colors);
        return;
      }
      drawTextToScreen(list, text, x, top, width, font, colors, flags);
    };
    return {
      id,
      kind: 'text',
      sync: () => undefined,
      render: (list) => {
        if (this.#visible(json, vars)) draw(list);
      },
      dispose: NOOP_DISPOSE,
      describe: () => {
        const { x, y } = this.#position(json, vars, dx, dy);
        const width = this.number(json.width as NumberExpr | undefined, vars);
        const height = this.number(json.height as NumberExpr | undefined, vars);
        return json.id
          ? [
              {
                id,
                kind: 'text',
                rect: widgetRect(x, y, width, height),
                visible: this.#visible(json, vars),
                enabled: true,
                state: null,
                text: last,
                frame: null,
              },
            ]
          : [];
      },
    };
  }

  #frameWidget(json: WidgetJson, vars: Variables, dx: number, dy: number): Live {
    return this.#static(json, vars, (list) => {
      const { x, y } = this.#position(json, vars, dx, dy);
      const style = popupBoxStyle(this.model, { ...json, font: 'FONT10ARIAL' }, this.services.fonts, vars);
      new PopupBox(
        style,
        x,
        y,
        this.number(json.width as NumberExpr | undefined, vars),
        this.number(json.height as NumberExpr | undefined, vars),
      ).draw(list);
    });
  }

  #textBox(json: WidgetJson, vars: Variables, dx: number, dy: number): Live {
    const id = this.#id(json, vars);
    const art = textBoxArt(this.model, this.model.style(String(json.style)));
    let box: MercTextBox | null = null;
    let lastText: string | null = null;
    const current = () => {
      const text = this.text(json.text as TextSourceJson | undefined, vars);
      if (box && text === lastText) return box;
      lastText = text;
      box = new MercTextBox(
        art,
        {
          text,
          width: this.number(json.width as NumberExpr | undefined, vars, 300),
          marginX: this.number(json.marginX as NumberExpr | undefined, vars),
          marginTop: this.number(json.marginTop as NumberExpr | undefined, vars),
          marginBottom: this.number(json.marginBottom as NumberExpr | undefined, vars),
          icon: (json.icon as MercIcon | undefined) ?? 'none',
        },
        { text: this.services.fonts.get('FONT12ARIAL'), bold: this.services.fonts.get('FONT10ARIALBOLD') },
      );
      return box;
    };
    return {
      id,
      kind: 'textBox',
      sync: () => undefined,
      render: (list) => {
        if (!this.#visible(json, vars)) return;
        const { x, y } = this.#position(json, vars, dx, dy);
        current().render(list, x, y);
      },
      dispose: NOOP_DISPOSE,
      describe: () => {
        const b = current();
        const { x, y } = this.#position(json, vars, dx, dy);
        return [
          {
            id,
            kind: 'textBox',
            rect: widgetRect(x, y, b.width, b.height),
            visible: this.#visible(json, vars),
            enabled: true,
            state: null,
            text: lastText,
            frame: null,
          },
        ];
      },
    };
  }

  #regionCallbacks(json: WidgetJson, vars: Variables) {
    let pointerDown = false;
    let rightDown = false;
    return {
      onMove: (_r: MouseRegion, reason: number) => {
        if (reason & MouseReason.GAIN_MOUSE) this.invoke(json.hover, vars, [HOVER_ON]);
        else if (reason & MouseReason.LOST_MOUSE) this.invoke(json.hover, vars, [HOVER_OFF]);
      },
      onButton: (_r: MouseRegion, reason: number) => {
        if (reason & MouseReason.LBUTTON_DWN) {
          pointerDown = true;
          rightDown = false;
        }
        if (reason & MouseReason.RBUTTON_DWN) {
          pointerDown = false;
          rightDown = true;
        }
        if (reason & PRIMARY_UP && pointerDown) this.invoke(json.primary, vars);
        if (reason & SECONDARY_UP && rightDown) {
          rightDown = false;
          this.invoke(json.secondary, vars);
        }
        if (reason & MouseReason.WHEEL_UP) this.invoke(json.wheelUp, vars);
        if (reason & MouseReason.WHEEL_DOWN) this.invoke(json.wheelDown, vars);
      },
    };
  }

  #region(json: WidgetJson, vars: Variables, dx: number, dy: number): Live {
    const id = this.#id(json, vars);
    const { x, y } = this.#position(json, vars, dx, dy);
    const width = this.number(json.width as NumberExpr | undefined, vars);
    const height = this.number(json.height as NumberExpr | undefined, vars);
    const region = this.services.regions.define({
      x1: x,
      y1: y,
      x2: x + width,
      y2: y + height,
      priority: json.priority === undefined ? Priority.NORMAL : this.model.priority(json.priority as NumberExpr, vars),
      cursor: json.cursor === undefined ? NO_CURSOR : this.model.cursor(String(json.cursor)),
      owner: this.owner,
      id,
      ...this.#regionCallbacks(json, vars),
    });
    region.allowDisabledTooltip = json.allowDisabledTooltip === true;
    region.animatesCursor = json.animatesCursor === true;
    region.flashesCursor = json.flashesCursor === true;
    region.showsMouseText = json.mouseText === true;
    const sync = () => {
      const visible = this.#visible(json, vars);
      region.setEnabled(visible && this.condition(json.enabled as Condition | undefined, vars));
      const tooltip = this.text(json.tooltip as TextSourceJson | undefined, vars);
      if (tooltip !== region.tooltip) region.setTooltip(tooltip);
    };
    sync();
    return {
      id,
      kind: 'region',
      sync,
      render: () => undefined,
      dispose: () => region.remove(),
      describe: () => [
        {
          id,
          kind: 'region',
          rect: widgetRect(region.x1, region.y1, region.width, region.height),
          visible: this.#visible(json, vars),
          enabled: region.enabled,
          state: region.inArea ? 'hover' : 'normal',
          text: region.tooltip || null,
          frame: null,
        },
      ],
    };
  }

  #buttonImage(json: WidgetJson, vars: Variables): ButtonImage | undefined {
    if (json.asset === undefined) return undefined;
    const frames = asObject(json.frames);
    const frame = (key: (typeof BUTTON_FRAME_KEYS)[number]) =>
      frames[key] === undefined ? NO_IMAGE : this.number(frames[key] as NumberExpr, vars);
    return {
      asset: this.model.asset(String(json.asset)).path,
      grayed: frame('grayed'),
      offNormal: frame('offNormal'),
      offHilite: frame('offHilite'),
      onNormal: frame('onNormal'),
      onHilite: frame('onHilite'),
    };
  }

  #button(json: WidgetJson, vars: Variables, dx: number, dy: number): Live {
    const id = this.#id(json, vars);
    const image = this.#buttonImage(json, vars);
    const width =
      json.width === undefined ? (image ? this.services.buttons.imageSize(image).width : 0) : this.number(json.width as NumberExpr, vars);
    const height = json.height === undefined ? undefined : this.number(json.height as NumberExpr, vars);
    const { x, y } = this.#position(json, vars, dx, dy, width);
    const membership = this.#groups.get(id);
    const textJson = json.text === undefined ? null : asObject(json.text);
    const iconJson = json.icon === undefined ? null : asObject(json.icon);
    const button: Button = this.services.buttons.create({
      x,
      y,
      kind: (json.kind as ButtonKind | undefined) ?? 'quick',
      ...(image ? { image } : {}),
      ...(json.width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
      priority: json.priority === undefined ? Priority.NORMAL : this.model.priority(json.priority as NumberExpr, vars),
      cursor: json.cursor === undefined ? 0 : this.model.cursor(String(json.cursor)),
      ...(json.disabledStyle ? { disabledStyle: json.disabledStyle as DisabledStyle } : {}),
      ...(json.sound ? { sound: this.model.sound(String(json.sound)) } : {}),
      owner: this.owner,
      id,
      onClick: (_b, reason) => {
        if (reason & PRIMARY_UP) {
          if (membership) this.invoke(membership.group.select, vars, [membership.index]);
          else this.invoke(json.primary, vars);
        }
        if (reason & SECONDARY_UP) this.invoke(json.secondary, vars);
      },
      ...(json.hover ? { onMove: (_b: Button, reason: number) => this.#regionCallbacks(json, vars).onMove(button.region, reason) } : {}),
    });
    if (json.allowDisabledTooltip === true) button.allowDisabledTooltip();
    const syncText = () => {
      if (!textJson) return;
      const font = this.#font(textJson.font ?? 'FONT12ARIAL');
      const color = (key: string) => (textJson[key] === undefined ? undefined : this.model.color(textJson[key] as ColorJson, 0));
      const optional = (key: string) => (textJson[key] === undefined ? {} : { [key]: this.number(textJson[key] as NumberExpr, vars) });
      const colorEntry = (key: string) => {
        const value = color(key);
        return value === undefined ? {} : { [key]: value };
      };
      button.text = {
        text: this.text(textJson.source as TextSourceJson | undefined, vars),
        font,
        color: color('color') ?? DEFAULT_TEXT_FOREGROUND,
        ...colorEntry('shadow'),
        ...colorEntry('downColor'),
        ...colorEntry('downShadow'),
        ...colorEntry('hiliteColor'),
        ...colorEntry('hiliteShadow'),
        justify: (textJson.align as TextJustification | undefined) ?? 'center',
        ...optional('offsetX'),
        ...optional('offsetY'),
        ...optional('subOffsetX'),
        ...optional('subOffsetY'),
        ...optional('wrapWidth'),
        ...(textJson.shift === false ? { shift: false } : {}),
      };
    };
    if (iconJson) {
      button.icon = {
        asset: this.model.asset(String(iconJson.asset)).path,
        frame: this.number(iconJson.frame as NumberExpr | undefined, vars),
        ...(iconJson.offsetX === undefined ? {} : { offsetX: this.number(iconJson.offsetX as NumberExpr, vars) }),
        ...(iconJson.offsetY === undefined ? {} : { offsetY: this.number(iconJson.offsetY as NumberExpr, vars) }),
        ...(iconJson.shift === false ? { shift: false } : {}),
      };
    }
    const checked = (): boolean | undefined => {
      if (membership) return this.get(String(membership.group.value), vars) === membership.index;
      if (json.checked === undefined) return undefined;
      return this.condition(json.checked as Condition, vars);
    };
    const sync = () => {
      button.setVisible(this.#visible(json, vars));
      button.setEnabled(this.condition(json.enabled as Condition | undefined, vars));
      const state = checked();
      if (state !== undefined && !this.services.regions.isButtonDown(MouseButtonMask.LEFT)) button.setClicked(state);
      const tooltip = this.text(json.tooltip as TextSourceJson | undefined, vars);
      if (tooltip !== button.region.tooltip) button.setTooltip(tooltip);
      syncText();
    };
    sync();
    return {
      id,
      kind: 'button',
      sync,
      render: (list) => {
        if (button.visible) this.services.buttons.draw(list, button);
      },
      dispose: () => button.remove(),
      describe: () => [button.describe()],
    };
  }

  #slider(json: WidgetJson, vars: Variables, dx: number, dy: number): Live {
    const id = this.#id(json, vars);
    const { x, y } = this.#position(json, vars, dx, dy);
    const slider: Slider = this.#options.sliders.add({
      style: json.style === 'default' ? 'default' : 'verticalSteel',
      x,
      y,
      length: this.number(json.length as NumberExpr | undefined, vars),
      steps: this.number(json.steps as NumberExpr | undefined, vars),
      thumb: this.model.asset(String(json.thumb)).path,
      priority: json.priority === undefined ? Priority.NORMAL : this.model.priority(json.priority as NumberExpr, vars),
      cursor: json.cursor === undefined ? NO_CURSOR : this.model.cursor(String(json.cursor)),
      onChange: (value) => this.invoke(json.change, vars, [value]),
      owner: this.owner,
      id,
    });
    const sync = () => {
      const value = Number(this.get(String(json.value), vars) ?? 0);
      if (value !== slider.value) slider.setValue(value);
    };
    sync();
    return { id, kind: 'slider', sync, render: (list) => slider.render(list), dispose: NOOP_DISPOSE, describe: () => [slider.describe()] };
  }

  #textField(json: WidgetJson, vars: Variables, dx: number, dy: number): Live {
    const id = this.#id(json, vars);
    const { x, y } = this.#position(json, vars, dx, dy);
    const font = this.#font(json.font ?? 'FONT12POINT1');
    this.#fields ??= new TextFields(this.services.regions, this.services.sounds, defaultTextFieldScheme(font), this.owner);
    const field: TextField = this.#fields.add({
      x,
      y,
      width: this.number(json.width as NumberExpr | undefined, vars),
      height: this.number(json.height as NumberExpr | undefined, vars),
      text: String(this.get(String(json.value), vars) ?? ''),
      maxLength: this.number(json.maxLength as NumberExpr | undefined, vars, 1),
      filter: json.filter === 'numeric' ? 'numeric' : 'full',
      priority: json.priority === undefined ? Priority.NORMAL : this.model.priority(json.priority as NumberExpr, vars),
      id,
      onChange: (text) => this.invoke(json.change, vars, [], text),
    });
    return {
      id,
      kind: 'textField',
      sync: () => undefined,
      render: (list) => {
        if (this.#fields && this.#fields.fields[0] === field) this.#fields.render(list, this.services.clock.ja2Now);
      },
      dispose: NOOP_DISPOSE,
      describe: () => [],
    };
  }

  #popupLines(json: WidgetJson, vars: Variables): PopupLine[] {
    const lines = typeof json.lines === 'string' ? this.get(json.lines, vars) : json.lines;
    if (!Array.isArray(lines)) return [];
    return lines.map((line) => {
      if (typeof line === 'string') return { text: typeof json.lines === 'string' ? line : this.text(line, vars) };
      const entry = asObject(line);
      if ('text' in entry && (typeof entry.text === 'string' || typeof entry.text === 'object')) {
        const text =
          typeof entry.text === 'string' && typeof json.lines === 'string' ? entry.text : this.text(entry.text as TextSourceJson, vars);
        const second =
          entry.second === undefined
            ? {}
            : {
                second:
                  typeof entry.second === 'string' && typeof json.lines === 'string'
                    ? entry.second
                    : this.text(entry.second as TextSourceJson, vars),
              };
        const shade: { shade?: LineShade } = entry.shade === 'shade' || entry.shade === 'secondary' ? { shade: entry.shade } : {};
        return { text, ...second, ...shade };
      }
      return { text: this.text(line as TextSourceJson, vars) };
    });
  }

  #popupMenu(json: WidgetJson, vars: Variables, dx: number, dy: number): Live {
    const id = this.#id(json, vars);
    const { x, y } = this.#position(json, vars, dx, dy);
    const box = new PopupBox(
      popupBoxStyle(this.model, json, this.services.fonts, vars),
      x,
      y,
      this.number(json.width as NumberExpr | undefined, vars),
    );
    const menu = new PopupMenu(box, {
      regions: this.services.regions,
      onSelect: (line) => this.invoke(json.select, vars, [line]),
      onClose: () => this.invoke(json.close, vars),
      ...(json.priority === undefined ? {} : { priority: this.model.priority(json.priority as NumberExpr, vars) }),
      owner: this.owner,
      id,
    });
    let linesKey = '';
    const sync = () => {
      const lines = this.#popupLines(json, vars);
      const key = JSON.stringify(lines);
      const open = this.condition(json.open as Condition | undefined, vars, false);
      if (key !== linesKey) {
        linesKey = key;
        const highlighted = box.highlighted;
        box.setLines(lines);
        if (menu.open) {
          menu.hide();
          menu.show();
          box.highlighted = highlighted;
        }
      }
      if (open && !menu.open) menu.show();
      else if (!open && menu.open) menu.hide();
    };
    sync();
    return {
      id,
      kind: 'popupMenu',
      sync,
      render: (list) => menu.render(list),
      dispose: () => menu.hide(),
      describe: () => menu.describe(),
    };
  }

  #repeat(json: WidgetJson, vars: Variables, dx: number, dy: number): Live {
    const id = this.#id(json, vars);
    const templates = (Array.isArray(json.template) ? json.template : [json.template]) as WidgetJson[];
    let children: Live[] = [];
    let built = -1;
    const count = () => {
      const c = json.count as NumberExpr | undefined;
      if (typeof c === 'object') {
        const value = this.get(c.bind, vars);
        return Array.isArray(value) ? value.length : Number(value ?? 0);
      }
      return this.number(c, vars);
    };
    const rebuild = (n: number) => {
      for (const child of children) child.dispose();
      children = [];
      const stepX = this.number(json.dx as NumberExpr | undefined, vars);
      const stepY = this.number(json.dy as NumberExpr | undefined, vars);
      const baseX = this.number(json.x as NumberExpr | undefined, vars);
      const baseY = this.number(json.y as NumberExpr | undefined, vars);
      for (let i = 0; i < n; i++) {
        const inner = { ...vars, i };
        for (const template of templates) children.push(this.#build(template, inner, dx + baseX + stepX * i, dy + baseY + stepY * i));
      }
      built = n;
    };
    rebuild(count());
    return {
      id,
      kind: json.type,
      sync: () => {
        const n = count();
        if (n !== built) rebuild(n);
        for (const child of children) child.sync();
      },
      render: (list) => {
        if (!this.#visible(json, vars)) return;
        for (const child of children) child.render(list);
      },
      dispose: () => {
        for (const child of children) child.dispose();
        children = [];
      },
      describe: () => children.flatMap((c) => c.describe()),
    };
  }

  #progressBar(json: WidgetJson, vars: Variables, dx: number, dy: number): Live {
    const id = this.#id(json, vars);
    const { x, y } = this.#position(json, vars, dx, dy);
    const bar = new ProgressBar({
      x,
      y,
      width: this.number(json.width as NumberExpr | undefined, vars),
      height: this.number(json.height as NumberExpr | undefined, vars),
      style: (json.style as ProgressBarStyle | undefined) ?? 'loadBar',
      ...(json.color === undefined ? {} : { fill: this.model.rgbColor(json.color as ColorJson, rgb(150, 0, 0)) }),
      id,
    });
    return {
      id,
      kind: 'progressBar',
      sync: () => bar.setPercentage(this.number(json.value as NumberExpr | undefined, vars)),
      render: (list) => {
        if (this.#visible(json, vars)) bar.render(list);
      },
      dispose: NOOP_DISPOSE,
      describe: () => [bar.describe()],
    };
  }

  #modal(json: WidgetJson, vars: Variables): Live {
    const id = this.#id(json, vars);
    let box: MessageBox | null = null;
    let wasOpen = false;
    const sync = () => {
      const open = this.condition(json.open as Condition | undefined, vars, false);
      if (open && !wasOpen && !box) {
        const styleOf = this.#options.messageBoxStyle;
        const labels = this.#options.messageBoxLabels;
        if (!styleOf || !labels) throw new Error(`${this.model.json.screen}: a modal widget needs the message box styles and labels`);
        const centering = Array.isArray(json.centering) ? json.centering.map((v) => this.number(v as NumberExpr, vars)) : null;
        box = new MessageBox(this.services, {
          style: styleOf(this.number(json.style as NumberExpr | undefined, vars)),
          text: this.text(json.text as TextSourceJson | undefined, vars),
          flags: this.number(json.buttons as NumberExpr | undefined, vars) as MessageBoxFlag,
          labels,
          ...(centering
            ? { centeringRect: { x: centering[0] ?? 0, y: centering[1] ?? 0, width: centering[2] ?? 0, height: centering[3] ?? 0 } }
            : {}),
          id,
          onClose: (result) => {
            box = null;
            this.invoke(json.result, vars, [result]);
          },
        });
        this.services.host.openModal(box);
      }
      wasOpen = open;
    };
    return {
      id,
      kind: 'modal',
      sync,
      render: () => undefined,
      dispose: () => {
        if (box) this.services.host.closeModal(box);
        box = null;
      },
      describe: () => [],
    };
  }

  #custom(json: WidgetJson, vars: Variables, dx: number, dy: number): Live {
    const renderer = this.#options.custom?.[String(json.renderer)];
    const params = asObject(json.params);
    return this.#static(
      json,
      vars,
      (list) => {
        const { x, y } = this.#position(json, vars, dx, dy);
        renderer?.(
          list,
          {
            x,
            y,
            width: this.number(json.width as NumberExpr | undefined, vars),
            height: this.number(json.height as NumberExpr | undefined, vars),
          },
          params,
          this,
        );
      },
      () => {
        const { x, y } = this.#position(json, vars, dx, dy);
        return [
          {
            id: json.id ?? String(json.renderer),
            kind: 'custom',
            rect: widgetRect(
              x,
              y,
              this.number(json.width as NumberExpr | undefined, vars),
              this.number(json.height as NumberExpr | undefined, vars),
            ),
            visible: this.#visible(json, vars),
            enabled: true,
            state: null,
            text: null,
            frame: null,
          },
        ];
      },
    );
  }
}
