import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { fakeHost } from '../../../tests/support/narrative.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { NO_PROFILE } from '../../content/narrative/npc-constants.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { Fact } from '../strategic/narrative/fact-ids.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { MercQuote } from '../tactical/narrative/merc-quotes.ts';
import { TEAM_FIRST_ID, Team } from '../tactical/soldier.ts';
import { deleteTalkingMenu } from './converse.ts';
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

const BARRY = 0;
const IVAN = 7;
const RED = 11;
const NPC = 94;
const NPC_ID = TEAM_FIRST_ID[Team.CIV];
const NPC_AT = gridNo(80, 80);
const MALE = 0;
const FEMALE = 1;

function sayLaterScene(npcSex: number, nice: boolean, mercs: readonly (readonly [number, number])[], draws: readonly number[] = []) {
  const sim = newCombatSim(content);
  spawnSoldier(sim, NPC_ID, Team.CIV, NPC_AT, Direction.WEST, { profile: NPC });
  for (const [id, [profile, at]] of mercs.entries()) spawnSoldier(sim, id, Team.OUR, at, Direction.EAST, { profile });
  const host = fakeHost({ facts: { [Fact.NEED_TO_SAY_SOMETHING]: true }, profiles: { [NPC]: { sex: npcSex } }, draws });
  host.tactical = () => sim.state;
  host.talk.inPanel = true;
  host.talk.charNum = NPC;
  host.context.dest = NPC_ID;
  if (nice) host.talk.niceNpc = NPC;
  else host.talk.nastyNpc = NPC;
  return host;
}

describe('the comment a conversation left to say (Interface_Dialogue.cc DeleteTalkingMenu)', () => {
  it('has a merc near a likable woman who speaks of women say so, picked with Random(n) among them', () => {
    const host = sayLaterScene(
      FEMALE,
      true,
      [
        [BARRY, gridNo(82, 80)],
        [IVAN, gridNo(83, 80)],
        [RED, gridNo(84, 80)],
      ],
      [1],
    );
    deleteTalkingMenu(host, 'player');
    expect(host.drawsTaken).toEqual([2]);
    expect(quoted(host)).toEqual([[RED, MercQuote.LISTEN_LIKABLE_PERSON]]);
    expect([host.facts.values.get(Fact.NEED_TO_SAY_SOMETHING), host.talk.niceNpc]).toEqual([false, NO_PROFILE]);
  });

  it('leaves out a merc who speaks only of women for a likable man', () => {
    const host = sayLaterScene(MALE, true, [
      [RED, gridNo(82, 80)],
      [BARRY, gridNo(83, 80)],
    ]);
    deleteTalkingMenu(host, 'player');
    expect([host.drawsTaken, quoted(host)]).toEqual([[1], [[BARRY, MercQuote.LISTEN_LIKABLE_PERSON]]]);
  });

  it('has a merc closer than 10 tiles to a nasty NPC say he is annoying, whatever the sex', () => {
    const host = sayLaterScene(FEMALE, false, [
      [BARRY, gridNo(90, 80)],
      [IVAN, gridNo(89, 80)],
    ]);
    deleteTalkingMenu(host, 'player');
    expect([host.drawsTaken, quoted(host)]).toEqual([[1], [[IVAN, MercQuote.ANNOYING_PC]]]);
    expect([host.facts.values.get(Fact.NEED_TO_SAY_SOMETHING), host.talk.nastyNpc]).toEqual([false, NO_PROFILE]);
  });

  it('draws nothing and still forgets the comment when nobody near can say it', () => {
    const host = sayLaterScene(FEMALE, true, [[BARRY, gridNo(82, 80)]]);
    deleteTalkingMenu(host, 'player');
    expect([host.drawsTaken, quoted(host)]).toEqual([[], []]);
    expect([host.facts.values.get(Fact.NEED_TO_SAY_SOMETHING), host.talk.niceNpc]).toEqual([false, NO_PROFILE]);
  });
});
