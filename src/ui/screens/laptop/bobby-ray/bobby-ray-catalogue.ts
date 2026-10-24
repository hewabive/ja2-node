// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/BobbyRGuns.cc ubCatalogueButtonValues, EnterBobbyRGuns, ExitBobbyRGuns, DisplayBobbyRBrTitle,
// @src InitBobbyMenuBar, BtnBobbyRPageMenuCallback, NextPage, PrevPage, DisplayItemInfo (the four rows from the page's first
// @src entry, the classes each row shows, the out-of-stock box, the subtotal, the used disclaimer), DisplayGunInfo,
// @src DisplayNonGunWeaponInfo, DisplayAmmoInfo, DisplayArmourInfo, DisplayMiscInfo, DisplayBigItemImage (centred across
// @src the 118 pixel cell minus the frame offset, eight pixels down, the shadow two pixels left and down),
// @src DisplayCostAndQty, DisplayRof, DisplayDamage, DisplayRange, DisplayMagazine, DisplayCaliber, DisplayItemNameAndInfo,
// @src SetFirstLastPagesForNew, SetFirstLastPagesForUsed, CalcFirstIndexForPage, CreateMouseRegionForBigImage (the ammo help
// @src text), SelectBigImageRegionCallBack, PurchaseBobbyRayItem, UnPurchaseBobbyRayItem, UpdateButtonText,
// @src CalcBobbyRayCost, CalculateTotalPurchasePrice, DisableBobbyRButtons, CheckPlayersInventoryForGunMatchingGivenAmmoID;
// @src BobbyRAmmo.cc, BobbyRArmour.cc, BobbyRMisc.cc, BobbyRUsed.cc (the five skins). See docs/28 §9.6.

import { ItemClass } from '../../../../content/items/items.ts';
import { idiv } from '../../../../core/int.ts';
import type { CatalogueItem } from '../../../../protocol/items.ts';
import type { BobbyRayCatalogue, BobbyRayStockView } from '../../../../protocol/view.ts';
import { frameOf } from '../../../assets.ts';
import type { Area, DrawList } from '../../../draw-list.ts';
import type { Variables } from '../../../layout/constants.ts';
import { type ControllerContract, ViewModelController } from '../../../layout/controller.ts';
import type { LayoutView } from '../../../layout/view.ts';
import { fontHeight } from '../../../text/bitmap-font.ts';
import { FontName } from '../../../text/fonts.ts';
import { sprintMoney } from '../../../text/money.ts';
import { printf } from '../../../text/printf.ts';
import { weightBasedOnMetricOption, weightUnit } from '../../../text/weight.ts';
import { reduceStringLength } from '../../../text/wrap.ts';
import type { ItemGraphic } from '../../../widgets/item-picture.ts';
import { MessageBoxFlag } from '../../../widgets/message-box.ts';
import { LaptopMode } from '../laptop-modes.ts';
import type { LaptopContext, LaptopPage } from '../laptop-page.ts';
import type { BobbyRayCart, CartStock } from './bobby-ray-session.ts';

export const BOBBY_RAY_CATALOGUE_LAYOUT = 'bobby-ray-catalogue';
export const BOBBY_RAY_CATALOGUE_PAGES: readonly number[] = [
  LaptopMode.BOBBY_R_GUNS,
  LaptopMode.BOBBY_R_AMMO,
  LaptopMode.BOBBY_R_ARMOR,
  LaptopMode.BOBBY_R_MISC,
  LaptopMode.BOBBY_R_USED,
];
const SKINS: Readonly<Record<number, BobbyRayCatalogue>> = {
  [LaptopMode.BOBBY_R_GUNS]: 'guns',
  [LaptopMode.BOBBY_R_AMMO]: 'ammo',
  [LaptopMode.BOBBY_R_ARMOR]: 'armour',
  [LaptopMode.BOBBY_R_MISC]: 'misc',
  [LaptopMode.BOBBY_R_USED]: 'used',
};
const ITEMS_ON_PAGE = 4;
const SPEC_LINES = 5;
const COST_LINES = 6;
const LINE_GAP = 2;
const WEIGHT_UNITS_PER_KG = 10;
const NAME_WIDTH_INSET = 6;
const PICTURE_DY = 8;
const SHADOW_DX = -2;
const SHADOW_DY = 2;
const BOBBY_RAY_TEXT = 'BobbyRText';
const MESSAGE_STRINGS = 'pMessageStrings';
const MSG_MINUTE_ABBREVIATION = 13;
const MSG_METER_ABBREVIATION = 14;
const MSG_ROUNDS_ABBREVIATION = 15;
const AMMO_HELP = 'str_bobbyr_guns_num_guns_that_use_ammo';
const GUN_CLASSES = ItemClass.GUN | ItemClass.LAUNCHER;
const MELEE_CLASSES = ItemClass.BLADE | ItemClass.THROWING_KNIFE | ItemClass.PUNCH;
const MISC_CLASSES = ItemClass.GRENADE | ItemClass.BOMB | ItemClass.MISC | ItemClass.MEDKIT | ItemClass.KIT | ItemClass.FACE;
const SHOWN_CLASSES = GUN_CLASSES | ItemClass.AMMO | ItemClass.ARMOUR | MELEE_CLASSES | MISC_CLASSES;
const CLASS_BITS = ItemClass as Readonly<Record<string, number>>;

const Text = {
  CALIBRE: 'BOBBYR_GUNS_CALIBRE',
  MAGAZINE: 'BOBBYR_GUNS_MAGAZINE',
  RANGE: 'BOBBYR_GUNS_RANGE',
  DAMAGE: 'BOBBYR_GUNS_DAMAGE',
  ROF: 'BOBBYR_GUNS_ROF',
  QTY_ON_ORDER: 'BOBBYR_GUNS_QTY_ON_ORDER',
  SUB_TOTAL: 'BOBBYR_GUNS_SUB_TOTAL',
  MORE_THEN_10_PURCHASES: 'BOBBYR_MORE_THEN_10_PURCHASES',
  MORE_NO_MORE_IN_STOCK: 'BOBBYR_MORE_NO_MORE_IN_STOCK',
  NO_MORE_STOCK: 'BOBBYR_NO_MORE_STOCK',
} as const;

export const BOBBY_RAY_CATALOGUE_CONTRACT: ControllerContract = {
  id: 'bobbyRayCatalogue',
  actions: {
    home: {},
    buy: { args: 1 },
    sell: { args: 1 },
    previous: {},
    next: {},
    catalogue: { args: 1 },
    orderForm: {},
  },
  bindings: {
    skin: 'string',
    rows: 'list',
    lineY: 'list',
    subtotal: 'string',
    used: 'boolean',
    previousEnabled: 'boolean',
    nextEnabled: 'boolean',
    catalogueEnabled: 'list',
  },
};

interface SpecLine {
  readonly label: string;
  readonly value: string;
}

interface CatalogueRow {
  readonly present: boolean;
  readonly stock: BobbyRayStockView | null;
  readonly picture: ItemGraphic | null;
  readonly name: string;
  readonly description: string;
  readonly quality: string;
  readonly onOrder: string;
  readonly onOrderShown: boolean;
  readonly cost: string;
  readonly weight: string;
  readonly quantity: string;
  readonly specs: readonly SpecLine[];
  readonly tooltip: string;
}

const NO_SPEC: SpecLine = { label: '', value: '' };
const EMPTY_ROW: CatalogueRow = {
  present: false,
  stock: null,
  picture: null,
  name: '',
  description: '',
  quality: '',
  onOrder: '',
  onOrderShown: false,
  cost: '',
  weight: '',
  quantity: '',
  specs: Array.from({ length: SPEC_LINES }, () => NO_SPEC),
  tooltip: '',
};

export function padded(value: number, width: number): string {
  return String(value).padStart(width, ' ');
}

export function itemClassBits(item: CatalogueItem | undefined): number {
  return item ? (CLASS_BITS[item.class] ?? 0) : 0;
}

export function pageEntries(stock: readonly BobbyRayStockView[], skin: BobbyRayCatalogue, page: number, classOf: (item: number) => number) {
  const matching = stock.filter((s) => s.catalogue === skin);
  const first = matching[page * ITEMS_ON_PAGE];
  if (!first) return { matching, shown: [] as BobbyRayStockView[] };
  const from = matching.indexOf(first);
  const shown = matching
    .slice(from)
    .filter((s) => classOf(s.item) & SHOWN_CLASSES)
    .slice(0, ITEMS_ON_PAGE);
  return { matching, shown };
}

export function pageCount(matching: number): number {
  return Math.trunc(matching / ITEMS_ON_PAGE) + (matching % ITEMS_ON_PAGE !== 0 ? 1 : 0);
}

export function cartSubtotal(cart: BobbyRayCart, priceOf: (slot: number, used: boolean, item: number) => number): number {
  return cart.purchased.reduce((sum, l) => sum + priceOf(l.slot, l.used, l.item) * l.count, 0);
}

export function stockPrice(context: LaptopContext): (slot: number, used: boolean, item: number) => number {
  return (slot, used, item) => {
    const view = context.view()?.bobbyRay;
    const list = used ? view?.usedStock : view?.newStock;
    return list?.find((s) => s.slot === slot)?.price ?? context.data.item(item)?.catalogue?.price ?? 0;
  };
}

export function gunsUsingAmmo(context: LaptopContext, ammo: CatalogueItem): number {
  const calibre = ammo.magazine?.calibre.index;
  if (calibre === undefined) return 0;
  let count = 0;
  for (const merc of context.client.strategic()?.mercs ?? [])
    for (const slot of merc.inventory ?? []) {
      const item = context.data.item(slot.index)?.catalogue;
      if (item?.class === 'GUN' && item.weapon?.calibre?.index === calibre) count++;
    }
  return count;
}

export function bobbyRayCataloguePage(mode: number): (context: LaptopContext) => LaptopPage {
  return (context) => catalogue(context, mode);
}

function catalogue(context: LaptopContext, mode: number): LaptopPage {
  const skin = SKINS[mode] ?? 'guns';
  const used = skin === 'used';
  const cart = context.sites.bobbyRay;
  const fonts = context.services.fonts;
  const descFont = fonts.get(FontName.FONT10ARIAL);
  const model: Record<string, unknown> = { skin, used };
  const constant = (name: string) => context.constant(BOBBY_RAY_CATALOGUE_LAYOUT, name);
  const text = (index: string) => context.string(BOBBY_RAY_TEXT, constant(index));
  let page = 0;
  let emptyBoxShown = false;
  let shown: BobbyRayStockView[] = [];
  const stockList = (): readonly BobbyRayStockView[] => {
    const view = context.view()?.bobbyRay;
    return (used ? view?.usedStock : view?.newStock) ?? [];
  };
  const item = (index: number) => context.data.item(index)?.catalogue;
  const classOf = (index: number) => itemClassBits(item(index));
  const metric = context.settings.metric ?? true;

  const specs = (entry: CatalogueItem | undefined): SpecLine[] => {
    const bits = itemClassBits(entry);
    const lines: SpecLine[] = [];
    const calibre = () => ({
      label: text(Text.CALIBRE),
      value: reduceStringLength(
        (bits & ItemClass.AMMO ? entry?.magazine?.calibre.bobbyRayName : entry?.weapon?.calibre?.bobbyRayName) ?? '',
        constant('BOBBYR_GRID_PIC_WIDTH'),
        descFont,
      ),
    });
    const weapon = entry?.weapon;
    if (bits & GUN_CLASSES && weapon) {
      lines.push(calibre());
      lines.push({
        label: text(Text.MAGAZINE),
        value: `${padded(weapon.magSize, 3)} ${context.string(MESSAGE_STRINGS, MSG_ROUNDS_ABBREVIATION)}`,
      });
      lines.push({
        label: text(Text.RANGE),
        value: `${padded(weapon.range, 3)} ${context.string(MESSAGE_STRINGS, MSG_METER_ABBREVIATION)}`,
      });
      lines.push({ label: text(Text.DAMAGE), value: padded(weapon.impact, 4) });
      lines.push({
        label: text(Text.ROF),
        value: `${padded(weapon.rateOfFire, 3)}/${context.string(MESSAGE_STRINGS, MSG_MINUTE_ABBREVIATION)}`,
      });
    } else if (bits & ItemClass.AMMO) lines.push(calibre());
    else if (bits & MELEE_CLASSES && weapon) lines.push({ label: text(Text.DAMAGE), value: padded(weapon.impact, 4) });
    return [...lines, ...Array.from({ length: SPEC_LINES - lines.length }, () => NO_SPEC)];
  };

  const rowOf = (stock: BobbyRayStockView): CatalogueRow => {
    const entry = item(stock.item);
    const laptopItem = context.data.item(stock.item);
    const bought = cart.count(stock.slot, used);
    const weight = entry ? Math.fround(weightBasedOnMetricOption(entry.weight, metric) / WEIGHT_UNITS_PER_KG) : 0;
    const helpGuns = entry?.class === 'AMMO' ? gunsUsingAmmo(context, entry) : 0;
    return {
      present: true,
      stock,
      picture: laptopItem?.bigGraphic ?? null,
      name: reduceStringLength(entry?.bobbyRayName ?? stock.name, constant('BOBBYR_GRID_PIC_WIDTH') - NAME_WIDTH_INSET, descFont),
      description: entry?.bobbyRayDescription ?? '',
      quality: used ? `*${padded(stock.quality, 3)}%` : '',
      onOrder: bought === null ? '' : padded(bought, 4),
      onOrderShown: bought !== null,
      cost: sprintMoney(stock.price),
      weight: `${weight.toFixed(2).padStart(3, ' ')} ${weightUnit(context.text, metric)}`,
      quantity: padded(stock.quantity, 4),
      specs: specs(entry),
      tooltip: helpGuns > 0 ? printf(context.string(AMMO_HELP), [helpGuns]) : '',
    };
  };

  const refresh = () => {
    const list = stockList();
    const entries = pageEntries(list, skin, page, classOf);
    shown = entries.shown;
    const pages = pageCount(entries.matching.length);
    model.rows = Array.from({ length: ITEMS_ON_PAGE }, (_, i) => {
      const stock = shown[i];
      return stock ? rowOf(stock) : EMPTY_ROW;
    });
    const step = fontHeight(descFont) + LINE_GAP;
    const top = constant('BOBBYR_ITEM_DESC_START_Y');
    model.lineY = Array.from({ length: COST_LINES }, (_, k) => top + k * step);
    model.subtotal = `${text(Text.SUB_TOTAL)} ${sprintMoney(cartSubtotal(cart, stockPrice(context)))}`;
    model.previousEnabled = page !== 0;
    model.nextEnabled = pages !== 0 && page < pages - 1;
    model.catalogueEnabled = BOBBY_RAY_CATALOGUE_PAGES.map((m) => m !== mode);
    if (
      entries.matching.length === 0 &&
      !emptyBoxShown &&
      !context.shell.loading &&
      !context.shell.showBookmarks &&
      !context.shell.exiting
    ) {
      emptyBoxShown = true;
      context.messageBox(text(Text.NO_MORE_STOCK), MessageBoxFlag.OK);
    }
  };

  const buy = (row: number) => {
    const stock = shown[row];
    if (!stock) return;
    const cartStock: CartStock = { item: stock.item, slot: stock.slot, quantity: stock.quantity, quality: stock.quality };
    const refusal = cart.purchase(cartStock, used);
    if (refusal === 'tooManyLines') context.messageBox(text(Text.MORE_THEN_10_PURCHASES), MessageBoxFlag.OK);
    else if (refusal === 'noMoreInStock') context.messageBox(text(Text.MORE_NO_MORE_IN_STOCK), MessageBoxFlag.OK);
  };
  const sell = (row: number) => {
    const stock = shown[row];
    if (stock) cart.unpurchase(stock.slot, used);
  };
  const previous = () => {
    if (page > 0) page--;
  };
  const next = () => {
    const pages = pageCount(stockList().filter((s) => s.catalogue === skin).length);
    if (page < pages - 1) page++;
  };

  const controller = new ViewModelController(BOBBY_RAY_CATALOGUE_CONTRACT, model, {
    home: () => context.shell.setPage(LaptopMode.BOBBY_R),
    buy: ([i]) => buy(i ?? 0),
    sell: ([i]) => sell(i ?? 0),
    previous,
    next,
    catalogue: ([i]) => {
      const target = BOBBY_RAY_CATALOGUE_PAGES[i ?? 0];
      if (target !== undefined) context.shell.setPage(target);
    },
    orderForm: () => context.shell.setPage(LaptopMode.BOBBY_R_MAILORDER),
  });

  const drawBigItem = (
    list: DrawList,
    rect: Area,
    _params: Readonly<Record<string, unknown>>,
    _view: LayoutView,
    vars: Variables,
  ): void => {
    const row = (model.rows as CatalogueRow[] | undefined)?.[vars.i ?? 0];
    const picture = row?.picture;
    if (!picture) return;
    const frame = frameOf(context.services.images, picture.path, picture.frame);
    const x = rect.x + idiv(Math.abs(constant('BOBBYR_GRID_PIC_WIDTH') - frame.width), 2) - frame.offsetX;
    const y = rect.y + PICTURE_DY;
    list.image(picture.path, picture.frame, x + SHADOW_DX, y + SHADOW_DY, { effect: { kind: 'outlineShadow' } });
    list.image(picture.path, picture.frame, x, y);
  };

  const loadPictures = () => {
    const paths = stockList().flatMap((s) => {
      const graphic = context.data.item(s.item)?.bigGraphic;
      return graphic ? [graphic.path] : [];
    });
    void context.media.loadImages([...new Set(paths)]);
  };

  loadPictures();
  refresh();
  return {
    layouts: [{ name: BOBBY_RAY_CATALOGUE_LAYOUT, controller }],
    custom: { bigItem: drawBigItem },
    update: refresh,
    dispose: () => {
      context.memory.bobbyRay.lastPage = mode;
    },
  };
}
