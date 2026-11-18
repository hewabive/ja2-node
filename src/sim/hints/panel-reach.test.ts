import { beforeAll, describe, expect, it } from 'vitest';
import { hintAnswer, newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { CONSCIOUSNESS } from '../tactical/combat/types.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { panelOutOfReach } from '../tactical/inventory-commands.ts';
import { OKLIFE, Team } from '../tactical/soldier.ts';
import type { PanelReach } from './panel-reach.ts';

const PANEL_MERC_AT = gridNo(80, 80);
const TWO_AWAY = gridNo(82, 80);
const THREE_AWAY = gridNo(83, 80);
const FOUR_AWAY = gridNo(84, 80);
const FIRST_SQUAD = 0;
const SECOND_SQUAD = 1;

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

function pair(sourceAt: number) {
  const sim = newCombatSim(content);
  const merc = spawnSoldier(sim, 0, Team.OUR, PANEL_MERC_AT, Direction.EAST);
  const source = spawnSoldier(sim, 1, Team.OUR, sourceAt, Direction.WEST);
  const outOfReach = () => (hintAnswer(sim, 'panelReach', { soldier: 0, source: 1 }).data as PanelReach).outOfReach;
  return { sim, merc, source, outOfReach };
}

describe('the reach of the single merc panel (CheckForDisabledForGiveItem)', () => {
  it('holds three tiles from the merc with the item or the selected merc', () => {
    expect(pair(THREE_AWAY).outOfReach()).toBe(false);
    expect(pair(FOUR_AWAY).outOfReach()).toBe(true);
  });

  it('never bars the merc himself or a panel without a source', () => {
    const { sim } = pair(FOUR_AWAY);
    expect(hintAnswer(sim, 'panelReach', { soldier: 0, source: 0 }).data).toEqual({ outOfReach: false });
    expect(hintAnswer(sim, 'panelReach', { soldier: 0 }).data).toEqual({ outOfReach: false });
  });

  it('asks for two tiles to a merc below consciousness', () => {
    const near = pair(TWO_AWAY);
    near.merc.life = CONSCIOUSNESS - 1;
    expect(near.outOfReach()).toBe(false);
    const far = pair(THREE_AWAY);
    far.merc.life = CONSCIOUSNESS - 1;
    expect(far.outOfReach()).toBe(true);
  });

  it('with an item held asks of a dying merc a mate of the current squad beside him, wherever the source stands', () => {
    const { sim, merc, source } = pair(TWO_AWAY);
    merc.life = OKLIFE - 1;
    const squads = new Map([[source.id, SECOND_SQUAD]]);
    sim.state.narrative = {
      ...sim.state.narrative,
      assignment: (m) => squads.get(m.id) ?? FIRST_SQUAD,
      currentSquad: () => FIRST_SQUAD,
    };
    expect(panelOutOfReach(sim.state, merc, source, true)).toBe(true);
    squads.set(source.id, FIRST_SQUAD);
    expect(panelOutOfReach(sim.state, merc, source, true)).toBe(false);
  });

  it('answers on the projection for a dying merc as well', () => {
    const { sim, merc } = pair(TWO_AWAY);
    merc.life = OKLIFE - 1;
    expect(hintAnswer(sim, 'panelReach', { soldier: 0, source: 1, itemHeld: true })).toMatchObject({
      ok: true,
      data: { outOfReach: false },
    });
  });
});
