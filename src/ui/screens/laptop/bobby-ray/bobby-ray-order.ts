// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/BobbyRMailOrder.cc EnterBobbyRMailOrder (the accept button disabled without a city), ExitBobbyRMailOrder,
// @src HandleBobbyRMailOrder (the confirmation picture), RenderBobbyRMailOrder, BtnBobbyRClearOrderCallback,
// @src BtnBobbyRAcceptOrderCallback (the funds before the destination question, no question for Drassen while its airport is
// @src ours), DisplayPurchasedItems (quantity, weight, name with a star for used items, unit price, total),
// @src DisplayShippingCosts, BtnBobbyRBackCallback (guiLastBobbyRayPage), BtnBobbyRHomeCallback,
// @src SelectShippingSpeedRegionCallBack, DrawShippingSpeedLights, SelectConfirmOrderRegionCallBackPrimary/Secondary,
// @src CreateDestroyBobbyRDropDown (the clear button disabled while the list is open), DrawSelectedCity (the accept button
// @src enabled once something is bought and a city chosen), DisplayShippingLocationCity (the per-unit rates, kept while the
// @src list is open), PurchaseBobbyOrder, ConfirmBobbyRPurchaseMessageBoxCallBack, CalcPackageTotalWeight,
// @src DisplayPackageWeight, BtnBobbyRGotoShipmentPageCallback, CreateBobbyRayOrderTitle. See docs/28 §9.6.

import type { ShippingDestinationView } from '../../../../protocol/view.ts';
import { type ControllerContract, ViewModelController } from '../../../layout/controller.ts';
import { fontHeight } from '../../../text/bitmap-font.ts';
import { FontName } from '../../../text/fonts.ts';
import { sprintMoney } from '../../../text/money.ts';
import { printf } from '../../../text/printf.ts';
import { weightBasedOnMetricOption, weightUnit } from '../../../text/weight.ts';
import { reduceStringLength } from '../../../text/wrap.ts';
import { NO_SELECTION } from '../../../widgets/drop-down.ts';
import { MessageBoxFlag, MessageBoxReturn } from '../../../widgets/message-box.ts';
import { LaptopMode } from '../laptop-modes.ts';
import type { LaptopContext, LaptopPage } from '../laptop-page.ts';
import { cartSubtotal, padded, stockPrice } from './bobby-ray-catalogue.ts';
import { BOBBYR_ORDER_NUM_SHIPPING_CITIES, MAX_PURCHASE_AMOUNT } from './bobby-ray-session.ts';

export const BOBBY_RAY_ORDER_LAYOUT = 'bobby-ray-order';
export const SHIPPING_DESTINATIONS = 'shipping-destinations';
const ORDER_FORM_TEXT = 'BobbyROrderFormText';
const SPEEDS = 3;
const MIN_SHIPPING_WEIGHT = 20;
const WEIGHT_UNITS_PER_KG = 10;
const USED_PREFIX = '* ';
const NAME_INSET = 4;
const DISCLAIMER_GAP = 2;

export const BOBBY_RAY_ORDER_CONTRACT: ControllerContract = {
  id: 'bobbyRayOrder',
  actions: {
    home: {},
    clear: {},
    accept: {},
    back: {},
    shipments: {},
    speed: { args: 1 },
    toggleCities: {},
    city: { args: 1 },
    confirmed: {},
    confirmedStay: {},
  },
  bindings: {
    rows: 'list',
    totalsShown: 'boolean',
    subtotal: 'string',
    shipping: 'string',
    grandTotal: 'string',
    cityText: 'string',
    lights: 'list',
    rates: 'list',
    packageWeight: 'string',
    costTitle: 'string',
    weightTitle: 'string',
    minimumWeight: 'string',
    minimumWeightY: 'number',
    acceptEnabled: 'boolean',
    clearEnabled: 'boolean',
    confirmShown: 'boolean',
    cities: 'object',
    cityNames: 'list',
  },
};

export interface OrderRow {
  readonly present: boolean;
  readonly quantity: string;
  readonly weight: string;
  readonly name: string;
  readonly unitPrice: string;
  readonly total: string;
}

interface FormQuote {
  readonly subtotal: number;
  readonly shipping: number;
  readonly total: number;
  readonly affordable: boolean;
  readonly confirmDestination: boolean;
}

const EMPTY_ROW: OrderRow = { present: false, quantity: '', weight: '', name: '', unitPrice: '', total: '' };

export interface PurchaseLine {
  readonly item: number;
  readonly used: boolean;
  readonly count: number;
  readonly unitPrice: number;
}

export function purchaseRows(context: LaptopContext, lines: readonly PurchaseLine[], layout: string): OrderRow[] {
  const metric = context.settings.metric ?? true;
  const font = context.services.fonts.get(FontName.FONT12ARIAL);
  const nameWidth = context.constant(layout, 'BOBBYR_GRID_THIRD_COLUMN_WIDTH') - NAME_INSET;
  return Array.from({ length: MAX_PURCHASE_AMOUNT }, (_, i) => {
    const line = lines[i];
    if (!line) return EMPTY_ROW;
    const entry = context.data.item(line.item)?.catalogue;
    const weight = Math.fround(weightBasedOnMetricOption(entry?.weight ?? 0, metric) / WEIGHT_UNITS_PER_KG);
    const name = `${line.used ? USED_PREFIX : ''}${entry?.bobbyRayName ?? ''}`;
    return {
      present: true,
      quantity: padded(line.count, 3),
      weight: Math.fround(weight * line.count)
        .toFixed(1)
        .padStart(3, ' '),
      name: reduceStringLength(name, nameWidth, font),
      unitPrice: sprintMoney(line.unitPrice),
      total: sprintMoney(line.unitPrice * line.count),
    };
  });
}

export function perUnitRate(rate: number, metric: boolean): number {
  return Math.trunc(rate / weightBasedOnMetricOption(1, metric));
}

export function bobbyRayOrderPage(context: LaptopContext): LaptopPage {
  const cart = context.sites.bobbyRay;
  const cities = cart.cities;
  const model: Record<string, unknown> = { cities };
  const metric = context.settings.metric ?? true;
  const disclaimerFont = context.services.fonts.get(FontName.FONT10ARIAL);
  const formText = (name: string) => context.string(ORDER_FORM_TEXT, context.constant(BOBBY_RAY_ORDER_LAYOUT, name));
  const cityNames = Array.from({ length: BOBBYR_ORDER_NUM_SHIPPING_CITIES }, (_, i) => context.string(SHIPPING_DESTINATIONS, i));
  let quote: FormQuote | null = null;
  let quoteKey = '';
  let confirmShown = false;
  let busy = false;
  let disposed = false;
  let frozenRates: string[] | null = null;
  model.cityNames = cityNames;
  cities.close();

  const destinations = (): readonly ShippingDestinationView[] => context.view()?.bobbyRay.destinations ?? [];
  const destination = (): number | null => (cities.selected === NO_SELECTION ? null : cities.selected);
  const itemWeight = (item: number) => context.data.item(item)?.catalogue?.weight ?? 0;
  const packageWeight = () => cart.purchased.reduce((sum, l) => sum + itemWeight(l.item) * l.count, 0);
  const kilos = (weight: number) => Math.fround(weightBasedOnMetricOption(weight, metric) / WEIGHT_UNITS_PER_KG);
  const price = stockPrice(context);

  const request = () => ({ type: 'bobbyRayQuote', lines: cart.orderLines(), destination: destination() ?? -1, speed: cart.speed });

  const refreshQuote = () => {
    if (cart.empty) {
      quote = null;
      quoteKey = '';
      return;
    }
    const cmd = request();
    const key = JSON.stringify(cmd);
    if (key === quoteKey) return;
    quoteKey = key;
    void context.command(cmd).then((reply) => {
      if (disposed || key !== quoteKey || !reply.ok) return;
      quote = reply.data as FormQuote;
    });
  };

  const rows = (): OrderRow[] =>
    purchaseRows(
      context,
      cart.purchased.map((l) => ({ item: l.item, used: l.used, count: l.count, unitPrice: price(l.slot, l.used, l.item) })),
      BOBBY_RAY_ORDER_LAYOUT,
    );

  const rates = (): string[] => {
    const selected = destinations()[destination() ?? -1];
    return Array.from({ length: SPEEDS }, (_, speed) => (selected ? sprintMoney(perUnitRate(selected.rates[speed] ?? 0, metric)) : '$0'));
  };

  const refresh = () => {
    refreshQuote();
    const subtotal = cartSubtotal(cart, price);
    const shipping = quote && subtotal !== 0 ? quote.shipping : 0;
    model.rows = rows();
    model.totalsShown = subtotal !== 0;
    model.subtotal = sprintMoney(subtotal);
    model.shipping = sprintMoney(shipping);
    model.grandTotal = sprintMoney(subtotal + shipping);
    model.cityText = destination() === null ? formText('BOBBYR_SELECT_DEST') : (cityNames[destination() ?? 0] ?? '');
    model.lights = Array.from({ length: SPEEDS }, (_, i) => ({ on: cart.speed === i, off: cart.speed !== i }));
    if (cities.open) frozenRates ??= rates();
    else frozenRates = null;
    model.rates = frozenRates ?? rates();
    const unit = weightUnit(context.text, metric);
    model.packageWeight = `${kilos(packageWeight()).toFixed(1).padStart(3, ' ')} ${unit}`;
    model.costTitle = printf(formText('BOBBYR_COST'), [unit]);
    model.weightTitle = printf(formText('BOBBYR_WEIGHT'), [unit]);
    model.minimumWeight = `${formText('BOBBYR_MINIMUM_WEIGHT')} ${kilos(MIN_SHIPPING_WEIGHT).toFixed(1)} ${unit}.`;
    model.minimumWeightY =
      context.constant(BOBBY_RAY_ORDER_LAYOUT, 'BOBBYR_USED_WARNING_Y') + fontHeight(disclaimerFont) + DISCLAIMER_GAP + 1;
    model.acceptEnabled = destination() !== null && !cart.empty;
    model.clearEnabled = !cities.open;
    model.confirmShown = confirmShown;
  };

  const purchase = (): void => {
    const dest = destination();
    if (dest === null) return;
    busy = true;
    void context.command({ type: 'bobbyRayOrder', lines: cart.orderLines(), destination: dest, speed: cart.speed }).then((reply) => {
      busy = false;
      if (disposed) return;
      if (!reply.ok) {
        if (reply.reason === 'funds') context.messageBox(formText('BOBBYR_CANT_AFFORD_PURCHASE'), MessageBoxFlag.OK);
        return;
      }
      confirmShown = true;
      cities.close();
      cities.selected = NO_SELECTION;
    });
  };

  const accept = (): void => {
    if (busy || confirmShown || cart.empty || destination() === null) return;
    busy = true;
    void context.command(request()).then((reply) => {
      busy = false;
      if (disposed || !reply.ok) return;
      const answer = reply.data as FormQuote;
      if (!answer.affordable) {
        context.messageBox(formText('BOBBYR_CANT_AFFORD_PURCHASE'), MessageBoxFlag.OK);
        return;
      }
      if (!answer.confirmDestination) {
        purchase();
        return;
      }
      const name = cityNames[destination() ?? 0] ?? '';
      context.messageBox(printf(formText('BOBBYR_CONFIRM_DEST'), [name]), MessageBoxFlag.YESNO, (result) => {
        if (result === MessageBoxReturn.YES) purchase();
      });
    });
  };

  const finishConfirmation = (home: boolean) => {
    if (!confirmShown) return;
    confirmShown = false;
    cart.removeOrdered();
    if (home) context.shell.setPage(LaptopMode.BOBBY_R);
  };

  const controller = new ViewModelController(BOBBY_RAY_ORDER_CONTRACT, model, {
    home: () => context.shell.setPage(LaptopMode.BOBBY_R),
    clear: () => {
      cart.clear();
      quote = null;
    },
    accept,
    back: () => context.shell.setPage(context.memory.bobbyRay.lastPage),
    shipments: () => context.shell.setPage(LaptopMode.BOBBYR_SHIPMENTS),
    speed: ([i]) => {
      cart.speed = i ?? 0;
    },
    toggleCities: () => cities.toggle(),
    city: () => undefined,
    confirmed: () => finishConfirmation(true),
    confirmedStay: () => finishConfirmation(false),
  });

  refresh();
  return {
    layouts: [{ name: BOBBY_RAY_ORDER_LAYOUT, controller }],
    update: refresh,
    dispose: () => {
      disposed = true;
      cities.close();
      if (confirmShown) cart.removeOrdered();
    },
  };
}
