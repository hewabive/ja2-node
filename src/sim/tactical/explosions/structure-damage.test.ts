import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim } from '../../../../tests/support/combat.ts';
import { loadTestContent } from '../../../../tests/support/tactical.ts';
import { Orientation, type StructureDef } from '../../../content/formats/jsd.ts';
import { gridNo } from '../../../content/world/grid.ts';
import { StructureFlags } from '../../../content/world/structures.ts';
import { syntheticStructure } from '../../../content/world/synthetic.ts';
import type { TacticalContent } from '../content.ts';
import type { TacticalState } from '../state.ts';
import { windowHit } from './structure-damage.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const WINDOW_AT = gridNo(80, 80);
const FOLLOWS_PARTNER = 1;
const LAST_OF_CHAIN = 0;
const CRACKING_CHAIN = [FOLLOWS_PARTNER, FOLLOWS_PARTNER, FOLLOWS_PARTNER];
const SMASHING_CHAIN = [FOLLOWS_PARTNER, LAST_OF_CHAIN];

function windowState(number: number, partnerDelta: number): StructureDef {
  return { ...syntheticStructure(StructureFlags.WALLNWINDOW, Orientation.OUTSIDE_LEFT), number, partnerDelta };
}

function hitWindow(chain: readonly number[]): TacticalState {
  const structures = chain.map((delta, k) => windowState(k, delta));
  const first = structures[0] as StructureDef;
  const sim = newCombatSim(content, [], 3, new Set(), (world) => {
    world.structures.add(WINDOW_AT, 0, first, undefined, {
      structureCount: structures.length,
      auxData: null,
      tileLocations: [],
      structures,
    });
  });
  const t = sim.state;
  const window = t.world.structures.find(WINDOW_AT, StructureFlags.WALLNWINDOW);
  if (!window) throw new Error('no window');
  t.turn.attackBusyCount = 1;
  windowHit(t, WINDOW_AT, window.id, false);
  return t;
}

describe('the noise of a window hit (Weapons.cc:1884-1887, OppList.h:14)', () => {
  it('is 4 when the window only cracks', () => {
    expect(hitWindow(CRACKING_CHAIN).turn.deferredNoises.map((n) => n.volume)).toEqual([4]);
  });

  it('is 8 when it smashes', () => {
    expect(hitWindow(SMASHING_CHAIN).turn.deferredNoises.map((n) => n.volume)).toEqual([8]);
  });
});
