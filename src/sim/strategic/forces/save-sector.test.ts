import { beforeAll, describe, expect, it } from 'vitest';
import { FakeMercs, loadStrategicTestContent, testContext } from '../../../../tests/support/strategic.ts';
import { parseSectorString } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import { Assignment, NO_CURRENT_SQUAD } from './constants.ts';
import type { StrategicContext } from './ports.ts';
import { bestPossibleSector } from './save-sector.ts';
import { addCharacterToSquad, initSquads, initVehicles } from './squads.ts';

let content: StrategicContent;

beforeAll(async () => {
  content = await loadStrategicTestContent();
});

const A9 = parseSectorString('A9');
const B9 = parseSectorString('B9');
const C9 = parseSectorString('C9');
const D9 = parseSectorString('D9');
const J9_BASEMENT = parseSectorString('J9', 1);
const SQUAD_2 = 1;

function setup(): { ctx: StrategicContext; mercs: FakeMercs } {
  const mercs = new FakeMercs();
  const ctx = testContext({ content, mercs });
  initSquads(ctx);
  initVehicles(ctx);
  return { ctx, mercs };
}

function onSquad(ctx: StrategicContext, mercs: FakeMercs, id: number, sector: typeof A9, squad: number): void {
  mercs.add({ id, sector });
  if (!addCharacterToSquad(ctx, id, squad)) throw new Error(`merc ${id} cannot join squad ${squad}`);
}

describe('the sector a save records (GetBestPossibleSectorXYZValues)', () => {
  it('records the loaded sector while a map is loaded, wherever the mercs are', () => {
    const { ctx, mercs } = setup();
    onSquad(ctx, mercs, 0, B9, 0);
    ctx.state.worldSector = { ...A9 };
    expect(bestPossibleSector(ctx)).toEqual(A9);
  });

  it("takes the sector of the current squad's first merc even while he travels between sectors", () => {
    const { ctx, mercs } = setup();
    onSquad(ctx, mercs, 0, B9, 0);
    onSquad(ctx, mercs, 1, C9, SQUAD_2);
    onSquad(ctx, mercs, 2, C9, SQUAD_2);
    const leader = mercs.get(1);
    if (!leader) throw new Error('no leader');
    leader.betweenSectors = true;
    ctx.state.forces.currentSquad = SQUAD_2;
    expect(bestPossibleSector(ctx)).toEqual(C9);
  });

  it('passes over a current squad led by a merc in transit, and over mercs in transit or between sectors, to the next merc in id order', () => {
    const { ctx, mercs } = setup();
    onSquad(ctx, mercs, 0, B9, 0);
    onSquad(ctx, mercs, 1, B9, 0);
    mercs.add({ id: 2, sector: D9 });
    mercs.add({ id: 3, sector: J9_BASEMENT });
    const [first, second] = [mercs.get(0), mercs.get(1)];
    if (!first || !second) throw new Error('no squad');
    first.assignment = Assignment.IN_TRANSIT;
    second.betweenSectors = true;
    expect(bestPossibleSector(ctx)).toEqual(D9);
    const third = mercs.get(2);
    if (third) third.assignment = Assignment.IN_TRANSIT;
    expect(bestPossibleSector(ctx)).toEqual(J9_BASEMENT);
  });

  it('skips the squad check for an empty current squad and without a current squad', () => {
    const { ctx, mercs } = setup();
    mercs.add({ id: 0, sector: B9 });
    onSquad(ctx, mercs, 1, C9, 0);
    expect(bestPossibleSector(ctx)).toEqual(C9);
    ctx.state.forces.currentSquad = SQUAD_2;
    expect(bestPossibleSector(ctx)).toEqual(B9);
    ctx.state.forces.currentSquad = NO_CURRENT_SQUAD;
    expect(bestPossibleSector(ctx)).toEqual(B9);
  });

  it('falls back to the first merc when all are in transit or between sectors, and to no sector without mercs', () => {
    const { ctx, mercs } = setup();
    expect(bestPossibleSector(ctx)).toBeNull();
    mercs.add({ id: 0, sector: A9, assignment: Assignment.IN_TRANSIT });
    mercs.add({ id: 1, sector: B9 });
    const moving = mercs.get(1);
    if (moving) moving.betweenSectors = true;
    expect(bestPossibleSector(ctx)).toEqual(A9);
  });
});
