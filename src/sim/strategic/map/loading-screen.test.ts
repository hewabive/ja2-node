import { beforeAll, describe, expect, it } from 'vitest';
import { loadStrategicTestContent, ScriptedRolls, testContext } from '../../../../tests/support/strategic.ts';
import { LoadingScreen } from '../../../content/strategic/loading-screens.ts';
import { StrategicMove } from '../../../content/strategic/map-tables.ts';
import { parseSectorString } from '../../../content/strategic/sector-ids.ts';
import type { StrategicContent } from '../../../content/strategic/strategic-content.ts';
import { Rng } from '../../../core/rng.ts';
import type { StrategicContext } from '../forces/ports.ts';
import { loadScreenId, saveLoadScreenId } from './loading-screen.ts';
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

describe('the loading screen a save shows (SaveLoadGame.cc SaveGame, LoadSavedGame)', () => {
  const town = parseSectorString(TOWN_SECTOR);

  it("keeps the last sector entry's picture while its world is loaded, drawing nothing", () => {
    const rolls = new ScriptedRolls();
    const ctx = context(NOON, rolls);
    ctx.state.sectorFlow.loadScreen = LoadingScreen.NIGHTWILD;
    const before = ctx.state.rng.state();
    expect(saveLoadScreenId(ctx, true, town)).toBe(LoadingScreen.NIGHTWILD);
    expect([ctx.state.rng.state(), rolls.ranges]).toEqual([before, []]);
  });

  it("shows the saved sector's picture without a loaded world or a known entry, its town draw made on a copy of the stream", () => {
    const ctx = context(NOON, new ScriptedRolls());
    ctx.state.sectorFlow.loadScreen = LoadingScreen.NIGHTWILD;
    const before = ctx.state.rng.state();
    const drawn = Rng.fromState(before).int(2) === 0 ? LoadingScreen.DAYTOWN1 : LoadingScreen.DAYTOWN2;
    expect(saveLoadScreenId(ctx, false, town)).toBe(drawn);
    ctx.state.sectorFlow.loadScreen = null;
    expect(saveLoadScreenId(ctx, true, town)).toBe(drawn);
    expect(ctx.state.rng.state()).toEqual(before);
  });

  it('shows the helicopter for a save without a sector and while the game has just started', () => {
    const ctx = context(NOON, new ScriptedRolls());
    expect(saveLoadScreenId(ctx, false, null)).toBe(LoadingScreen.HELI);
    ctx.state.didGameJustStart = true;
    expect(saveLoadScreenId(ctx, false, town)).toBe(LoadingScreen.HELI);
  });
});
