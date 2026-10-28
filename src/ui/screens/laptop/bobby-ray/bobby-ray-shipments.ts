// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/BobbyRShipments.cc EnterBobbyRShipments (the last active shipment selected), RenderBobbyRShipments,
// @src DisplayPreviousShipments (the first 13 entries, an active one shown while the selected one is displayable, white for
// @src the selected one), CreatePreviousShipmentsMouseRegions (one region per shipment in transit),
// @src SelectPreviousShipmentsRegionCallBack (the n-th active shipment), CountNumberValidShipmentForTheShipmentsPage,
// @src BtnBobbyRShipmentBackCallback, BtnBobbyRShipmentHomeCallback; src/game/Laptop/BobbyRMailOrder.cc DisplayPurchasedItems
// @src and DisplayShippingCosts for a shipment.

import type { BobbyRayShipmentView } from '../../../../protocol/view.ts';
import { type ControllerContract, ViewModelController } from '../../../layout/controller.ts';
import { fontHeight } from '../../../text/bitmap-font.ts';
import { FontName } from '../../../text/fonts.ts';
import { sprintMoney } from '../../../text/money.ts';
import { printf } from '../../../text/printf.ts';
import { weightUnit } from '../../../text/weight.ts';
import { LaptopMode } from '../laptop-modes.ts';
import type { LaptopContext, LaptopPage } from '../laptop-page.ts';
import { purchaseRows } from './bobby-ray-order.ts';

export const BOBBY_RAY_SHIPMENTS_LAYOUT = 'bobby-ray-shipments';
export const PREVIOUS_SHIPMENT_ROWS = 13;
const DAY_NAME = 'gpGameClockString';
const ORDER_FORM_TEXT = 'BobbyROrderFormText';
const NO_SHIPMENT = -1;

export const BOBBY_RAY_SHIPMENTS_CONTRACT: ControllerContract = {
  id: 'bobbyRayShipments',
  actions: { back: {}, home: {}, select: { args: 1 } },
  bindings: {
    shipmentRows: 'list',
    shipmentRegions: 'number',
    rowHeight: 'number',
    rows: 'list',
    totalsShown: 'boolean',
    subtotal: 'string',
    shipping: 'string',
    grandTotal: 'string',
    weightTitle: 'string',
  },
};

export function lastActiveShipment(shipments: readonly BobbyRayShipmentView[]): number {
  let last = NO_SHIPMENT;
  shipments.forEach((s, i) => {
    if (s.active) last = i;
  });
  return last;
}

export function bobbyRayShipmentsPage(context: LaptopContext): LaptopPage {
  const model: Record<string, unknown> = { rowHeight: fontHeight(context.services.fonts.get(FontName.FONT12ARIAL)) };
  const shipments = (): readonly BobbyRayShipmentView[] => context.view()?.bobbyRay.shipments ?? [];
  let selected = lastActiveShipment(shipments());

  const refresh = () => {
    const list = shipments();
    const chosen = list[selected];
    const displayable = chosen?.displayed === true;
    const rows = list
      .slice(0, PREVIOUS_SHIPMENT_ROWS)
      .flatMap((s, i) =>
        s.active && displayable
          ? [{ present: true, day: `${context.string(DAY_NAME)} ${s.orderDay}`, units: String(s.units), selected: i === selected }]
          : [],
      );
    model.shipmentRows = Array.from(
      { length: PREVIOUS_SHIPMENT_ROWS },
      (_, i) => rows[i] ?? { present: false, day: '', units: '', selected: false },
    );
    model.shipmentRegions = list.filter((s) => s.active).length;
    const showLines = chosen?.active === true && chosen.displayed;
    model.rows = purchaseRows(
      context,
      showLines ? chosen.lines.map((l) => ({ item: l.item, used: l.used, count: l.count, unitPrice: l.unitPrice })) : [],
      BOBBY_RAY_SHIPMENTS_LAYOUT,
    );
    model.totalsShown = showLines && chosen.subtotal !== 0;
    model.subtotal = sprintMoney(chosen?.subtotal ?? 0);
    model.shipping = sprintMoney(chosen?.shipping ?? 0);
    model.grandTotal = sprintMoney(chosen?.total ?? 0);
    const formIndex = context.constant(BOBBY_RAY_SHIPMENTS_LAYOUT, 'BOBBYR_WEIGHT');
    model.weightTitle = printf(context.string(ORDER_FORM_TEXT, formIndex), [weightUnit(context.text, context.settings.metric ?? true)]);
  };

  const controller = new ViewModelController(BOBBY_RAY_SHIPMENTS_CONTRACT, model, {
    back: () => context.shell.setPage(LaptopMode.BOBBY_R_MAILORDER),
    home: () => context.shell.setPage(LaptopMode.BOBBY_R),
    select: ([n]) => {
      const active = shipments()
        .map((s, i) => (s.active ? i : NO_SHIPMENT))
        .filter((i) => i !== NO_SHIPMENT);
      const index = n ?? 0;
      if (index < active.length) selected = active[index] ?? NO_SHIPMENT;
    },
  });

  refresh();
  return { layouts: [{ name: BOBBY_RAY_SHIPMENTS_LAYOUT, controller }], update: refresh };
}
