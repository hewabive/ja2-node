import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { AiAction } from './ai/actions.ts';
import { anim } from './anim-states.ts';
import { adjustToNextAnimationFrame, initNewSoldierAnim } from './animation.ts';
import type { TacticalContent } from './content.ts';
import { Team } from './soldier.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

describe('the end of a door opening', () => {
  it('cancels the AI action of a soldier with a far destination who cannot walk on', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 88), Direction.NORTH);
    enemy.ai.action = AiAction.WALK;
    enemy.ai.actionInProgress = true;
    enemy.absoluteFinalDestination = gridNo(80, 70);
    enemy.finalDestination = enemy.gridNo;
    enemy.endDoorOpenCode = 1;
    const endOpenDoor = anim(content, 'END_OPEN_DOOR');
    initNewSoldierAnim(t, enemy, endOpenDoor, 0, false);
    expect(enemy.state).toBe(endOpenDoor);
    for (let frame = 0; frame < 100 && enemy.state === endOpenDoor; frame++) adjustToNextAnimationFrame(t, enemy);
    expect(enemy.state).not.toBe(endOpenDoor);
    expect(enemy.ai.action).toBe(AiAction.NONE);
    expect(enemy.ai.actionInProgress).toBe(false);
    expect(enemy.endDoorOpenCode).toBe(0);
  });
});
