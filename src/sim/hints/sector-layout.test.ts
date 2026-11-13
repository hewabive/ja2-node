import { beforeAll, describe, expect, it } from 'vitest';
import { addSyntheticCrate, knowledgeOf, newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Orientation } from '../../content/formats/jsd.ts';
import { Direction, gridNo, WORLD_COLS } from '../../content/world/grid.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import { syntheticStructure } from '../../content/world/synthetic.ts';
import type { KnowledgeView } from '../knowledge/view.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { handleStructChangeFromGridNo } from '../tactical/doors/openables.ts';
import { Team } from '../tactical/soldier.ts';
import type { TacticalSim } from '../tactical/tactical-sim.ts';
import { answerHint } from './answer.ts';
import type { SectorLayout } from './sector-layout.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const CRATE = gridNo(81, 80);
const BESIDE = gridNo(80, 80);
const WINDOW = { center: CRATE, radius: 2 };
const ROOF_LEVEL = 1;

function crateSim(slantedRoof = false): TacticalSim {
  return newCombatSim(content, [], 3, new Set(), (world) => {
    addSyntheticCrate(world.structures, CRATE);
    if (slantedRoof) world.structures.add(CRATE, ROOF_LEVEL, syntheticStructure(StructureFlags.SLANTED_ROOF, Orientation.NONE));
  });
}

function layoutOf(sim: TacticalSim, request: Readonly<Record<string, unknown>>, patch: Partial<KnowledgeView> = {}): SectorLayout {
  const answer = answerHint(knowledgeOf(sim, patch), { type: 'sectorLayout', ...request });
  expect(answer.ok, answer.reason).toBe(true);
  return answer.data as SectorLayout;
}

function charAt(layout: SectorLayout, g: number): string {
  const row = Math.trunc((Math.trunc(g / WORLD_COLS) - Math.trunc(layout.origin / WORLD_COLS)) / layout.cell);
  const column = Math.trunc(((g % WORLD_COLS) - (layout.origin % WORLD_COLS)) / layout.cell);
  return layout.rows[row]?.[column] ?? ' ';
}

describe('sectorLayout over containers', () => {
  it('marks a closed container C and an open one c tile by tile, the interactive tiles the door command opens and closes', () => {
    const sim = crateSim();
    const opener = spawnSoldier(sim, 0, Team.OUR, BESIDE, Direction.EAST);
    const closed = layoutOf(sim, WINDOW);
    expect(charAt(closed, CRATE)).toBe('C');
    expect(Object.keys(closed.legend)).toEqual(expect.arrayContaining(['C', 'c']));
    handleStructChangeFromGridNo(sim.state, opener, CRATE);
    expect(charAt(layoutOf(sim, WINDOW), CRATE)).toBe('c');
  });

  it('keeps containers out of the cell overview and out of the ground under a roof the screen still draws', () => {
    const overview = layoutOf(crateSim(), {});
    expect(overview.rows.join('')).not.toMatch(/[Cc]/);
    expect(Object.keys(overview.legend)).not.toContain('C');
    const roofed = crateSim(true);
    expect(charAt(layoutOf(roofed, WINDOW, { revealedTiles: [] }), CRATE)).toBe('R');
    expect(charAt(layoutOf(roofed, WINDOW, { revealedTiles: [[CRATE, 1]] }), CRATE)).toBe('C');
  });
});
