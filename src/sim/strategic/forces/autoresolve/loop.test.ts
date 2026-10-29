import { beforeAll, describe, expect, it } from 'vitest';
import { arEnv, arSoldier, arState, enemySoldier, scripted } from '../../../../../tests/support/autoresolve.ts';
import { loadTestContent } from '../../../../../tests/support/tactical.ts';
import type { TacticalContent } from '../../../tactical/content.ts';
import { Body } from '../../../tactical/soldier.ts';
import { EncounterCode } from '../constants.ts';
import { processCell } from './loop.ts';
import type { ArCell } from './state.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

function cell(cells: readonly ArCell[], i: number): ArCell {
  const c = cells[i];
  if (!c) throw new Error(`no cell ${i}`);
  return c;
}

describe('processCell', () => {
  it('lets a creature pick its target before it skips 7 % of its attacks (quirk Q25)', () => {
    const ar = arState({
      encounter: EncounterCode.CREATURE_ATTACK,
      mercs: [{ soldier: arSoldier(content) }],
      enemies: [{ soldier: enemySoldier(content, { body: Body.YAM_MONSTER, gun: null }) }],
    });
    const merc = cell(ar.mercs, 0);
    const creature = cell(ar.enemies, 0);
    merc.defence = 400;
    ar.playerDefence = 400;
    creature.attack = 500;
    creature.nextAttack = 0;
    const pre = scripted([0, 6, 0]);
    processCell(arEnv(content, { pre }), ar, creature, 1000);
    expect(pre.requested).toEqual([400, 100, 1500]);
    expect(ar.events.map((e) => e.type)).toEqual(['arSound']);
  });
});
