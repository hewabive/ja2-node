import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type HintSources, withQueries } from '../../../../tests/support/hints.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { type TacticalUiKit, type TacticalUiTest, tacticalUiKit, tacticalUiTest } from '../../../../tests/support/tactical-ui.ts';
import { parseSectorString } from '../../../content/strategic/sector-ids.ts';
import { createCampaignSession } from '../../../server/campaign-factory.ts';
import { Session } from '../../../server/session.ts';
import { skipHelicopterDropOf } from '../../../sim/campaign/helicopter-drop-flow.ts';
import type { SectorExits } from '../../../sim/hints/sector-exits.ts';
import { sectorInfo } from '../../../sim/strategic/map/sectors.ts';
import { MouseButton } from '../../input/events.ts';

const SEED = 32;
const LANDING = 'A9';
const LAND = { type: 'compressTime', mode: 2 } as const;
const TICKS_TO_THE_LOAD = 1000;
const STEPS_NEARER_THE_EDGE = 3;
const OUR_TEAM = 0;

let kit: StubSectorKit;
let ui: TacticalUiKit;
let sources: HintSources;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await tacticalUiKit(kit);
  sources = { read: kit.read, exists: (p) => kit.worlds.exists(p), world: (p) => kit.worlds.world(p) };
});

afterAll(async () => {
  await kit.dispose();
});

interface Leaving {
  readonly f: TacticalUiTest;
  readonly session: Session;
  readonly walkers: readonly number[];
}

async function squadAtTheEastEdge(staying: boolean): Promise<Leaving> {
  const campaign = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), SEED, { mercs: 3, land: false });
  Object.assign(sectorInfo(campaign.campaign.state.map, parseSectorString(LANDING)), { numAdmins: 0, numTroops: 0, numElites: 0 });
  await campaign.prepare(LAND);
  expect(campaign.dispatch(LAND).ok).toBe(true);
  skipHelicopterDropOf(campaign.campaign);
  const session = withQueries(new Session('edge-walk-off', campaign), sources);
  const f = await tacticalUiTest(kit, ui, SEED, session);
  f.deliver();
  const stayer = staying ? f.client.view.soldiers.find((s) => s.team === OUR_TEAM && s.id !== f.screen.selected)?.id : undefined;
  if (stayer !== undefined) expect(session.dispatch({ type: 'assignSquad', soldier: stayer, squad: 'new' }).ok).toBe(true);
  session.advance({ idle: true });
  const exits = (await session.query({ type: 'sectorExits' })).data as SectorExits;
  const walkTo = Object.entries(exits.edges.find((e) => e.edge === 'east')?.walkTo ?? {});
  walkTo.forEach(([soldier, to], k) => {
    const nearer = k === 0 ? STEPS_NEARER_THE_EDGE : 0;
    expect(session.dispatch({ type: 'move', soldier: Number(soldier), to: to + nearer, mode: 'run' }).ok).toBe(true);
  });
  session.advance({ idle: true });
  f.deliver();
  return { f, session, walkers: walkTo.map(([soldier]) => Number(soldier)) };
}

function slotted(f: TacticalUiTest): number[] {
  return f.screen.teamSlots.filter((id): id is number => id !== null).toSorted((a, b) => a - b);
}

function offTheMap(f: TacticalUiTest): number[] {
  return f.client.view.soldiers.filter((s) => s.team === OUR_TEAM && s.offMap === true).map((s) => s.id);
}

async function leaveEast(l: Leaving, load: boolean): Promise<void> {
  const exit = { type: 'exitSector', soldier: l.f.screen.selected, direction: 'east', who: 'squad', load } as const;
  expect((await l.session.prepareAndDispatch(exit)).ok).toBe(true);
}

function untilTheMapChanges(l: Leaving, each: () => void): void {
  const mapPath = l.f.client.view.mapPath;
  for (let k = 0; k < TICKS_TO_THE_LOAD && l.f.client.view.mapPath === mapPath; k++) {
    l.f.advance(1);
    if (l.f.client.view.mapPath === mapPath) each();
  }
}

describe('the tactical panels while the squad walks off the sector edge (StrategicMap.cc JumpIntoAdjacentSector)', () => {
  it('keep the leaving mercs in the team slots, off the map, until the next sector loads (Soldier_Control.cc:1920-1923)', async () => {
    const l = await squadAtTheEastEdge(false);
    expect(slotted(l.f)).toEqual(l.walkers.toSorted((a, b) => a - b));
    await leaveEast(l, true);
    const seenOff = new Set<number>();
    untilTheMapChanges(l, () => {
      for (const id of offTheMap(l.f)) seenOff.add(id);
      expect(slotted(l.f)).toEqual(l.walkers.toSorted((a, b) => a - b));
    });
    expect([...seenOff].toSorted((a, b) => a - b)).toEqual(l.walkers.toSorted((a, b) => a - b));
  });

  it("keep drawing the single merc panel's merc while he walks off", async () => {
    const l = await squadAtTheEastEdge(false);
    const merc = l.walkers[0] ?? -1;
    await l.f.click(`teamFaceRegion${l.f.screen.teamSlots.indexOf(merc)}`, MouseButton.RIGHT);
    await l.f.settle();
    const name = l.f.widget('smName').text;
    expect([l.f.screen.panel, l.f.screen.smMerc, name === '']).toEqual(['sm', merc, false]);
    await leaveEast(l, true);
    let walkedOff = false;
    untilTheMapChanges(l, () => {
      walkedOff ||= offTheMap(l.f).includes(merc);
      expect([l.f.screen.panel, l.f.screen.smMerc, l.f.widget('smName').text]).toEqual(['sm', merc, name]);
    });
    expect(walkedOff).toBe(true);
  });

  it('drop the leaving squad from the team slots together once its last merc is off, while a merc of another squad stays (JUMP_ALL_NO_LOAD, StrategicMap.cc:1783-1789)', async () => {
    const l = await squadAtTheEastEdge(true);
    await leaveEast(l, false);
    const shown: string[] = [];
    for (let k = 0; k < TICKS_TO_THE_LOAD; k++) {
      l.f.advance(1);
      const left = l.walkers.filter((id) => slotted(l.f).includes(id));
      const line = `${left.join(',')}|${offTheMap(l.f).join(',')}`;
      if (shown.at(-1) !== line) shown.push(line);
      if (left.length === 0) break;
    }
    const all = l.walkers.join(',');
    const [first, second] = l.walkers;
    expect(shown).toEqual([
      `${all}|`,
      `${all}|${first}`,
      `${all}|${[first, second].toSorted((a, b) => (a ?? 0) - (b ?? 0)).join(',')}`,
      '|',
    ]);
  });
});
