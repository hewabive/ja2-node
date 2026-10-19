import { beforeAll, describe, expect, it } from 'vitest';
import { loadStrategicTestContent, ScriptedRolls, testContext } from '../../../../tests/support/strategic.ts';
import { LoadingScreen } from '../../../content/strategic/loading-screens.ts';
import { StrategicMove } from '../../../content/strategic/map-tables.ts';
import { parseSectorString } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import type { StrategicContext } from '../forces/ports.ts';
import { loadScreenId } from './loading-screen.ts';
import { sectorInfo, Traversability } from './sectors.ts';

let content: StrategicContent;

beforeAll(async () => {
  content = await loadStrategicTestContent();
});

const HOUR = 3600;
const NOON = 12 * HOUR;
const NIGHT = 22 * HOUR;
const TOWN_SECTOR = 'C5';
const PLAINS = Traversability.PLAINS;

function context(seconds: number, rolls: ScriptedRolls): StrategicContext {
  const ctx = testContext({ content, random: rolls });
  ctx.state.didGameJustStart = false;
  ctx.state.clock.seconds = seconds;
  sectorInfo(ctx.state.map, parseSectorString(TOWN_SECTOR)).traversability[StrategicMove.THROUGH] = Traversability.TOWN;
  return ctx;
}

describe('the loading screen of a sector entry (GetLoadScreenID, rule finding 2)', () => {
  it('draws one Random(2) on the gameplay stream for a town sector without a mapped picture', () => {
    const rolls = new ScriptedRolls([1, 0]);
    const ctx = context(NOON, rolls);
    expect(loadScreenId(ctx, parseSectorString(TOWN_SECTOR), ctx.random)).toBe(LoadingScreen.DAYTOWN2);
    const night = context(NIGHT, rolls);
    expect(loadScreenId(night, parseSectorString(TOWN_SECTOR), night.random)).toBe(LoadingScreen.NIGHTTOWN1);
    expect(rolls.ranges).toEqual([2, 2]);
  });

  it('draws nothing for mapped sectors, SAM sites, other terrain, underground levels and the first arrival', () => {
    const rolls = new ScriptedRolls();
    const ctx = context(NOON, rolls);
    const omerta = loadScreenId(ctx, parseSectorString('A9'), ctx.random);
    expect(ctx.content.loadingScreens.screens[omerta]?.name).toBe('DAYOMERTA');
    expect(loadScreenId(ctx, parseSectorString('D15'), ctx.random)).toBe(LoadingScreen.DAYSAM);
    const plains = parseSectorString('C3');
    sectorInfo(ctx.state.map, plains).traversability[StrategicMove.THROUGH] = PLAINS;
    expect(loadScreenId(ctx, plains, ctx.random)).toBe(LoadingScreen.DAYWILD);
    expect(loadScreenId(ctx, { ...parseSectorString('C3'), z: 1 }, ctx.random)).toBe(LoadingScreen.MINE);
    expect(loadScreenId(ctx, { ...parseSectorString('C3'), z: 2 }, ctx.random)).toBe(LoadingScreen.CAVE);
    ctx.state.didGameJustStart = true;
    expect(loadScreenId(ctx, parseSectorString(TOWN_SECTOR), ctx.random)).toBe(LoadingScreen.HELI);
    expect(rolls.ranges).toEqual([]);
  });

  it('names every picture by its file under loadscreens/', () => {
    const screens = content.loadingScreens.screens;
    expect(screens[LoadingScreen.DAYTOWN1]?.path).toBe('loadscreens/ls_daytown1.sti');
    expect(screens[LoadingScreen.NIGHTSAM]?.path).toBe('loadscreens/ls_nightsam.sti');
    expect(screens.find((s) => s.name === 'DAYPRISON')?.index).toBe(LoadingScreen.NIGHTSAM + 1);
  });
});
