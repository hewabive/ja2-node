import { beforeAll, describe, expect, it } from 'vitest';
import { loadStrategicTestContent, testContext } from '../../../../tests/support/strategic.ts';
import { parseSectorString, sectorId, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import { initializeSamSites } from './control.ts';
import { damageSamIfFound, doesSamExistHere, repairSamSite, samSiteWorks } from './sam.ts';

let content: StrategicContent;
beforeAll(async () => {
  content = await loadStrategicTestContent();
});

describe('SAM sites', () => {
  it('controls the air only from an enemy SAM in working order, and 0 in the table means no SAM', () => {
    const ctx = testContext({ content });
    const d15 = parseSectorString('D15');
    const samD15 = content.samSites.findIndex((s) => s.sector === sectorId(d15));
    const covered = content.samAirControl.indexOf(samD15);
    const coveredSector = { x: (covered % 16) + 1, y: Math.trunc(covered / 16) + 1, z: 0 };
    const element = (s: { x: number; y: number }) => ctx.state.map.elements[strategicIndex(s)];
    for (const e of ctx.state.map.elements) e.enemyControlled = true;
    initializeSamSites(ctx);
    expect(element(coveredSector)?.enemyAirControlled).toBe(true);
    expect(content.samAirControl[sectorId(parseSectorString('A9'))]).toBe(-1);
    expect(element(parseSectorString('A9'))?.enemyAirControlled).toBe(false);
    const gridNo = content.samSites[samD15]?.gridNos[0] ?? 0;
    expect(doesSamExistHere(ctx, d15, gridNo)).toBe(true);
    expect(doesSamExistHere(ctx, d15, gridNo + 7)).toBe(false);
    expect(damageSamIfFound(ctx, d15, gridNo, 21)).toBe(true);
    expect(samSiteWorks(ctx, d15)).toBe(false);
    expect(element(coveredSector)?.enemyAirControlled).toBe(false);
    damageSamIfFound(ctx, d15, gridNo, 200);
    expect(element(d15)?.samCondition).toBe(0);
    repairSamSite(ctx, d15);
    expect(element(d15)?.samCondition).toBe(100);
    expect(element(coveredSector)?.enemyAirControlled).toBe(true);
  });
});
