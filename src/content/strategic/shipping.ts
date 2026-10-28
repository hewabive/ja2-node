// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/externalized/ShippingDestinationModel.cc (shipping-destinations.json), ContentManager getPrimaryShippingDestination.

import { FormatError } from '../binary/errors.ts';
import { asArray, asBool, asObject, asString } from './json-fields.ts';
import { parseSectorId } from './sector-ids.ts';

export const SHIPPING_DESTINATIONS_PATH = 'externalized/shipping-destinations.json';

export interface ShippingDestinations {
  readonly primaryDeliverySector: number;
}

export function parseShippingDestinations(json: unknown): ShippingDestinations {
  const primary = asArray(json, 'shipping destinations')
    .map((d, i) => asObject(d, `shipping destinations[${i}]`))
    .find((d) => d.isPrimary !== undefined && asBool(d.isPrimary, 'isPrimary'));
  if (!primary) throw new FormatError('shipping destinations have no primary destination');
  return { primaryDeliverySector: parseSectorId(asString(primary.deliverySector, 'deliverySector')) };
}
