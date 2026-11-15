import { beforeAll, describe, expect, it } from 'vitest';
import { hintAnswer, knowledgeOf, newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Orientation } from '../../content/formats/jsd.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import { syntheticStructure } from '../../content/world/synthetic.ts';
import { createItem } from '../items/object.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { coverAroundGridNo } from '../tactical/display-cover.ts';
import { InvSlot } from '../tactical/inventory.ts';
import { lightSetBaseLevel, NORMAL_LIGHTLEVEL_NIGHT } from '../tactical/lighting/lighting.ts';
import { Opp } from '../tactical/perception/opp.ts';
import { distanceVisible } from '../tactical/perception/sight.ts';
import { SkillTrait, type Soldier, Team, Visible } from '../tactical/soldier.ts';
import type { TacticalSim } from '../tactical/tactical-sim.ts';
import { answerHint } from './answer.ts';
import type { CoverMap, SightMap } from './cover-map.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const MERC_AT = gridNo(80, 80);
const ROOF_LEVEL = 1;
const DIRECTION_IRRELEVANT = -1;

function seenBy(sim: TacticalSim, merc: Soldier, enemy: Soldier): void {
  enemy.visible = Visible.SEEN;
  merc.oppList[enemy.id] = Opp.SEEN_CURRENTLY;
  const table = sim.state.perception.publicOpp[Team.OUR];
  if (table) table[enemy.id] = Opp.SEEN_CURRENTLY;
}

function coverOf(sim: TacticalSim, request: Readonly<Record<string, unknown>>): CoverMap {
  const answer = hintAnswer(sim, 'coverMap', request);
  expect(answer.ok, answer.reason).toBe(true);
  return answer.data as CoverMap;
}

function sightOf(sim: TacticalSim, request: Readonly<Record<string, unknown>>, revealed: boolean): SightMap {
  const answer = answerHint(knowledgeOf(sim, revealed ? {} : { revealedTiles: [] }), { type: 'sightMap', ...request });
  expect(answer.ok, answer.reason).toBe(true);
  return answer.data as SightMap;
}

describe('the cover and sight displays as hints', () => {
  it('refuse a center off the visible map, a radius beyond 15 and a level other than 0 or 1', () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.SOUTH);
    for (const type of ['coverMap', 'sightMap']) {
      expect(hintAnswer(sim, type, { soldier: 0, center: 0 })).toMatchObject({ ok: false, data: { refusal: 'badCenter' } });
      expect(hintAnswer(sim, type, { soldier: 0, center: MERC_AT, radius: 16 })).toMatchObject({
        ok: false,
        data: { refusal: 'badRadius' },
      });
      expect(hintAnswer(sim, type, { soldier: 0, center: MERC_AT, level: 2 })).toMatchObject({ ok: false, data: { refusal: 'badLevel' } });
      expect(hintAnswer(sim, type, { soldier: 20, center: MERC_AT })).toMatchObject({ ok: false, data: { refusal: 'noSuchSoldier' } });
    }
  });

  it("work out the square of the options' default size 4 around the tile, for the merc's stance", () => {
    const sim = newCombatSim(content);
    spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.SOUTH);
    const cover = coverOf(sim, { soldier: 0, center: MERC_AT });
    expect(cover).toMatchObject({ center: MERC_AT, level: 0, radius: 4, stance: 'stand' });
    expect(cover.tiles).toHaveLength(81);
    expect(sightOf(sim, { soldier: 0, center: MERC_AT }, true).tiles).toHaveLength(81);
  });

  it('agree with the cover worked out on the whole state for a seen enemy whose hidden fields are those of the stand-ins', () => {
    const sim = newCombatSim(content);
    const merc = spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.SOUTH);
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 72), Direction.SOUTH);
    seenBy(sim, merc, enemy);
    const hint = coverOf(sim, { soldier: 0, center: gridNo(80, 78), radius: 3 });
    expect(hint.tiles.some((tile) => tile.cover < 100)).toBe(true);
    expect(hint.tiles).toEqual(coverAroundGridNo(sim.state, merc, gridNo(80, 78), 0, 3));
  });

  it('count a seen enemy as ungeared and untrained: the goggles he wears and his night ops do not show', () => {
    const sim = newCombatSim(content);
    lightSetBaseLevel(sim.state, NORMAL_LIGHTLEVEL_NIGHT);
    const merc = spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.SOUTH);
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 60), Direction.SOUTH, { gun: 'C7' });
    seenBy(sim, merc, enemy);
    const sightAt = (g: number) => distanceVisible(sim.state, enemy, DIRECTION_IRRELEVANT, DIRECTION_IRRELEVANT, g, 0);
    const plain = sightAt(MERC_AT);
    enemy.inv[InvSlot.HEAD1] = createItem(content.items, content.items.byName.get('NIGHTGOGGLES')?.index ?? 0, 100);
    enemy.skillTrait1 = SkillTrait.NIGHTOPS;
    const geared = sightAt(MERC_AT);
    expect(geared).toBeGreaterThan(plain + 1);
    const target = enemy.gridNo + (plain + 1) * 160;
    const whole = coverAroundGridNo(sim.state, merc, target, 0, 0);
    expect(whole[0]?.cover).toBeLessThan(100);
    expect(coverOf(sim, { soldier: 0, center: target, radius: 0 }).tiles).toEqual([{ gridNo: target, cover: 100 }]);
  });

  it('leave out the ground under a roof the screen still draws, which would tell the inside of a room nobody has seen', () => {
    const roofed = gridNo(82, 80);
    const sim = newCombatSim(content, [], 3, new Set(), (world) => {
      world.structures.add(roofed, ROOF_LEVEL, syntheticStructure(StructureFlags.SLANTED_ROOF, Orientation.NONE));
    });
    spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.SOUTH);
    const tilesOf = (type: string, revealed: boolean) => {
      const answer = answerHint(knowledgeOf(sim, { revealedTiles: revealed ? [[roofed, 1]] : [] }), {
        type,
        soldier: 0,
        center: MERC_AT,
        radius: 2,
      });
      return (answer.data as { tiles: { gridNo: number }[] }).tiles.map((tile) => tile.gridNo);
    };
    for (const type of ['coverMap', 'sightMap']) {
      expect(tilesOf(type, false)).not.toContain(roofed);
      expect(tilesOf(type, true)).toContain(roofed);
    }
  });
});
