import { describe, expect, it } from 'vitest';
import { readDataJson } from '../../../tests/support/tactical.ts';
import { Body } from './body-types.ts';
import { chooseSurface, SubAnimFlags, type SurfaceQuery } from './surface-choice.ts';
import { ANIM_CONTROL_PATH, ANIM_SURFACES_PATH, parseAnimationTables, stateId } from './tables.ts';

const tables = parseAnimationTables(readDataJson(ANIM_CONTROL_PATH), readDataJson(ANIM_SURFACES_PATH));
const HEALTHY = 80;
const INJURED = 29;
const NORTH = 0;
const EAST = 2;
const SOUTH = 4;
const WEST = 6;

function surfaceName(over: Partial<SurfaceQuery> & { readonly stateName: string }): string {
  const { stateName, ...rest } = over;
  const query: SurfaceQuery = {
    bodyType: Body.REGMALE,
    state: stateId(tables, stateName),
    hand: 'rifle',
    secondHandOneHandedGun: false,
    life: HEALTHY,
    subFlags: 0,
    inWater: false,
    queenSpitDirection: () => SOUTH,
    ...rest,
  };
  return tables.surfaces[chooseSurface(tables, query)]?.name ?? 'invalid';
}

describe('the sheet a soldier shows', () => {
  it('in water picks the mid-water sheet by the hand: the two-handed one for a rifle, the other for a pistol or empty hands', () => {
    expect(surfaceName({ stateName: 'WALKING', inWater: true, hand: 'rifle' })).toBe('RGMWATER_R_WALK');
    expect(surfaceName({ stateName: 'WALKING', inWater: true, hand: 'pistol' })).toBe('RGMWATER_N_WALK');
    expect(surfaceName({ stateName: 'STANDING', inWater: true, hand: 'nothing' })).toBe('RGMWATER_N_STD');
    expect(surfaceName({ stateName: 'RUNNING', inWater: true, hand: 'nothing', bodyType: Body.REGFEMALE })).toBe('RGFWATER_N_WALK');
    expect(surfaceName({ stateName: 'READY_DUAL_STAND', inWater: true, hand: 'pistol' })).toBe('RGMWATER_DBLSHT');
  });

  it('in water ignores the hand item and the wounds: a state without a water sheet shows the dry rifle sheet even with empty hands', () => {
    expect(surfaceName({ stateName: 'WALK_BACKWARDS', inWater: true, hand: 'nothing' })).toBe('RGMBASICWALKING');
    expect(surfaceName({ stateName: 'WALK_BACKWARDS', hand: 'nothing' })).toBe('RGMNOTHING_WALK');
    expect(surfaceName({ stateName: 'WALKING', inWater: true, hand: 'nothing', life: INJURED })).toBe('RGMWATER_N_WALK');
  });

  it('stands with two pistols when a one-handed gun is in each hand', () => {
    expect(surfaceName({ stateName: 'STANDING', hand: 'pistol', secondHandOneHandedGun: true })).toBe('RGMDBLBREATH');
    expect(surfaceName({ stateName: 'STANDING', hand: 'pistol' })).toBe('RGMPISTOLBREATH');
    expect(surfaceName({ stateName: 'STANDING', hand: 'rifle', secondHandOneHandedGun: true })).toBe('RGMSTANDING');
    expect(surfaceName({ stateName: 'WALKING', hand: 'pistol', secondHandOneHandedGun: true })).toBe('RGMNOTHING_WALK');
  });

  it('walks hurt below 30 life: with the rifle walk for a rifle, the empty-handed one when the hand changed the sheet', () => {
    expect(surfaceName({ stateName: 'WALKING', hand: 'rifle', life: INJURED })).toBe('RGMHURTWALKINGR');
    expect(surfaceName({ stateName: 'WALKING', hand: 'pistol', life: INJURED })).toBe('RGMHURTWALKINGN');
    expect(surfaceName({ stateName: 'WALKING', hand: 'nothing', life: INJURED, bodyType: Body.BIGMALE })).toBe('BGMHURTWALKINGN');
    expect(surfaceName({ stateName: 'WALKING', hand: 'rifle', life: INJURED + 1 })).toBe('RGMBASICWALKING');
    expect(surfaceName({ stateName: 'RUNNING', hand: 'rifle', life: INJURED })).toBe('RGMRUNNING');
  });

  it('gives a big male with the threaten stance his second stand, walk, run and raise sheets, and with the second shot flag the first aim', () => {
    const big = { bodyType: Body.BIGMALE, subFlags: SubAnimFlags.BIGGUY_THREATEN_STANCE } as const;
    expect(surfaceName({ ...big, stateName: 'STANDING' })).toBe('BGMTHREATENSTAND');
    expect(surfaceName({ ...big, stateName: 'WALKING' })).toBe('BGMWALK2');
    expect(surfaceName({ ...big, stateName: 'RUNNING' })).toBe('BGMRUN2');
    expect(surfaceName({ ...big, stateName: 'RAISE_RIFLE' })).toBe('BGMRAISE2');
    expect(surfaceName({ bodyType: Body.BIGMALE, stateName: 'AIM_RIFLE_STAND' })).toBe('BGMSTANDAIM2');
    expect(surfaceName({ bodyType: Body.BIGMALE, subFlags: SubAnimFlags.BIGGUY_SHOOT2, stateName: 'AIM_RIFLE_STAND' })).toBe('BGMSTANDAIM');
  });

  it("spits as the queen with the sheet toward her target, five sheets for eight directions, and nothing else of a merc's choice", () => {
    const queen = { bodyType: Body.QUEENMONSTER, stateName: 'QUEEN_SPIT' } as const;
    expect(surfaceName({ ...queen, queenSpitDirection: () => NORTH })).toBe('QUEENMONSTERSPIT_NE');
    expect(surfaceName({ ...queen, queenSpitDirection: () => EAST })).toBe('QUEENMONSTERSPIT_SE');
    expect(surfaceName({ ...queen, queenSpitDirection: () => SOUTH })).toBe('QUEENMONSTERSPIT_SW');
    expect(surfaceName({ ...queen, queenSpitDirection: () => WEST })).toBe('QUEENMONSTERSPIT_SW');
    expect(surfaceName({ bodyType: Body.COW, stateName: 'STANDING', inWater: true, hand: 'nothing', life: INJURED })).toBe('COWSTANDING');
  });
});
