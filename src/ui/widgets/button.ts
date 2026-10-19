// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/sgp/Button_System.cc LoadButtonImage, SetMaxSize, GUI_BUTTON::GUI_BUTTON, QuickCreateButton*,
// @src CreateIconAndTextButton, CreateHotSpot, CreateCheckBoxButton, CreateLabel, QuickButtonCallbackMMove,
// @src QuickButtonCallbackMButn (anchoring, toggles, check boxes, sounds, deferred deletion), DefaultMoveCallback,
// @src ReleaseAnchorMode, RenderButtons, DrawButtonFromPtr, DrawQuickButton, DrawCheckBoxButton, DrawHatchOnButton,
// @src DrawShadeOnButton, DrawIconOnButton, DrawTextOnButton, GUI_BUTTON::Hide/Show; src/sgp/Button_System.h.
// See docs/28 §3.3.

import { DEFAULT_SHADOW, FontColor } from '../../content/text/font-colors.ts';
import { idiv } from '../../core/int.ts';
import { frameOf, type ImageCatalog } from '../assets.ts';
import type { Area, AssetKey, DrawList } from '../draw-list.ts';
import { MouseButtonMask, MouseReason, Priority } from '../input/mouse.ts';
import type { MouseRegion, RegionDispatcher } from '../input/regions.ts';
import { type BitmapFont, fontHeight } from '../text/bitmap-font.ts';
import { stringPixLength } from '../text/measure.ts';
import { mprint, withClip } from '../text/print.ts';
import { displayWrappedString, TextFlag } from '../text/wrap.ts';
import {
  type ButtonSound,
  ButtonSoundScheme,
  buttonSoundRequest,
  isAudible,
  resolveScheme,
  type UiScreenKind,
  type UiSoundSink,
} from './button-sounds.ts';
import { type WidgetInfo, widgetRect } from './widget-info.ts';

export const NO_IMAGE = -1;
export const MAX_BUTTONS = 400;
const STARTING_CURSOR = 0;
const TEXT_INSET_X = 3;
const TEXT_INSET_Y = 2;
const NO_VALUE = -1;
const DEFAULT_SUB_OFFSET = -1;
const POINTER_DOWN = MouseReason.LBUTTON_DWN;
const POINTER_UP = MouseReason.LBUTTON_UP;
const ANY_DOWN = MouseReason.LBUTTON_DWN | MouseReason.RBUTTON_DWN;

export interface ButtonImage {
  readonly asset: AssetKey;
  readonly grayed: number;
  readonly offNormal: number;
  readonly offHilite: number;
  readonly onNormal: number;
  readonly onHilite: number;
}

export function buttonImage(
  asset: AssetKey,
  grayed: number,
  offNormal: number,
  offHilite: number,
  onNormal: number,
  onHilite: number,
): ButtonImage {
  if ([grayed, offNormal, offHilite, onNormal, onHilite].every((f) => f === NO_IMAGE)) throw new Error('No button pictures selected');
  return { asset, grayed, offNormal, offHilite, onNormal, onHilite };
}

export function twoFrameImage(asset: AssetKey, offNormal: number, onNormal: number): ButtonImage {
  return buttonImage(asset, NO_IMAGE, offNormal, NO_IMAGE, onNormal, NO_IMAGE);
}

export function checkBoxImage(asset: AssetKey): ButtonImage {
  return buttonImage(asset, NO_IMAGE, 0, 1, 2, 3);
}

export type ButtonKind = 'quick' | 'quickNoMove' | 'toggle' | 'checkbox' | 'hotspot' | 'label';
export type DisabledStyle = 'none' | 'default' | 'hatched' | 'shaded';
export type TextJustification = 'left' | 'center' | 'right';
export type ButtonCallback = (button: Button, reason: number) => void;

export interface ButtonText {
  readonly text: string;
  readonly font: BitmapFont;
  readonly color: number;
  readonly shadow?: number;
  readonly downColor?: number;
  readonly downShadow?: number;
  readonly hiliteColor?: number;
  readonly hiliteShadow?: number;
  readonly justify?: TextJustification;
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly subOffsetX?: number;
  readonly subOffsetY?: number;
  readonly shift?: boolean;
  readonly wrapWidth?: number;
}

export interface ButtonIcon {
  readonly asset: AssetKey;
  readonly frame: number;
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly shift?: boolean;
}

export interface ButtonDefinition {
  readonly x: number;
  readonly y: number;
  readonly kind?: ButtonKind;
  readonly image?: ButtonImage;
  readonly width?: number;
  readonly height?: number;
  readonly priority?: number;
  readonly cursor?: number;
  readonly onClick?: ButtonCallback | null;
  readonly onMove?: ButtonCallback | null;
  readonly customMove?: boolean;
  readonly text?: ButtonText;
  readonly icon?: ButtonIcon;
  readonly disabledStyle?: DisabledStyle;
  readonly sound?: ButtonSoundScheme;
  readonly owner?: unknown;
  readonly id?: string;
  readonly tooltip?: string;
}

export class Button {
  readonly slot: number;
  readonly id: string;
  readonly owner: unknown;
  readonly kind: ButtonKind;
  readonly image: ButtonImage | null;
  readonly region: MouseRegion;
  readonly defaultMove: boolean;
  onClick: ButtonCallback | null;
  onMove: ButtonCallback | null;
  text: ButtonText | null;
  icon: ButtonIcon | null;
  disabledStyle: DisabledStyle;
  soundScheme: ButtonSoundScheme;
  enabledFlag = true;
  clickedOn = false;
  toggleActivated = false;
  deletionPending = false;
  lastFrame: number | null = null;
  readonly #system: ButtonSystem;

  constructor(system: ButtonSystem, slot: number, region: MouseRegion, definition: ButtonDefinition, scheme: ButtonSoundScheme) {
    this.#system = system;
    this.slot = slot;
    this.id = definition.id ?? `button${slot}`;
    this.owner = definition.owner;
    this.kind = definition.kind ?? 'quick';
    this.image = definition.image ?? null;
    this.region = region;
    this.defaultMove = !definition.customMove && (this.kind === 'quick' || this.kind === 'hotspot' || this.kind === 'label');
    this.onClick = definition.onClick ?? null;
    this.onMove = definition.onMove ?? null;
    this.text = definition.text ?? null;
    this.icon = definition.icon ?? null;
    this.disabledStyle = definition.disabledStyle ?? (this.kind === 'label' ? 'none' : 'default');
    this.soundScheme = scheme;
  }

  get x(): number {
    return this.region.x1;
  }

  get y(): number {
    return this.region.y1;
  }

  get width(): number {
    return this.region.x2 - this.region.x1;
  }

  get height(): number {
    return this.region.y2 - this.region.y1;
  }

  get bottomRightX(): number {
    return this.region.x2;
  }

  get bottomRightY(): number {
    return this.region.y2;
  }

  get enabled(): boolean {
    return this.enabledFlag;
  }

  get clicked(): boolean {
    return this.clickedOn;
  }

  get visible(): boolean {
    return this.region.enabled;
  }

  enable(): void {
    this.enabledFlag = true;
  }

  disable(): void {
    this.enabledFlag = false;
  }

  setEnabled(enabled: boolean): void {
    this.enabledFlag = enabled;
  }

  setClicked(clicked: boolean): void {
    this.clickedOn = clicked;
  }

  hide(): void {
    this.region.disable();
  }

  show(): void {
    this.region.enable();
  }

  setVisible(visible: boolean): void {
    if (visible) this.show();
    else this.hide();
  }

  setText(text: string): void {
    if (this.text) this.text = { ...this.text, text };
  }

  setTooltip(text: string): void {
    this.region.setTooltip(text);
  }

  allowDisabledTooltip(): void {
    this.region.allowDisabledTooltip = true;
  }

  setCursor(cursor: number): void {
    this.region.changeCursor(cursor);
  }

  moveTo(x: number, y: number): void {
    this.region.move(x, y, x + this.width, y + this.height);
  }

  remove(): void {
    this.#system.remove(this);
  }

  describe(): WidgetInfo {
    const state = this.kind === 'checkbox' || this.kind === 'toggle' ? this.clickedOn : this.clickedOn ? 'pressed' : 'normal';
    return {
      id: this.id,
      kind: `button:${this.kind}`,
      rect: widgetRect(this.x, this.y, this.width, this.height),
      visible: this.visible,
      enabled: this.enabled,
      state,
      text: this.text?.text ?? null,
      frame: this.lastFrame,
    };
  }
}

export interface ButtonSystemOptions {
  readonly regions: RegionDispatcher;
  readonly images: ImageCatalog;
  readonly sounds: UiSoundSink;
  readonly screen: () => UiScreenKind;
}

export class ButtonSystem {
  readonly #regions: RegionDispatcher;
  readonly #images: ImageCatalog;
  readonly #sounds: UiSoundSink;
  readonly #screen: () => UiScreenKind;
  readonly #slots: (Button | null)[] = new Array(MAX_BUTTONS).fill(null);
  #anchored: Button | null = null;
  #previousAnchored: Button | null = null;
  #anchoredState = false;
  #delayDeletion = false;
  #pendingDeletion = false;
  renderHilights = true;

  constructor(options: ButtonSystemOptions) {
    this.#regions = options.regions;
    this.#images = options.images;
    this.#sounds = options.sounds;
    this.#screen = options.screen;
    this.#regions.onLeftUp((x, y) => this.#releaseAnchorMode(x, y));
  }

  get buttons(): readonly Button[] {
    return this.#slots.filter((b): b is Button => b !== null);
  }

  #nextSlot(): number {
    for (let i = 1; i < MAX_BUTTONS; i++) if (this.#slots[i] === null) return i;
    throw new Error('No more button slots');
  }

  imageSize(image: ButtonImage): { width: number; height: number } {
    let width = 0;
    let height = 0;
    for (const frame of [image.grayed, image.offNormal, image.offHilite, image.onNormal, image.onHilite]) {
      if (frame === NO_IMAGE) continue;
      const f = frameOf(this.#images, image.asset, frame);
      width = Math.max(width, f.offsetX + f.width);
      height = Math.max(height, f.offsetY + f.height);
    }
    return { width, height };
  }

  create(definition: ButtonDefinition): Button {
    const slot = this.#nextSlot();
    const size = definition.image ? this.imageSize(definition.image) : { width: definition.width ?? 0, height: definition.height ?? 0 };
    const width = definition.width ?? size.width;
    const height = definition.height ?? size.height;
    let button: Button | null = null;
    const region = this.#regions.define({
      x1: definition.x,
      y1: definition.y,
      x2: definition.x + width,
      y2: definition.y + height,
      priority: definition.priority ?? Priority.NORMAL,
      cursor: definition.cursor ?? STARTING_CURSOR,
      owner: definition.owner,
      id: definition.id,
      onMove: (_r, reason) => {
        if (button) this.#move(button, reason);
      },
      onButton: (_r, reason) => {
        if (button) this.#press(button, reason);
      },
    });
    const scheme = resolveScheme(definition.sound ?? ButtonSoundScheme.GENERIC, this.#screen());
    button = new Button(this, slot, region, definition, scheme);
    this.#slots[slot] = button;
    if (definition.tooltip) region.setTooltip(definition.tooltip);
    if (button.kind === 'label') button.disable();
    return button;
  }

  remove(button: Button): void {
    if (this.#slots[button.slot] !== button) return;
    if (this.#delayDeletion) {
      button.deletionPending = true;
      this.#pendingDeletion = true;
      return;
    }
    this.#delete(button);
  }

  #delete(button: Button): void {
    if (button === this.#anchored) this.#anchored = null;
    if (button === this.#previousAnchored) this.#previousAnchored = null;
    this.#slots[button.slot] = null;
    button.region.remove();
  }

  removeOwner(owner: unknown): void {
    for (const button of this.buttons) if (button.owner === owner) this.remove(button);
  }

  #removePending(): void {
    this.#pendingDeletion = false;
    for (const button of this.buttons) if (button.deletionPending) this.#delete(button);
  }

  #play(button: Button, sound: ButtonSound): void {
    if (!isAudible(button.soundScheme)) return;
    const request = buttonSoundRequest(button.soundScheme, sound);
    if (request) this.#sounds.play(request);
  }

  #move(button: Button, reason: number): void {
    if (button.kind === 'toggle' && reason & MouseReason.LOST_MOUSE && button.toggleActivated) {
      button.clickedOn = !button.clickedOn;
      button.toggleActivated = false;
    }
    if (!button.enabled) return;
    if (button.defaultMove) this.#defaultMove(button, reason);
    button.onMove?.(button, reason);
  }

  #defaultMove(button: Button, reason: number): void {
    if (button !== this.#anchored) return;
    if (reason & MouseReason.LOST_MOUSE) {
      if (!this.#anchoredState) {
        button.clickedOn = false;
        this.#play(button, 'clickedOff');
      }
    } else if (reason & MouseReason.GAIN_MOUSE) {
      button.clickedOn = true;
      this.#play(button, 'clickedOn');
    }
  }

  #releaseAnchorMode(x: number, y: number): void {
    const button = this.#anchored;
    if (!button) return;
    if (x < button.x || button.bottomRightX < x || y < button.y || button.bottomRightY < y) button.clickedOn = this.#anchoredState;
    this.#previousAnchored = button;
    this.#anchored = null;
  }

  #press(button: Button, reason: number): void {
    if (!button.enabled) {
      if (reason & ANY_DOWN) this.#play(button, 'disabledClick');
      return;
    }
    let before = button.clicked;
    let after = true;
    if (button.kind === 'toggle') {
      if (reason & POINTER_DOWN) {
        if (!button.toggleActivated) {
          button.clickedOn = !button.clickedOn;
          button.toggleActivated = true;
        }
      } else if (reason & POINTER_UP) button.toggleActivated = false;
    }
    if (button.defaultMove) {
      if (reason & POINTER_DOWN) {
        this.#anchored = button;
        this.#anchoredState = before;
        button.clickedOn = true;
      } else if (reason & POINTER_UP) button.clickedOn = false;
    } else if (button.kind === 'checkbox') {
      if (reason & POINTER_DOWN) {
        this.#anchored = button;
        this.#anchoredState = before;
        before = !button.clicked;
        after = !before;
      } else if (reason & POINTER_UP) {
        button.clickedOn = !button.clickedOn;
        before = !button.clicked;
        after = !before;
      }
    }
    if (button.onClick) {
      this.#delayDeletion = true;
      try {
        if (!(reason & POINTER_UP) || !button.defaultMove || this.#previousAnchored === button) button.onClick(button, reason);
      } finally {
        this.#delayDeletion = false;
      }
    } else if (reason & POINTER_DOWN) button.clickedOn = !button.clickedOn;
    if (button.kind === 'checkbox') after = button.clicked;
    if (button.enabled) {
      if (reason & POINTER_UP) {
        if (before && !after) this.#play(button, 'clickedOff');
      } else if (reason & POINTER_DOWN) {
        if (!before && after) this.#play(button, 'clickedOn');
      }
    }
    if (this.#pendingDeletion) this.#removePending();
  }

  render(list: DrawList, owner?: unknown): void {
    for (const button of this.buttons) {
      if (owner !== undefined && button.owner !== owner) continue;
      if (!button.region.enabled) continue;
      this.draw(list, button);
    }
  }

  draw(list: DrawList, button: Button): void {
    let style: DisabledStyle = 'none';
    switch (button.kind) {
      case 'hotspot':
        return;
      case 'checkbox':
        style = this.#drawCheckBox(list, button);
        break;
      default:
        style = button.image ? this.#drawQuick(list, button) : 'none';
        break;
    }
    if (button.icon) this.#drawIcon(list, button, button.icon);
    if (button.text && button.text.text.length > 0) this.#drawText(list, button, button.text);
    if (style === 'hatched') list.hatch(button.x, button.y, button.bottomRightX - 1, button.bottomRightY - 1);
    else if (style === 'shaded') list.shadow(button.x, button.y, button.bottomRightX, button.bottomRightY);
  }

  #hovered(button: Button): boolean {
    return button.region.inArea && this.renderHilights;
  }

  #disabledStyle(button: Button, fallback: DisabledStyle): DisabledStyle {
    if (button.disabledStyle === 'default') return fallback;
    return button.disabledStyle === 'none' ? 'none' : button.disabledStyle;
  }

  #drawQuick(list: DrawList, button: Button): DisabledStyle {
    const image = button.image as ButtonImage;
    let frame = 0;
    let style: DisabledStyle = 'none';
    if (button.enabled) {
      if (button.clicked) {
        if (this.#hovered(button) && image.onHilite !== NO_IMAGE) frame = image.onHilite;
        else if (image.onNormal !== NO_IMAGE) frame = image.onNormal;
      } else if (this.#hovered(button) && image.offHilite !== NO_IMAGE) frame = image.offHilite;
      else if (image.offNormal !== NO_IMAGE) frame = image.offNormal;
    } else if (image.grayed !== NO_IMAGE) frame = image.grayed;
    else {
      frame = image.offNormal;
      style = this.#disabledStyle(button, button.text && button.text.text.length > 0 ? 'shaded' : 'hatched');
    }
    button.lastFrame = frame;
    list.image(image.asset, frame, button.x, button.y);
    return style;
  }

  #drawCheckBox(list: DrawList, button: Button): DisabledStyle {
    const image = button.image as ButtonImage;
    const pressing = this.#hovered(button) && this.#regions.isButtonDown(MouseButtonMask.LEFT);
    let frame = 0;
    let style: DisabledStyle = 'none';
    if (button.enabled) {
      if (button.clicked) {
        if (pressing && image.onHilite !== NO_IMAGE) frame = image.onHilite;
        else if (image.onNormal !== NO_IMAGE) frame = image.onNormal;
      } else if (pressing && image.offHilite !== NO_IMAGE) frame = image.offHilite;
      else if (image.offNormal !== NO_IMAGE) frame = image.offNormal;
    } else if (image.grayed !== NO_IMAGE) frame = image.grayed;
    else {
      frame = button.clicked ? image.onHilite : image.offHilite;
      style = this.#disabledStyle(button, 'hatched');
    }
    button.lastFrame = frame;
    list.image(image.asset, frame, button.x, button.y);
    return style;
  }

  #innerClip(button: Button): Area | null {
    const left = button.x + TEXT_INSET_X;
    const right = button.x + button.width - TEXT_INSET_X;
    const top = button.y + TEXT_INSET_Y;
    const bottom = button.y + button.height - TEXT_INSET_Y;
    if (right <= left || bottom <= top) return null;
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  #drawIcon(list: DrawList, button: Button, icon: ButtonIcon): void {
    const clip = this.#innerClip(button);
    if (!clip) return;
    const f = frameOf(this.#images, icon.asset, icon.frame);
    let x = icon.offsetX === undefined ? clip.x + idiv(button.width - 6 - (f.width + f.offsetX), 2) : button.x + icon.offsetX;
    let y = icon.offsetY === undefined ? clip.y + idiv(button.height - 4 - (f.height + f.offsetY), 2) : button.y + icon.offsetY;
    if (button.clicked && (icon.shift ?? true)) {
      x++;
      y++;
    }
    withClip(list, clip, () => list.image(icon.asset, icon.frame, x, y));
  }

  #drawText(list: DrawList, button: Button, text: ButtonText): void {
    const clip = this.#innerClip(button);
    if (!clip) return;
    const font = text.font;
    const length = stringPixLength(text.text, font);
    let y = text.offsetY === undefined ? clip.y + idiv(button.height - fontHeight(font), 2) - 1 : button.y + text.offsetY;
    let x: number;
    const justify = text.justify ?? 'center';
    if (text.offsetX === undefined) {
      if (justify === 'left') x = clip.x + 3;
      else if (justify === 'right') x = clip.x + clip.width - length - 3;
      else x = clip.x + idiv(button.width - 6 - length, 2);
    } else x = button.x + text.offsetX;
    const hilite = button.enabled && button.region.inArea;
    const foreground =
      hilite && text.hiliteColor !== undefined && text.hiliteColor !== NO_VALUE
        ? text.hiliteColor
        : button.clicked && text.downColor !== undefined && text.downColor !== NO_VALUE
          ? text.downColor
          : text.color;
    const shadow =
      hilite && text.hiliteShadow !== undefined && text.hiliteShadow !== NO_VALUE
        ? text.hiliteShadow
        : button.clicked && text.downShadow !== undefined && text.downShadow !== NO_VALUE
          ? text.downShadow
          : text.shadow !== undefined && text.shadow !== NO_VALUE
            ? text.shadow
            : DEFAULT_SHADOW;
    const shift = text.shift ?? true;
    if (button.clicked && shift) {
      x++;
      y++;
    }
    const colors = { foreground, shadow, background: FontColor.MCOLOR_BLACK };
    const subX = text.subOffsetX ?? DEFAULT_SUB_OFFSET;
    const subY = text.subOffsetY ?? DEFAULT_SUB_OFFSET;
    withClip(list, clip, () => {
      if (text.wrapWidth === undefined) {
        mprint(list, font, x + subX, y + subY, text.text, colors);
        return;
      }
      const flags =
        justify === 'left' ? TextFlag.LEFT_JUSTIFIED : justify === 'right' ? TextFlag.RIGHT_JUSTIFIED : TextFlag.CENTER_JUSTIFIED;
      let wx = x;
      let wy = y;
      if (text.offsetX === undefined) {
        wy = button.y + 2;
        if (justify === 'right') wx = button.bottomRightX - 3 - text.wrapWidth;
        else if (justify === 'center') wx = button.x + 3 + idiv(text.wrapWidth, 2);
        if (justify !== 'left' && shift && button.clicked) {
          wx++;
          wy++;
        }
      }
      displayWrappedString(list, wx + subX, wy + subY, text.wrapWidth, 1, font, colors, text.text, flags);
    });
  }
}
