// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Florist.cc EnterFlorist (InitFloristOrderForm, the card and the gallery index reset,
// @src InitFloristOrderFormVariables), InitFloristDefaults, BtnGalleryButtonCallback, SelectFloristTitleHomeLinkRegionCallBack;
// @src src/game/Laptop/Florist_Gallery.cc DisplayFloralDescriptions, InitFlowerButtons, BtnFloralGalleryNextButtonCallback,
// @src BtnFloralGalleryBackButtonCallback, BtnGalleryFlowerButtonCallback (gfShowBookmarks cleared), EnterInitFloristGallery
// @src (the visited flags of each laptop session); src/game/Laptop/Florist_Order_Form.cc EnterFloristOrderForm (the order
// @src number drawn by the server: visitSite floristOrderForm), RenderFloristOrderForm (the label widths + 5),
// @src DisplayFlowerDynamicItems, InitFlowerOrderTextInputBoxes (a chosen card fills the sentiment once with
// @src CleanOutControlCodesFromString), BtnFlowerOrderSendButtonCallback (orderFlowers, InitFloristOrderForm, the home page),
// @src BtnFlowerOrderClearButtonCallback, BtnFlowerOrderBackButtonCallback, BtnFlowerOrderGalleryButtonCallback (the gallery
// @src from its first page), SelectFloristCardGalleryLinkRegionCallBack, SelectFloristGalleryLinkRegionCallBack,
// @src SelectFloristDropDownRegionCallBack, HandleFloristOrderKeyBoardInput (Esc never reaches the laptop from the form);
// @src src/game/Laptop/Florist_Cards.cc EnterFloristCards, RenderFloristCards,
// @src SelectFloristCardsRegionCallBack, BtnFlowerCardsBackButtonCallback.

import { type ControllerContract, ViewModelController } from '../../../layout/controller.ts';
import { fontHeight } from '../../../text/bitmap-font.ts';
import { FontName } from '../../../text/fonts.ts';
import { stringPixLength } from '../../../text/measure.ts';
import { cleanOutControlCodes, ianWrappedStringHeight } from '../../../text/wrap.ts';
import { LaptopMode } from '../laptop-modes.ts';
import type { LaptopContext, LaptopPage, PageLayout } from '../laptop-page.ts';
import type { LaptopShell } from '../laptop-shell.ts';
import { NO_CARD, resetFloristOrder } from '../pages-memory.ts';
import { DestinationList, destinationListGeometry } from './destination-list.ts';
import {
  cardTextY,
  dollarsText,
  FLOWERS_PER_PAGE,
  flowerOrderPrice,
  flowersOnPage,
  galleryNextEnabled,
  gallerySubPage,
  nextGalleryIndex,
  orderCheckFrames,
  orderExtras,
  previousGalleryIndex,
  SubPageVisits,
  toggleOrderCheck,
} from './florist-rules.ts';

export const FLORIST_CHROME_LAYOUT = 'florist-chrome';
export const FLORIST_HOME_LAYOUT = 'florist-home';
export const FLORIST_GALLERY_LAYOUT = 'florist-gallery';
export const FLORIST_ORDER_LAYOUT = 'florist-order';
export const FLORIST_CARDS_LAYOUT = 'florist-cards';

export const FLOWER_TEXT_FILE = 'binarydata/flowerdesc.edt';
export const CARD_TEXT_FILE = 'binarydata/flowercard.edt';
const FLOWER_TEXT_COLUMNS = 3;
const FLOWER_NAME_COLUMN = 0;
const FLOWER_DESCRIPTION_COLUMN = 2;
const CARDS = 9;
const CARD_COLUMNS = 3;
const CARD_TEXT_GAP = 2;
const ORDER_FORM_SITE = 'floristOrderForm';
const GALLERY_TEXT = 'sFloristGalleryText';
const GALLERY_PREV = 0;
const GALLERY_HOME = 4;
const ORDER_TEXT = 'sOrderFormText';
const ORDER_NAME_BOUQUET = 4;
const ORDER_PRICE = 5;
const ORDER_ORDER_NUMBER = 6;
const ORDER_PERSONAL_SENTIMENTS = 16;
const ORDER_SELECT_FROM_OURS = 18;
const ORDER_STANDARDIZED_CARDS = 19;
const MESSAGE_STRINGS = 'pMessageStrings';
const MSG_USDOLLAR_ABBREVIATION = 19;
const DESTINATION_NAMES = 'shipping-destinations';
const LABEL_GAP = 5;
const CARD_LINK_GAP = 2;

export const FLORIST_CHROME_CONTRACT: ControllerContract = {
  id: 'floristChrome',
  actions: { home: {} },
  bindings: { homePage: 'boolean' },
};
export const FLORIST_HOME_CONTRACT: ControllerContract = { id: 'floristHome', actions: { gallery: {} }, bindings: {} };
export const FLORIST_GALLERY_CONTRACT: ControllerContract = {
  id: 'floristGallery',
  actions: { flower: { args: 1 }, back: {}, next: {} },
  bindings: { rows: 'list', backText: 'string', nextEnabled: 'boolean' },
};
export const FLORIST_ORDER_CONTRACT: ControllerContract = {
  id: 'floristOrder',
  actions: {
    check: { args: 1 },
    openList: {},
    closeList: {},
    hoverDestination: { args: 2 },
    pickDestination: { args: 1 },
    cards: {},
    flowerGallery: {},
    back: {},
    send: {},
    clear: {},
    gallery: {},
    sentiment: { payload: 'string' },
    name: { payload: 'string' },
  },
  bindings: {
    flower: 'number',
    flowerName: 'string',
    flowerNameX: 'number',
    orderNumber: 'string',
    orderNumberX: 'number',
    price: 'string',
    priceX: 'number',
    cardLengthX: 'number',
    standardCardsX: 'number',
    cardLinkX: 'number',
    cardLinkWidth: 'number',
    cardLinkHeight: 'number',
    checks: 'list',
    destinationName: 'string',
    sentiment: 'string',
    name: 'string',
    listOpen: 'boolean',
    listHeight: 'number',
    listTopPieces: 'number',
    listSidePieces: 'number',
    listBottomEdgeY: 'number',
    listBottomCornerY: 'number',
    listRows: 'list',
    listRowStep: 'number',
    listRegionHeight: 'number',
  },
};
export const FLORIST_CARDS_CONTRACT: ControllerContract = {
  id: 'floristCards',
  actions: { card: { args: 1 }, back: {} },
  bindings: { cardTextY: 'list' },
};

const galleryVisits = new WeakMap<LaptopShell, SubPageVisits>();

function visitsOf(shell: LaptopShell): SubPageVisits {
  const known = galleryVisits.get(shell);
  if (known) return known;
  const fresh = new SubPageVisits();
  galleryVisits.set(shell, fresh);
  return fresh;
}

function floristChrome(context: LaptopContext, homePage: boolean): PageLayout {
  return {
    name: FLORIST_CHROME_LAYOUT,
    controller: new ViewModelController(FLORIST_CHROME_CONTRACT, { homePage }, { home: () => context.shell.setPage(LaptopMode.FLORIST) }),
  };
}

function flowerText(context: LaptopContext, flower: number, column: number): string {
  return context.text.edt(FLOWER_TEXT_FILE, flower * FLOWER_TEXT_COLUMNS + column) ?? '';
}

function bouquetPrice(context: LaptopContext, flower: number): number {
  return context.view()?.florist.bouquetPrices[flower] ?? 0;
}

function usDollar(context: LaptopContext): string {
  return context.string(MESSAGE_STRINGS, MSG_USDOLLAR_ABBREVIATION);
}

export function floristHomePage(context: LaptopContext): LaptopPage {
  const florist = context.memory.pages.florist;
  resetFloristOrder(florist.order);
  florist.card = NO_CARD;
  florist.galleryIndex = 0;
  const controller = new ViewModelController(
    FLORIST_HOME_CONTRACT,
    {},
    { gallery: () => context.shell.setPage(LaptopMode.FLORIST_FLOWER_GALLERY) },
  );
  return { layouts: [floristChrome(context, true), { name: FLORIST_HOME_LAYOUT, controller }], update: () => undefined };
}

export interface GalleryRow {
  readonly present: boolean;
  readonly flower: number;
  readonly name: string;
  readonly price: string;
  readonly description: string;
}

export function floristGalleryPage(context: LaptopContext): LaptopPage {
  const florist = context.memory.pages.florist;
  const visits = visitsOf(context.shell);
  const model: Record<string, unknown> = {};
  void context.media.loadTexts([FLOWER_TEXT_FILE]);
  const refresh = () => {
    const index = florist.galleryIndex;
    const shown = flowersOnPage(index);
    model.rows = Array.from({ length: FLOWERS_PER_PAGE }, (_, i): GalleryRow => {
      const flower = index + i;
      if (i >= shown) return { present: false, flower: 0, name: '', price: '', description: '' };
      return {
        present: true,
        flower,
        name: flowerText(context, flower, FLOWER_NAME_COLUMN),
        price: dollarsText(bouquetPrice(context, flower), usDollar(context)),
        description: flowerText(context, flower, FLOWER_DESCRIPTION_COLUMN),
      };
    });
    model.backText = context.string(GALLERY_TEXT, index === 0 ? GALLERY_HOME : GALLERY_PREV);
    model.nextEnabled = galleryNextEnabled(index);
  };
  const changeSubPage = (index: number) => {
    florist.galleryIndex = index;
    context.shell.connectToSubPage(visits.visit(gallerySubPage(index)));
  };
  const controller = new ViewModelController(FLORIST_GALLERY_CONTRACT, model, {
    next: () => changeSubPage(nextGalleryIndex(florist.galleryIndex)),
    back: () => {
      if (florist.galleryIndex === 0) context.shell.setPage(LaptopMode.FLORIST);
      else changeSubPage(previousGalleryIndex(florist.galleryIndex));
    },
    flower: ([i]) => {
      florist.flower = florist.galleryIndex + (i ?? 0);
      context.shell.showBookmarks = false;
      context.shell.setPage(LaptopMode.FLORIST_ORDERFORM);
    },
  });
  refresh();
  return { layouts: [floristChrome(context, false), { name: FLORIST_GALLERY_LAYOUT, controller }], update: refresh };
}

function destinationNames(context: LaptopContext): string[] {
  return (context.view()?.bobbyRay.destinations ?? []).map((d) => context.string(DESTINATION_NAMES, d.id));
}

export function floristOrderPage(context: LaptopContext): LaptopPage {
  const florist = context.memory.pages.florist;
  const order = florist.order;
  const constant = (name: string) => context.constant(FLORIST_ORDER_LAYOUT, name);
  const fonts = context.services.fonts;
  const smallFont = fonts.get(FontName.FONT12ARIAL);
  const label = (index: number) => stringPixLength(context.string(ORDER_TEXT, index), smallFont);
  void context.command({ type: 'visitSite', site: ORDER_FORM_SITE });
  void context.media.loadTexts([FLOWER_TEXT_FILE, CARD_TEXT_FILE]);
  if (florist.card !== NO_CARD) {
    order.sentiment = cleanOutControlCodes(context.text.edt(CARD_TEXT_FILE, florist.card) ?? '');
    florist.card = NO_CARD;
  }
  const list = new DestinationList(destinationNames(context), order.destination, (index) => {
    order.destination = index;
  });
  const geometry = destinationListGeometry(list.rows.length, fontHeight(smallFont), constant('FLOWER_ORDER_DROP_DOWN_LOCATION_WIDTH'));
  const listTop = constant('FLOWER_ORDER_DROP_DOWN_LOCATION_Y');
  const model: Record<string, unknown> = {
    flowerNameX: label(ORDER_NAME_BOUQUET) + LABEL_GAP + constant('FLOWER_ORDER_FLOWER_NAME_X'),
    orderNumberX: label(ORDER_ORDER_NUMBER) + LABEL_GAP + constant('FLOWER_ORDER_ORDER_NUM_NAME_X'),
    priceX: label(ORDER_PRICE) + LABEL_GAP + constant('FLOWER_ORDER_BOUQUET_NAME_X'),
    cardLengthX: constant('FLOWER_ORDER_PERSONAL_SENT_TEXT_X') + label(ORDER_PERSONAL_SENTIMENTS) + LABEL_GAP,
    standardCardsX: label(ORDER_SELECT_FROM_OURS) + LABEL_GAP + constant('FLOWER_ORDER_LINK_TO_CARD_GALLERY_X'),
    cardLinkX: label(ORDER_SELECT_FROM_OURS) + CARD_LINK_GAP + constant('FLOWER_ORDER_LINK_TO_CARD_GALLERY_X'),
    cardLinkWidth: label(ORDER_STANDARDIZED_CARDS),
    cardLinkHeight: fontHeight(smallFont),
    sentiment: order.sentiment,
    name: order.name,
    listHeight: geometry.height,
    listBottomEdgeY: geometry.height - 4,
    listBottomCornerY: listTop + geometry.height - 10,
    listRowStep: geometry.rowStep,
    listRegionHeight: geometry.regionHeight,
  };
  const refresh = () => {
    const destination = context.view()?.bobbyRay.destinations[order.destination];
    const price = flowerOrderPrice(
      order,
      bouquetPrice(context, florist.flower),
      destination?.flowers ?? { nextDay: 0, whenItGetsThere: 0 },
    );
    model.flower = florist.flower;
    model.flowerName = flowerText(context, florist.flower, FLOWER_NAME_COLUMN);
    model.orderNumber = String(context.view()?.florist.orderNumber ?? 0);
    model.price = dollarsText(price, usDollar(context));
    model.checks = orderCheckFrames(order);
    model.destinationName = list.rows[order.destination] ?? '';
    model.listOpen = list.open;
    model.listTopPieces = list.open ? geometry.topPieces : 0;
    model.listSidePieces = list.open ? geometry.sidePieces : 0;
    model.listRows = list.open ? list.rows.map((name, i) => ({ name, selected: i === order.destination })) : [];
  };
  const goHome = () => {
    resetFloristOrder(order);
    florist.card = NO_CARD;
    context.shell.setPage(LaptopMode.FLORIST);
  };
  const controller = new ViewModelController(FLORIST_ORDER_CONTRACT, model, {
    check: ([box]) => toggleOrderCheck(order, box ?? 0),
    openList: () => list.show(),
    closeList: () => list.hide(),
    hoverDestination: ([row, on]) => list.hover(row ?? 0, on === 1),
    pickDestination: ([row]) => list.pick(row ?? 0),
    cards: () => context.shell.setPage(LaptopMode.FLORIST_CARD_GALLERY),
    flowerGallery: () => context.shell.setPage(LaptopMode.FLORIST_FLOWER_GALLERY),
    back: () => context.shell.setPage(LaptopMode.FLORIST_FLOWER_GALLERY),
    send: () => {
      void context.command({
        type: 'orderFlowers',
        bouquet: florist.flower,
        destination: order.destination,
        nextDay: order.nextDay,
        extras: orderExtras(order),
      });
      goHome();
    },
    clear: goHome,
    gallery: () => {
      florist.galleryIndex = 0;
      context.shell.setPage(LaptopMode.FLORIST_FLOWER_GALLERY);
    },
    sentiment: (_args, text) => {
      order.sentiment = text ?? '';
    },
    name: (_args, text) => {
      order.name = text ?? '';
    },
  });
  refresh();
  return {
    layouts: [floristChrome(context, false), { name: FLORIST_ORDER_LAYOUT, controller }],
    update: refresh,
    escape: () => true,
  };
}

export function floristCardsPage(context: LaptopContext): LaptopPage {
  const florist = context.memory.pages.florist;
  const constant = (name: string) => context.constant(FLORIST_CARDS_LAYOUT, name);
  const fonts = context.services.fonts;
  const font = fonts.get(FontName.FONT12ARIAL);
  const bold = fonts.get(FontName.FONT10ARIALBOLD);
  florist.card = NO_CARD;
  void context.media.loadTexts([CARD_TEXT_FILE]);
  const model: Record<string, unknown> = {};
  const refresh = () => {
    model.cardTextY = Array.from({ length: CARDS }, (_, i) => {
      const cardY = constant('FLORIST_CARD_FIRST_POS_Y') + constant('FLORIST_CARD_FIRST_OFFSET_Y') * Math.trunc(i / CARD_COLUMNS);
      const text = context.text.edt(CARD_TEXT_FILE, i) ?? '';
      const height = ianWrappedStringHeight(constant('FLORIST_CARD_TEXT_WIDTH'), CARD_TEXT_GAP, font, text, bold);
      return cardTextY(cardY, height, constant('FLORIST_CARD_TEXT_HEIGHT')) - cardY;
    });
  };
  const controller = new ViewModelController(FLORIST_CARDS_CONTRACT, model, {
    card: ([i]) => {
      florist.card = i ?? 0;
      context.shell.setPage(LaptopMode.FLORIST_ORDERFORM);
    },
    back: () => context.shell.setPage(LaptopMode.FLORIST_ORDERFORM),
  });
  refresh();
  return { layouts: [floristChrome(context, false), { name: FLORIST_CARDS_LAYOUT, controller }], update: refresh };
}
