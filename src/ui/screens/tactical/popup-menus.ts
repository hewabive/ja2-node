// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Interface.cc InitializeTacticalInterface (newicons3.sti and door_op2.sti button pictures,
// @src button_frame.sti), PopupMovementMenu (the anchor 18 pixels up and left of the pointer, clamped to the screen and
// @src the viewport, the 3 × 3 buttons at +9, +8 on a 20-pixel grid, MSYS_PRIORITY_HIGHEST - 1, the look, run, walk,
// @src action, cancel, sneak, talk, hand and crawl buttons with their help and disabled rules, the action picture by the
// @src hand item), MovementMenuBackregionCallback, BtnMovementCallback, InitDoorOpenMenu (centred on the merc's bounding
// @src box, clamped), PopupDoorOpenMenu, MakeButtonDoor (the "( AP )" help in combat, disabled without the tool or the
// @src points), BtnDoorMenuCallback, DoorMenuBackregionCallback, RenderMovementMenu, RenderOpenDoorMenu.

import type { DoorMenuAction, DoorMenuOption } from '../../../protocol/hints.ts';
import type { SoldierView } from '../../../protocol/view.ts';
import type { DrawList } from '../../draw-list.ts';
import { MouseReason, Priority } from '../../input/mouse.ts';
import type { MouseRegion } from '../../input/regions.ts';
import type { UiServices } from '../../services.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { type Button, buttonImage } from '../../widgets/button.ts';
import type { MovementChoice } from './input/tactical-input.ts';

export const BUTTON_PANEL_WIDTH = 78;
export const BUTTON_PANEL_HEIGHT = 76;
const MENU_POINTER_OFFSET = 18;
const BUTTONS_X = 9;
const BUTTONS_Y = 8;
const GRID = 20;
const MENU_PRIORITY = Priority.HIGHEST - 1;
const OWNER = 'tacticalMenus';
const POPUP_TABLE = 'pTacticalPopupButtonStrings';
const TACTICAL_TABLE = 'TacticalStr';
const LOOK_CURSOR_POPUPTEXT = 60;
const DRIVE_POPUPTEXT = 69;
const NOT_APPLICABLE_POPUPTEXT = 70;
const USE_HANDTOHAND_POPUPTEXT = 71;
const USE_FIREARM_POPUPTEXT = 72;
const USE_BLADE_POPUPTEXT = 73;
const USE_EXPLOSIVE_POPUPTEXT = 74;
const USE_MEDKIT_POPUPTEXT = 75;

const Icon = {
  WALK: 0,
  SNEAK: 1,
  RUN: 2,
  CRAWL: 3,
  LOOK: 4,
  ACTIONC: 5,
  TALK: 6,
  HAND: 7,
  OPEN_DOOR: 8,
  EXAMINE_DOOR: 9,
  LOCKPICK_DOOR: 10,
  BOOT_DOOR: 11,
  UNTRAP_DOOR: 12,
  USE_KEYRING: 14,
  EXPLOSIVE_DOOR: 15,
  USE_CROWBAR: 16,
  CANCEL: 17,
  CLOSE: 18,
} as const;

const NEW_ICONS = {
  run: 0,
  walk: 3,
  sneak: 6,
  crawl: 9,
  look: 12,
  cancel: 15,
  hand: 18,
  talk: 21,
  target: 24,
  knife: 27,
  aid: 30,
  punch: 33,
  bomb: 36,
  toolkit: 39,
  wirecut: 42,
} as const;

const DOOR_ICONS = { crowbar: 0, keyring: 6, open: 9, examine: 12, explosive: 15, lockpick: 21, boot: 25 } as const;

export interface MenuArt {
  readonly frame: string;
  readonly icons: string;
  readonly doorIcons: string;
}

export interface MenuItemInfo {
  readonly name: string;
  readonly class: string;
}

export interface MovementMenuSubject {
  readonly soldier: SoldierView;
  readonly epc: boolean;
  readonly vehicle: boolean;
  readonly robot: boolean;
  readonly uncontrolledRobot: boolean;
  readonly handItem: MenuItemInfo | null;
}

interface PlacedButton {
  readonly button: Button;
}

function iconImage(asset: string, first: number) {
  return buttonImage(asset, -1, first, first + 1, first + 2, -1);
}

abstract class PopupMenu {
  protected readonly services: UiServices;
  protected readonly text: UiTextService;
  protected readonly art: MenuArt;
  #buttons: PlacedButton[] = [];
  #back: MouseRegion | null = null;
  #x = 0;
  #y = 0;

  constructor(services: UiServices, text: UiTextService, art: MenuArt) {
    this.services = services;
    this.text = text;
    this.art = art;
  }

  get open(): boolean {
    return this.#back !== null;
  }

  get origin(): { readonly x: number; readonly y: number } {
    return { x: this.#x, y: this.#y };
  }

  get buttons(): readonly Button[] {
    return this.#buttons.map((b) => b.button);
  }

  protected popup(x: number, y: number, onBack: () => void): void {
    this.#x = x;
    this.#y = y;
    const { width, height } = this.services.geometry();
    this.#back = this.services.regions.define({
      x1: 0,
      y1: 0,
      x2: width,
      y2: height,
      priority: MENU_PRIORITY,
      cursor: 0,
      owner: OWNER,
      id: 'tacticalMenuBack',
      onButton: (_r, reason) => {
        if (reason & MouseReason.LBUTTON_UP) onBack();
      },
    });
  }

  protected add(
    id: string,
    column: number,
    row: number,
    image: ReturnType<typeof iconImage>,
    help: string,
    disabled: boolean,
    click: () => void,
  ): void {
    const button = this.services.buttons.create({
      x: this.#x + BUTTONS_X + column * GRID,
      y: this.#y + BUTTONS_Y + row * GRID,
      kind: 'quick',
      image,
      priority: MENU_PRIORITY,
      owner: OWNER,
      id,
      onClick: (_b, reason) => {
        if (reason & MouseReason.LBUTTON_UP) click();
      },
    });
    button.setTooltip(help);
    if (disabled) button.disable();
    this.#buttons.push({ button });
  }

  protected popdown(): void {
    for (const b of this.#buttons) b.button.remove();
    this.#buttons = [];
    this.#back?.remove();
    this.#back = null;
  }

  protected popupText(index: number): string {
    return this.text.string(POPUP_TABLE, index) ?? '';
  }

  protected tacticalText(index: number): string {
    return this.text.string(TACTICAL_TABLE, index) ?? '';
  }

  render(list: DrawList): void {
    if (!this.open) return;
    list.image(this.art.frame, 0, this.#x, this.#y);
    for (const b of this.#buttons) this.services.buttons.draw(list, b.button);
  }
}

function actionPicture(subject: MovementMenuSubject): { readonly icon: number; readonly help: number; readonly disabled: boolean } {
  if (subject.vehicle) return { icon: NEW_ICONS.cancel, help: NOT_APPLICABLE_POPUPTEXT, disabled: true };
  const item = subject.handItem;
  if (item?.name === 'TOOLKIT') return { icon: NEW_ICONS.toolkit, help: NOT_APPLICABLE_POPUPTEXT, disabled: false };
  if (item?.name === 'WIRECUTTERS') return { icon: NEW_ICONS.wirecut, help: NOT_APPLICABLE_POPUPTEXT, disabled: false };
  switch (item?.class ?? 'PUNCH') {
    case 'PUNCH':
      return { icon: NEW_ICONS.punch, help: USE_HANDTOHAND_POPUPTEXT, disabled: false };
    case 'GUN':
      return { icon: NEW_ICONS.target, help: USE_FIREARM_POPUPTEXT, disabled: false };
    case 'BLADE':
      return { icon: NEW_ICONS.knife, help: USE_BLADE_POPUPTEXT, disabled: false };
    case 'GRENADE':
    case 'BOMB':
      return { icon: NEW_ICONS.bomb, help: USE_EXPLOSIVE_POPUPTEXT, disabled: false };
    case 'MEDKIT':
      return { icon: NEW_ICONS.aid, help: USE_MEDKIT_POPUPTEXT, disabled: false };
    default:
      return { icon: NEW_ICONS.cancel, help: NOT_APPLICABLE_POPUPTEXT, disabled: true };
  }
}

export class MovementMenu extends PopupMenu {
  #done: ((choice: MovementChoice | null) => void) | null = null;

  show(
    subject: MovementMenuSubject,
    pointer: { x: number; y: number },
    viewportBottom: number,
    done: (choice: MovementChoice | null) => void,
  ): void {
    this.close(null);
    const { width } = this.services.geometry();
    let x = Math.max(0, pointer.x - MENU_POINTER_OFFSET);
    let y = Math.max(0, pointer.y - MENU_POINTER_OFFSET);
    if (x > width - BUTTON_PANEL_WIDTH) x = width - BUTTON_PANEL_WIDTH;
    if (y > viewportBottom - BUTTON_PANEL_HEIGHT) y = viewportBottom - BUTTON_PANEL_HEIGHT;
    this.#done = done;
    this.popup(x, y, () => this.close(null));
    const icons = this.art.icons;
    const pick = (choice: MovementChoice) => () => this.close(choice);
    const action = actionPicture(subject);
    this.add(
      'menuLook',
      0,
      0,
      iconImage(icons, NEW_ICONS.look),
      this.tacticalText(LOOK_CURSOR_POPUPTEXT),
      subject.vehicle || subject.uncontrolledRobot,
      pick('look'),
    );
    this.add('menuRun', 1, 0, iconImage(icons, NEW_ICONS.run), this.popupText(Icon.RUN), subject.vehicle || subject.robot, pick('run'));
    const walkHelp = subject.vehicle ? this.tacticalText(DRIVE_POPUPTEXT) : this.popupText(Icon.WALK);
    this.add('menuWalk', 2, 0, iconImage(icons, NEW_ICONS.walk), walkHelp, subject.uncontrolledRobot, pick('walk'));
    this.add(
      'menuAction',
      0,
      1,
      iconImage(icons, action.icon),
      this.tacticalText(action.help),
      subject.epc || action.disabled,
      pick('action'),
    );
    this.add('menuCancel', 1, 1, iconImage(icons, NEW_ICONS.cancel), this.popupText(Icon.CANCEL), false, () => this.close(null));
    this.add('menuSneak', 2, 1, iconImage(icons, NEW_ICONS.sneak), this.popupText(Icon.SNEAK), subject.vehicle, pick('swat'));
    this.add('menuTalk', 0, 2, iconImage(icons, NEW_ICONS.talk), this.popupText(Icon.TALK), subject.epc || subject.vehicle, pick('talk'));
    this.add('menuHand', 1, 2, iconImage(icons, NEW_ICONS.hand), this.popupText(Icon.HAND), subject.epc || subject.vehicle, pick('hand'));
    this.add('menuCrawl', 2, 2, iconImage(icons, NEW_ICONS.crawl), this.popupText(Icon.CRAWL), subject.vehicle, pick('prone'));
  }

  close(choice: MovementChoice | null): void {
    if (!this.open) return;
    this.popdown();
    const done = this.#done;
    this.#done = null;
    done?.(choice);
  }
}

interface DoorButton {
  readonly action: DoorMenuAction | 'cancel';
  readonly id: string;
  readonly column: number;
  readonly row: number;
  readonly icon: 'door' | 'new';
  readonly first: number;
  readonly help: number;
}

const DOOR_BUTTONS: readonly DoorButton[] = [
  { action: 'unlock', id: 'doorUnlock', column: 1, row: 0, icon: 'door', first: DOOR_ICONS.keyring, help: Icon.USE_KEYRING },
  { action: 'crowbar', id: 'doorCrowbar', column: 2, row: 0, icon: 'door', first: DOOR_ICONS.crowbar, help: Icon.USE_CROWBAR },
  { action: 'pickLock', id: 'doorLockpick', column: 2, row: 1, icon: 'door', first: DOOR_ICONS.lockpick, help: Icon.LOCKPICK_DOOR },
  { action: 'explode', id: 'doorExplode', column: 2, row: 2, icon: 'door', first: DOOR_ICONS.explosive, help: Icon.EXPLOSIVE_DOOR },
  { action: 'openManually', id: 'doorOpen', column: 0, row: 0, icon: 'door', first: DOOR_ICONS.open, help: Icon.OPEN_DOOR },
  { action: 'examine', id: 'doorExamine', column: 0, row: 1, icon: 'door', first: DOOR_ICONS.examine, help: Icon.EXAMINE_DOOR },
  { action: 'force', id: 'doorForce', column: 0, row: 2, icon: 'door', first: DOOR_ICONS.boot, help: Icon.BOOT_DOOR },
  { action: 'untrap', id: 'doorUntrap', column: 1, row: 2, icon: 'new', first: NEW_ICONS.bomb, help: Icon.UNTRAP_DOOR },
  { action: 'cancel', id: 'doorCancel', column: 1, row: 1, icon: 'new', first: NEW_ICONS.cancel, help: Icon.CANCEL },
];

const CLOSE_BUTTON: DoorButton = {
  action: 'closeManually',
  id: 'doorClose',
  column: 0,
  row: 0,
  icon: 'door',
  first: DOOR_ICONS.open,
  help: Icon.CLOSE,
};

function doorButtons(closing: boolean): readonly DoorButton[] {
  return closing ? DOOR_BUTTONS.map((b) => (b.action === 'openManually' ? CLOSE_BUTTON : b)) : DOOR_BUTTONS;
}

export interface DoorMenuRequest {
  readonly soldier: number;
  readonly gridNo: number;
  readonly options: readonly DoorMenuOption[];
  readonly closing: boolean;
  readonly box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null;
  readonly inCombat: boolean;
  readonly viewportBottom: number;
}

export class DoorMenu extends PopupMenu {
  #request: DoorMenuRequest | null = null;
  #done: ((action: DoorMenuAction | null) => void) | null = null;

  get request(): DoorMenuRequest | null {
    return this.open ? this.#request : null;
  }

  show(request: DoorMenuRequest, done: (action: DoorMenuAction | null) => void): void {
    this.close(null);
    const { width } = this.services.geometry();
    const box = request.box ?? { x: 0, y: 0, width: BUTTON_PANEL_WIDTH, height: BUTTON_PANEL_HEIGHT };
    let x = box.x - Math.trunc((BUTTON_PANEL_WIDTH - box.width) / 2);
    let y = box.y - Math.trunc((BUTTON_PANEL_HEIGHT - box.height) / 2);
    if (x + BUTTON_PANEL_WIDTH > width) x = width - BUTTON_PANEL_WIDTH;
    if (y + BUTTON_PANEL_HEIGHT > request.viewportBottom) y = request.viewportBottom - BUTTON_PANEL_HEIGHT;
    x = Math.max(0, x);
    y = Math.max(0, y);
    this.#request = request;
    this.#done = done;
    this.popup(x, y, () => this.close(null));
    for (const spec of doorButtons(request.closing)) {
      const option = request.options.find((o) => o.action === spec.action);
      const ap = option?.ap ?? 0;
      const help = this.popupText(spec.help);
      const shown = ap === 0 || !request.inCombat ? help : `${help} ( ${ap} )`;
      const image = iconImage(spec.icon === 'door' ? this.art.doorIcons : this.art.icons, spec.first);
      const disabled = spec.action !== 'cancel' && option?.enabled !== true;
      const action = spec.action;
      this.add(spec.id, spec.column, spec.row, image, shown, disabled, () => this.close(action === 'cancel' ? null : action));
    }
  }

  close(action: DoorMenuAction | null): void {
    if (!this.open) return;
    this.popdown();
    const done = this.#done;
    this.#done = null;
    this.#request = null;
    done?.(action);
  }
}
