import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { gridNo } from '../../content/world/grid.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { LIFELESS_HEALTH_INDEX } from '../tactical/health.ts';
import { Team } from '../tactical/soldier.ts';
import { soldierFromView } from './soldiers.ts';
import type { KnowledgeSoldier } from './view.ts';

const DYING_HEALTH_INDEX = 0;
const DYING_STAND_IN_LIFE = 14;

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

function seenEnemy(healthIndex: number): KnowledgeSoldier {
  return {
    id: 20,
    team: Team.ENEMY,
    bodyType: 0,
    gridNo: gridNo(80, 92),
    x: 0,
    y: 0,
    level: 0,
    direction: 0,
    animation: 0,
    hostile: true,
    healthIndex,
  };
}

describe('other soldiers projected from the view', () => {
  it('stand in a life inside their health word, and none once the view says the life is gone', () => {
    const lifeOf = (healthIndex: number) => soldierFromView(content, seenEnemy(healthIndex), [0], { strict: false }).raw.life;
    expect(lifeOf(DYING_HEALTH_INDEX)).toBe(DYING_STAND_IN_LIFE);
    expect(lifeOf(LIFELESS_HEALTH_INDEX)).toBe(0);
  });
});
