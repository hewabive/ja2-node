import { beforeAll, describe, expect, it } from 'vitest';
import { FakeMercs, loadStrategicTestContent, testContext } from '../../../../tests/support/strategic.ts';
import { MAP_SIDE, parseSectorId, parseSectorString } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import { Assignment, SectorFlag } from '../forces/constants.ts';
import { peekPlayerKnowledgeOfEnemies, surfaceKnowledgeOfEnemies } from './knowledge.ts';

let content: StrategicContent;

beforeAll(async () => {
  content = await loadStrategicTestContent();
});

describe('surface knowledge of enemies', () => {
  it('answers every surface sector as peekPlayerKnowledgeOfEnemies does', () => {
    const mercs = new FakeMercs();
    const ctx = testContext({ content, mercs, ai: { numStationaryEnemiesInSector: (s) => (s.x % 3 === 0 ? 1 : 0) } });
    mercs.add({ id: 1, sector: parseSectorString('A9') });
    mercs.add({ id: 2, sector: parseSectorString('C3'), life: 5 });
    mercs.add({ id: 3, sector: parseSectorString('D4'), assignment: Assignment.IN_TRANSIT });
    Object.assign(mercs.add({ id: 4, sector: parseSectorString('F6') }), { asleep: true });
    mercs.add({ id: 5, sector: parseSectorString('G7') }).betweenSectors = true;
    mercs.add({ id: 6, sector: { ...parseSectorString('H8'), z: 1 } });
    mercs.add({ id: 7, sector: parseSectorString('P16') });
    const map = ctx.state.map;
    const set = (sector: string, patch: object) => Object.assign(map.sectors[parseSectorId(sector)] ?? {}, patch);
    set('B13', { militia: [2, 0, 0] });
    set('P1', { militia: [0, 0, 1] });
    set('K10', { flags: SectorFlag.PLAYER_KNOWS_ENEMIES_ARE_HERE });
    set('L11', { flags: SectorFlag.ALREADY_VISITED });
    set('M12', { flags: SectorFlag.SKYRIDER_NOTICED_ENEMIES_HERE });
    const knowledge = surfaceKnowledgeOfEnemies(ctx);
    const answers = new Set<number>();
    for (let y = 1; y <= MAP_SIDE; y++)
      for (let x = 1; x <= MAP_SIDE; x++) {
        const s = { x, y, z: 0 };
        const expected = peekPlayerKnowledgeOfEnemies(ctx, s);
        answers.add(expected);
        expect(knowledge(s), `${x},${y}`).toBe(expected);
      }
    expect(answers.size).toBe(3);
    const below = { ...parseSectorString('H8'), z: 1 };
    expect(knowledge(below)).toBe(peekPlayerKnowledgeOfEnemies(ctx, below));
  });
});
