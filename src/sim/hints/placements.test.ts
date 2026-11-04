import { beforeAll, describe, expect, it } from 'vitest';
import { hintAnswer, newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { createItem, createItems } from '../items/object.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { InvSlot } from '../tactical/inventory.ts';
import { Team } from '../tactical/soldier.ts';
import { addItemToPool, Visibility } from '../tactical/world-items.ts';
import type { Placements } from './placements.ts';

const MERC_AT = gridNo(80, 80);
const PILE_AT = gridNo(81, 80);

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

function item(name: string): number {
  const def = content.items.byName.get(name);
  if (!def) throw new Error(`no item ${name}`);
  return def.index;
}

function squadByAPile() {
  const sim = newCombatSim(content);
  const picker = spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.EAST);
  const mate = spawnSoldier(sim, 1, Team.OUR, gridNo(80, 84), Direction.EAST, { gun: 'M14' });
  picker.inv[InvSlot.BIGPOCK1] = createItem(content.items, item('M14'), 100);
  for (const name of ['CLIP9_15', 'SILENCER', 'CAMOUFLAGEKIT'])
    addItemToPool(sim.state, PILE_AT, createItems(content.items, item(name), 100, 1), Visibility.VISIBLE, 0);
  return { sim, picker, mate };
}

function groundPlacements(sim: ReturnType<typeof squadByAPile>['sim'], ground: number): Placements {
  const answer = hintAnswer(sim, 'placements', { soldier: 0, gridNo: PILE_AT, ground });
  expect(answer.ok, answer.reason).toBe(true);
  return answer.data as Placements;
}

const highlighted = (p: Placements) => p.slots.filter((s) => s.highlight).map((s) => s.slot);

describe('the placements of a ground item in the pickup menu (ItemPickMenuMouseMoveCallback)', () => {
  it('outline his slots the item fits as ammo, gun or attachment and name the mercs with stuff for it', () => {
    const { sim, picker } = squadByAPile();
    const clip = groundPlacements(sim, 0);
    expect(clip.cursor).toEqual({ item: item('CLIP9_15'), count: 1 });
    expect(highlighted(clip)).toEqual([InvSlot.HAND]);
    expect(clip.compatibleMercs).toEqual([picker.id]);
    expect(clip.slots[InvSlot.SMALLPOCK1]).toMatchObject({ invalid: false, fits: true });
    const silencer = groundPlacements(sim, 1);
    expect(highlighted(silencer)).toEqual([InvSlot.HAND]);
    expect(silencer.compatibleMercs).toEqual([]);
    expect(groundPlacements(sim, 2)).toMatchObject({ applyOnMerc: true, compatibleMercs: [] });
  });

  it('refuses an index past the pickup list of the tile and a tile off the map', () => {
    const { sim } = squadByAPile();
    expect(hintAnswer(sim, 'placements', { soldier: 0, gridNo: PILE_AT, ground: 3 }).data).toMatchObject({ refusal: 'badGround' });
    expect(hintAnswer(sim, 'placements', { soldier: 0, gridNo: MERC_AT, ground: 0 }).data).toMatchObject({ refusal: 'badGround' });
    expect(hintAnswer(sim, 'placements', { soldier: 0, gridNo: -1, ground: 0 }).data).toMatchObject({ refusal: 'badGridNo' });
  });
});
