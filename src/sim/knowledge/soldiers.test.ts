import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { gridNo } from '../../content/world/grid.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { adrenalineEffect, DrunkLevel, drunkLevel, mercUnderTheInfluence } from '../tactical/drugs.ts';
import { LIFELESS_HEALTH_INDEX } from '../tactical/health.ts';
import { Team } from '../tactical/soldier.ts';
import { UnsuppliedFieldError } from './guard.ts';
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

function ownMerc(fields: Partial<KnowledgeSoldier> = {}): KnowledgeSoldier {
  return { id: 0, team: Team.OUR, bodyType: 0, gridNo: gridNo(80, 80), x: 0, y: 0, level: 0, direction: 0, animation: 0, ...fields };
}

describe('own soldiers projected from the view', () => {
  const strict = { strict: true };
  const projected = (fields: Partial<KnowledgeSoldier>) => soldierFromView(content, ownMerc(fields), [0], strict).soldier;

  it('rebuild the drunk level the view shows', () => {
    const levels = [undefined, 'feelingGood', 'borderline', 'drunk', 'hungover'] as const;
    expect(levels.map((drunk) => drunkLevel(projected(drunk ? { drunk } : {})))).toEqual([
      DrunkLevel.SOBER,
      DrunkLevel.FEELING_GOOD,
      DrunkLevel.BORDERLINE,
      DrunkLevel.DRUNK,
      DrunkLevel.HUNGOVER,
    ]);
  });

  it('know there is no adrenaline when the view shows none, and leave its numbers unsupplied when it shows some', () => {
    expect(adrenalineEffect(projected({}))).toBe(0);
    expect(mercUnderTheInfluence(projected({ drunk: 'drunk' }))).toBe(true);
    expect(() => adrenalineEffect(projected({ adrenaline: 'active' }))).toThrow(UnsuppliedFieldError);
    expect(() => mercUnderTheInfluence(projected({ adrenaline: 'crash' }))).toThrow(UnsuppliedFieldError);
  });
});

describe('other soldiers projected from the view, on drugs', () => {
  it('supply no drug state at all', () => {
    const enemy = soldierFromView(content, seenEnemy(DYING_HEALTH_INDEX), [0], { strict: true }).soldier;
    expect(() => drunkLevel(enemy)).toThrow(UnsuppliedFieldError);
  });
});
