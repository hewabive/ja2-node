import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { fakeHost } from '../../../tests/support/narrative.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { Fact } from '../strategic/narrative/fact-ids.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { Team } from '../tactical/soldier.ts';
import { STUFF_MISSING_DRASSEN, stuffMissingFromShipment } from './nearby-quotes.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const CRATE = gridNo(81, 80);
const MERC_PROFILE = 7;
const WISE = 90;

function shipmentScene(facts: Readonly<Record<number, boolean>>, mercAt = gridNo(80, 80), draws: readonly number[] = [0, 0]) {
  const sim = newCombatSim(content);
  const merc = spawnSoldier(sim, 0, Team.OUR, mercAt, Direction.EAST, { profile: MERC_PROFILE });
  merc.stats.wisdom = WISE;
  const host = fakeHost({ facts, draws });
  host.tactical = () => sim.state;
  return { host, merc };
}

const stolen = { [Fact.PABLOS_STOLE_FROM_LATEST_SHIPMENT]: true };
const quoted = (host: ReturnType<typeof fakeHost>) => host.talk.queue.flatMap((e) => (e.kind === 'quote' ? [[e.speaker, e.quote]] : []));

describe('the crate of a shipment Pablo stole from', () => {
  it('lets a merc beside it notice the missing stuff once, at the delivery point of the loaded sector only', () => {
    const { host } = shipmentScene(stolen);
    expect(stuffMissingFromShipment(host, CRATE, { gridNo: CRATE, loadedHere: true })).toBe(true);
    expect(host.facts.values.get(Fact.PLAYER_FOUND_ITEMS_MISSING)).toBe(true);
    expect(quoted(host)).toEqual([[MERC_PROFILE, STUFF_MISSING_DRASSEN]]);
    expect(stuffMissingFromShipment(host, CRATE, { gridNo: CRATE, loadedHere: true })).toBe(false);
    expect(stuffMissingFromShipment(shipmentScene(stolen).host, CRATE, { gridNo: CRATE, loadedHere: false })).toBe(false);
    expect(stuffMissingFromShipment(shipmentScene(stolen).host, CRATE, { gridNo: CRATE + 1, loadedHere: true })).toBe(false);
    expect(stuffMissingFromShipment(shipmentScene({}).host, CRATE, { gridNo: CRATE, loadedHere: true })).toBe(false);
  });

  it('still counts as the quote when nobody is close or wise enough to say it', () => {
    const far = shipmentScene(stolen, gridNo(70, 80));
    expect(stuffMissingFromShipment(far.host, CRATE, { gridNo: CRATE, loadedHere: true })).toBe(true);
    expect(far.host.facts.values.get(Fact.PLAYER_FOUND_ITEMS_MISSING)).toBeUndefined();
    const careless = shipmentScene(stolen, gridNo(80, 80), [WISE + 1]);
    expect(stuffMissingFromShipment(careless.host, CRATE, { gridNo: CRATE, loadedHere: true })).toBe(true);
    expect(quoted(careless.host)).toEqual([]);
  });
});
