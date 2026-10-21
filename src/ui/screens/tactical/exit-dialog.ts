// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Strategic_Exit_GUI.cc InternalInitSectorExitMenu (the dialog merc popup box titled
// @src EXIT_GUI_TITLE_STR, 100 wide with the margins 85, 2 and 75, centred over the viewport above the inventory
// @src panel; the back region at MSYS_PRIORITY_HIGHEST - 1, the single, all and load regions and check boxes, the OK and
// @src Cancel buttons of popupbuttons.sti at +65 and +135, +78; the game paused), UpdateSectorExitMenu (the check states
// @src and the help texts), RenderSectorExitMenu (ESC cancels, ENTER confirms; FONT12ARIAL labels in dark grey when
// @src disabled, light yellow under the pointer, else white), RemoveSectorExitMenu (MSG_EPC_CANT_TRAVERSE, the jump
// @src code), CheckLoadMapCallback, SingleMoveAction, AllMoveAction, the region move callbacks. See docs/28 §6.6.

import { DEFAULT_SHADOW, FontColor } from '../../../content/text/font-colors.ts';
import type { ExitMenu, ExitSectorOptions } from '../../../protocol/hints.ts';
import type { SoldierView } from '../../../protocol/view.ts';
import type { DrawList } from '../../draw-list.ts';
import { MouseReason, Priority } from '../../input/mouse.ts';
import type { MouseRegion } from '../../input/regions.ts';
import type { UiServices } from '../../services.ts';
import type { BitmapFont } from '../../text/bitmap-font.ts';
import { fontColors, mprint } from '../../text/print.ts';
import { printf } from '../../text/printf.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { type Button, buttonImage, checkBoxImage } from '../../widgets/button.ts';
import { MercTextBox, type MercTextBoxArt } from '../../widgets/merc-text-box.ts';

const OWNER = 'tacticalExitDialog';
const TACTICAL = 'TacticalStr';
const HELP = 'pExitingSectorHelpText';
const LATE = 'gzLateLocalizedString';
const EXIT_GUI_TITLE_STR = 94;
const OK_BUTTON_TEXT_STR = 95;
const CANCEL_BUTTON_TEXT_STR = 96;
const EXIT_GUI_SELECTED_MERC_STR = 97;
const EXIT_GUI_ALL_MERCS_IN_SQUAD_STR = 98;
const EXIT_GUI_GOTO_SECTOR_STR = 99;
const EXIT_GUI_GOTO_MAP_STR = 100;
const STR_LATE_01 = 0;
const ExitHelp = {
  LOAD_ADJACENT_SECTOR: 0,
  GOTO_MAPSCREEN: 1,
  CANT_LEAVE_HOSTILE_SECTOR: 2,
  MUST_LOAD_ADJACENT_SECTOR: 3,
  MUST_GOTO_MAPSCREEN: 4,
  ESCORTED_CHARACTERS_MUST_BE_ESCORTED: 5,
  CANT_ISOLATE_EPC_MALE_SINGULAR: 6,
  CANT_ISOLATE_EPC_FEMALE_SINGULAR: 7,
  CANT_ISOLATE_EPC_MALE_PLURAL: 8,
  CANT_ISOLATE_EPC_FEMALE_PLURAL: 9,
  ALL_MERCS_MUST_BE_TOGETHER: 10,
  SINGLE_TRAVERSAL_WILL_SEPARATE_SQUADS: 11,
  ALL_TRAVERSAL_WILL_MOVE_CURRENT_SQUAD: 12,
} as const;
const BOX_WIDTH = 100;
const BOX_MARGIN_X = 85;
const BOX_MARGIN_TOP = 2;
const BOX_MARGIN_BOTTOM = 75;
const SINGLE_Y = 37;
const ALL_Y = 57;
const RADIO_X = 20;
const LABEL_X = 45;
const LABEL_REGION_END_X = 45 + 120;
const LABEL_REGION_HEIGHT = 12;
const LOAD_X = 155;
const LOAD_Y = 45;
const LOAD_CHECK_Y = 43;
const LOAD_LABEL_X = 180;
const LOAD_REGION_END_X = 180 + 85;
const LOAD_REGION_HEIGHT = 15;
const RADIO_OFFSET_Y = -2;
const BUTTONS_Y = 78;
const OK_X = 65;
const CANCEL_X = 135;
const REGFEMALE = 3;

export type ExitDirection = 'north' | 'east' | 'south' | 'west' | 'exitGrid';

export interface ExitDialogArt {
  readonly box: MercTextBoxArt;
  readonly radio: string;
  readonly check: string;
  readonly buttons: string;
}

export interface ExitDialogFonts {
  readonly text: BitmapFont;
  readonly bold: BitmapFont;
}

export interface ExitDialogRequest {
  readonly direction: ExitDirection;
  readonly exitGrid: number | null;
  readonly options: ExitSectorOptions;
  readonly selected: SoldierView;
  readonly selectedIsEpc: boolean;
  readonly squadEpcs: readonly SoldierView[];
  readonly viewportBottom: number;
}

export interface ExitChoice {
  readonly who: 'squad' | 'merc';
  readonly load: boolean;
}

interface Hilite {
  single: boolean;
  all: boolean;
  load: boolean;
}

export class ExitDialog {
  readonly #services: UiServices;
  readonly #text: UiTextService;
  readonly #art: ExitDialogArt;
  #request: ExitDialogRequest | null = null;
  #menu: ExitMenu | null = null;
  #box: MercTextBox | null = null;
  #x = 0;
  #y = 0;
  #regions: MouseRegion[] = [];
  #single: MouseRegion | null = null;
  #all: MouseRegion | null = null;
  #load: MouseRegion | null = null;
  #buttons: Button[] = [];
  #loadCheck: Button | null = null;
  #singleRadio: Button | null = null;
  #allRadio: Button | null = null;
  readonly #hilite: Hilite = { single: false, all: false, load: false };
  #fonts: ExitDialogFonts | null = null;
  #done: ((choice: ExitChoice | null) => void) | null = null;

  constructor(services: UiServices, text: UiTextService, art: ExitDialogArt) {
    this.#services = services;
    this.#text = text;
    this.#art = art;
  }

  get open(): boolean {
    return this.#request !== null;
  }

  get menu(): Readonly<ExitMenu> | null {
    return this.#menu;
  }

  get request(): ExitDialogRequest | null {
    return this.#request;
  }

  #string(table: string, index: number): string {
    return this.#text.string(table, index) ?? '';
  }

  show(request: ExitDialogRequest, fonts: ExitDialogFonts, done: (choice: ExitChoice | null) => void): void {
    const menu = request.options.menu;
    if (!menu) return;
    this.close(false);
    this.#request = request;
    this.#menu = { ...menu };
    this.#fonts = fonts;
    this.#done = done;
    const box = new MercTextBox(
      this.#art.box,
      {
        text: this.#string(TACTICAL, EXIT_GUI_TITLE_STR),
        width: BOX_WIDTH,
        marginX: BOX_MARGIN_X,
        marginTop: BOX_MARGIN_TOP,
        marginBottom: BOX_MARGIN_BOTTOM,
      },
      fonts,
    );
    this.#box = box;
    const { width } = this.#services.geometry();
    this.#x = Math.trunc((width - box.width) / 2);
    this.#y = Math.trunc((request.viewportBottom - box.height) / 2);
    this.#createRegions();
    this.#createButtons(fonts.text);
    this.#update();
    this.#services.pauseGame?.(true);
  }

  #region(
    id: string,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    hilite: keyof Hilite | null,
    click: (() => void) | null,
    priority: number,
  ): MouseRegion {
    const region = this.#services.regions.define({
      x1,
      y1,
      x2,
      y2,
      priority,
      cursor: 0,
      owner: OWNER,
      id,
      ...(hilite
        ? {
            onMove: (_r: MouseRegion, reason: number) => {
              if (reason & MouseReason.MOVE) this.#hilite[hilite] = true;
              else if (reason & MouseReason.LOST_MOUSE) this.#hilite[hilite] = false;
            },
          }
        : {}),
      ...(click
        ? {
            onButton: (_r: MouseRegion, reason: number) => {
              if (reason & MouseReason.LBUTTON_UP) click();
            },
          }
        : {}),
    });
    region.allowDisabledTooltip = true;
    this.#regions.push(region);
    return region;
  }

  #createRegions(): void {
    const { width, height } = this.#services.geometry();
    const x = this.#x;
    const y = this.#y;
    this.#region('exitBack', 0, 0, width, height, null, null, Priority.HIGHEST - 1);
    this.#single = this.#region(
      'exitSingle',
      x + RADIO_X,
      y + SINGLE_Y,
      x + LABEL_REGION_END_X,
      y + SINGLE_Y + LABEL_REGION_HEIGHT,
      'single',
      () => this.singleMove(),
      Priority.HIGHEST,
    );
    this.#all = this.#region(
      'exitAll',
      x + RADIO_X,
      y + ALL_Y,
      x + LABEL_REGION_END_X,
      y + ALL_Y + LABEL_REGION_HEIGHT,
      'all',
      () => this.allMove(),
      Priority.HIGHEST,
    );
    this.#load = this.#region(
      'exitLoad',
      x + LOAD_X,
      y + LOAD_Y,
      x + LOAD_REGION_END_X,
      y + LOAD_Y + LOAD_REGION_HEIGHT,
      'load',
      () => this.toggleLoad(),
      Priority.HIGHEST,
    );
  }

  #createButtons(font: BitmapFont): void {
    const buttons = this.#services.buttons;
    const x = this.#x;
    const y = this.#y;
    const check = (id: string, bx: number, by: number, asset: string, click: () => void) => {
      const button = buttons.create({
        x: bx,
        y: by,
        kind: 'checkbox',
        image: checkBoxImage(asset),
        priority: Priority.HIGHEST,
        owner: OWNER,
        id,
        onClick: (_b, reason) => {
          if (reason & MouseReason.LBUTTON_UP) click();
        },
      });
      button.allowDisabledTooltip();
      this.#buttons.push(button);
      return button;
    };
    this.#loadCheck = check('exitLoadCheck', x + LOAD_X, y + LOAD_CHECK_Y, this.#art.check, () => this.toggleLoad());
    this.#singleRadio = check('exitSingleRadio', x + RADIO_X, y + SINGLE_Y + RADIO_OFFSET_Y, this.#art.radio, () => this.singleMove());
    this.#allRadio = check('exitAllRadio', x + RADIO_X, y + ALL_Y + RADIO_OFFSET_Y, this.#art.radio, () => this.allMove());
    const text = (label: string) => ({
      text: label,
      font,
      color: FontColor.MCOLOR_WHITE,
      shadow: DEFAULT_SHADOW,
      downColor: FontColor.MCOLOR_WHITE,
      downShadow: DEFAULT_SHADOW,
    });
    const make = (id: string, dx: number, label: string, click: () => void) => {
      const button = buttons.create({
        x: x + dx,
        y: y + BUTTONS_Y,
        kind: 'quick',
        image: buttonImage(this.#art.buttons, -1, 0, -1, 1, -1),
        priority: Priority.HIGHEST,
        owner: OWNER,
        id,
        text: text(label),
        onClick: (_b, reason) => {
          if (reason & MouseReason.LBUTTON_UP) click();
        },
      });
      this.#buttons.push(button);
    };
    make('exitOk', OK_X, this.#string(TACTICAL, OK_BUTTON_TEXT_STR), () => this.close(true));
    make('exitCancel', CANCEL_X, this.#string(TACTICAL, CANCEL_BUTTON_TEXT_STR), () => this.close(false));
  }

  toggleLoad(): void {
    const menu = this.#menu;
    if (!menu || menu.gotoSectorDisabled) return;
    menu.gotoSector = !menu.gotoSector;
    this.#update();
  }

  singleMove(): void {
    const menu = this.#menu;
    if (!menu || menu.singleMoveDisabled) return;
    if (!menu.multipleSquads) {
      if (this.#request?.options.enemyInSector) {
        menu.gotoSectorDisabled = true;
        menu.gotoSector = false;
      } else menu.gotoSectorDisabled = false;
    } else menu.gotoSector = false;
    menu.singleMove = true;
    menu.allMove = false;
    this.#update();
  }

  allMove(): void {
    const menu = this.#menu;
    if (!menu || menu.allMoveDisabled) return;
    if (!menu.multipleSquads) {
      menu.gotoSectorDisabled = true;
      menu.gotoSector = true;
    }
    menu.singleMove = false;
    menu.allMove = true;
    this.#update();
  }

  #loadHelp(menu: ExitMenu): string {
    const request = this.#request as ExitDialogRequest;
    if (menu.gotoSectorDisabled) {
      if (!menu.loadOffered) return this.#string(HELP, ExitHelp.MUST_GOTO_MAPSCREEN);
      if (menu.multipleSquads && request.options.enemyInSector) return this.#string(HELP, ExitHelp.CANT_LEAVE_HOSTILE_SECTOR);
      return this.#string(HELP, ExitHelp.MUST_LOAD_ADJACENT_SECTOR);
    }
    return this.#string(HELP, menu.loadOffered ? ExitHelp.LOAD_ADJACENT_SECTOR : ExitHelp.GOTO_MAPSCREEN);
  }

  #singleHelp(menu: ExitMenu): string {
    const request = this.#request as ExitDialogRequest;
    const name = request.selected.name;
    if (!menu.singleMoveDisabled) return printf(this.#string(HELP, ExitHelp.SINGLE_TRAVERSAL_WILL_SEPARATE_SQUADS), [name]);
    if (request.selectedIsEpc) return printf(this.#string(HELP, ExitHelp.ESCORTED_CHARACTERS_MUST_BE_ESCORTED), [name]);
    const epc = request.squadEpcs[0];
    if (!epc) return '';
    const female = request.selected.bodyType === REGFEMALE;
    if (request.squadEpcs.length === 1) {
      const index = female ? ExitHelp.CANT_ISOLATE_EPC_FEMALE_SINGULAR : ExitHelp.CANT_ISOLATE_EPC_MALE_SINGULAR;
      return printf(this.#string(HELP, index), [name, epc.name]);
    }
    return printf(this.#string(HELP, female ? ExitHelp.CANT_ISOLATE_EPC_FEMALE_PLURAL : ExitHelp.CANT_ISOLATE_EPC_MALE_PLURAL), [name]);
  }

  #allHelp(menu: ExitMenu): string {
    if (!menu.allMoveDisabled) return this.#string(HELP, ExitHelp.ALL_TRAVERSAL_WILL_MOVE_CURRENT_SQUAD);
    if (this.#request?.options.uncontrolledRobot) return this.#string(LATE, STR_LATE_01);
    return this.#string(HELP, ExitHelp.ALL_MERCS_MUST_BE_TOGETHER);
  }

  #update(): void {
    const menu = this.#menu;
    if (!menu) return;
    const apply = (button: Button | null, region: MouseRegion | null, on: boolean, disabled: boolean, help: string) => {
      if (button) {
        button.setClicked(on);
        button.setEnabled(!disabled);
        button.setTooltip(help);
      }
      if (region) {
        if (disabled) region.disable();
        else region.enable();
        region.setTooltip(help);
      }
    };
    apply(this.#loadCheck, this.#load, menu.gotoSector, menu.gotoSectorDisabled, this.#loadHelp(menu));
    apply(this.#singleRadio, this.#single, menu.singleMove, menu.singleMoveDisabled, this.#singleHelp(menu));
    apply(this.#allRadio, this.#all, menu.allMove, menu.allMoveDisabled, this.#allHelp(menu));
  }

  close(ok: boolean): void {
    const request = this.#request;
    const menu = this.#menu;
    if (!request || !menu) return;
    for (const region of this.#regions) region.remove();
    for (const button of this.#buttons) button.remove();
    this.#regions = [];
    this.#buttons = [];
    this.#single = null;
    this.#all = null;
    this.#load = null;
    this.#loadCheck = null;
    this.#singleRadio = null;
    this.#allRadio = null;
    this.#request = null;
    this.#menu = null;
    this.#box = null;
    this.#hilite.single = false;
    this.#hilite.all = false;
    this.#hilite.load = false;
    this.#services.pauseGame?.(false);
    const done = this.#done;
    this.#done = null;
    if (!ok) {
      done?.(null);
      return;
    }
    const load = menu.gotoSector && menu.loadOffered;
    if (menu.allMove) done?.({ who: 'squad', load });
    else if (menu.singleMove) done?.({ who: 'merc', load });
    else done?.(null);
  }

  #colour(disabled: boolean, hilited: boolean): number {
    if (disabled) return FontColor.MCOLOR_DKGRAY;
    return hilited ? FontColor.MCOLOR_LTYELLOW : FontColor.MCOLOR_WHITE;
  }

  render(list: DrawList): void {
    const menu = this.#menu;
    const box = this.#box;
    const fonts = this.#fonts;
    if (!menu || !box || !fonts) return;
    const x = this.#x;
    const y = this.#y;
    box.render(list, x, y);
    const print = (px: number, py: number, text: string, colour: number) =>
      mprint(list, fonts.text, px, py, text, fontColors(colour, DEFAULT_SHADOW, FontColor.MCOLOR_BLACK));
    print(
      x + LABEL_X,
      y + SINGLE_Y,
      this.#string(TACTICAL, EXIT_GUI_SELECTED_MERC_STR),
      this.#colour(menu.singleMoveDisabled, this.#hilite.single),
    );
    print(
      x + LABEL_X,
      y + ALL_Y,
      this.#string(TACTICAL, EXIT_GUI_ALL_MERCS_IN_SQUAD_STR),
      this.#colour(menu.allMoveDisabled, this.#hilite.all),
    );
    const load = this.#string(TACTICAL, menu.loadOffered ? EXIT_GUI_GOTO_SECTOR_STR : EXIT_GUI_GOTO_MAP_STR);
    print(x + LOAD_LABEL_X, y + LOAD_Y, load, this.#colour(menu.gotoSectorDisabled, this.#hilite.load));
    for (const button of this.#buttons) this.#services.buttons.draw(list, button);
  }
}
