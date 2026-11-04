import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, spawnSoldier } from '../../../tests/support/combat.ts';
import { itemId, objectOf } from '../../../tests/support/explosives.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import { Body } from '../../content/anim/body-types.ts';
import { NOTHING } from '../../content/items/items.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import type { ItemObject } from '../items/object.ts';
import { tacticalViewParts } from '../knowledge/sim-view.ts';
import type { TacticalContent } from './content.ts';
import { InvSlot } from './inventory.ts';
import { AP } from './points.ts';
import { OKLIFE, Side, type Soldier, TEAM_FIRST_ID, Team, Visible } from './soldier.ts';
import type { TacticalSim } from './tactical-sim.ts';
import { beginMercTurn, enterCombatMode, handleTacticalEndTurn } from './turns/turns.ts';
import { radarContacts } from './xray.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const MERC_AT = gridNo(80, 80);
const IN_RANGE = gridNo(80, 110);
const OUT_OF_RANGE = gridNo(80, 125);
const START_SECONDS = 100;
const MS_PER_SECOND = 1000;
const XRAY_TIME = 5;
const FULL_BATTERIES = 50;
const FIRST_ENEMY = TEAM_FIRST_ID[Team.ENEMY];
const FIRST_CIV = TEAM_FIRST_ID[Team.CIV];
const NAMED_PROFILE = 60;
const WORKS = 0;

interface Scene {
  readonly sim: TacticalSim;
  readonly merc: Soldier;
  readonly near: Soldier;
  readonly far: Soldier;
  readonly mate: Soldier;
}

function scene(batteries: number | null = FULL_BATTERIES): Scene {
  const sim = newCombatSim(content);
  const t = sim.state;
  t.explosives.worldMs = START_SECONDS * MS_PER_SECOND;
  const merc = spawnSoldier(sim, 0, Team.OUR, MERC_AT, Direction.SOUTH);
  const device = objectOf(t, 'XRAY_DEVICE');
  if (batteries !== null) device.attachments[0] = { item: itemId(t, 'BATTERIES'), status: batteries };
  merc.inv[InvSlot.HAND] = device;
  const mate = spawnSoldier(sim, 1, Team.OUR, MERC_AT + 2, Direction.SOUTH);
  const near = spawnSoldier(sim, FIRST_ENEMY, Team.ENEMY, IN_RANGE, Direction.NORTH);
  const far = spawnSoldier(sim, FIRST_ENEMY + 1, Team.ENEMY, OUT_OF_RANGE, Direction.NORTH);
  return { sim, merc, near, far, mate };
}

function scriptedRandom(sim: TacticalSim, rolls: readonly number[]): number[] {
  const asked: number[] = [];
  const queued = [...rolls];
  const rng = sim.state.rng as unknown as { int(n: number): number };
  rng.int = (n: number) => {
    asked.push(n);
    const roll = queued.shift();
    if (roll === undefined) throw new Error(`unscripted Random(${n})`);
    return roll;
  };
  return asked;
}

function useXRay(sim: TacticalSim, rolls: readonly number[]): number[] {
  const asked = scriptedRandom(sim, rolls);
  expect(sim.dispatch({ type: 'useRemote', soldier: 0 })).toEqual({ ok: true });
  return asked;
}

const batteriesOf = (s: Soldier) => (s.inv[InvSlot.HAND] as ItemObject).attachments[0];

describe('the x-ray detector (Handle_Items.cc HandleItem, Items.cc ActivateXRayDevice)', () => {
  it('spends 2 AP at once, drains 8 + Random(5) of the batteries and marks every soldier of another team closer than 40 tiles', () => {
    const { sim, merc, near, far, mate } = scene();
    enterCombatMode(sim.state, Team.OUR);
    const before = merc.actionPoints;
    const asked = useXRay(sim, [WORKS, 3]);
    expect(asked).toEqual([80, 5]);
    expect(before - merc.actionPoints).toBe(AP.USE_REMOTE);
    expect(batteriesOf(merc)).toEqual({ item: itemId(sim.state, 'BATTERIES'), status: FULL_BATTERIES - 8 - 3 });
    expect([near.xrayedBy, far.xrayedBy, mate.xrayedBy, merc.xrayedBy]).toEqual([merc, null, null, null]);
    expect(merc.xrayActivatedTime).toBe(START_SECONDS);
    expect(sim.drainEvents()).toContainEqual(expect.objectContaining({ type: 'remoteUsed', soldier: merc.id, result: 'xray' }));
  });

  it('uses up batteries at 0 or below and then does nothing, though the APs still go', () => {
    const { sim, merc, near } = scene(8);
    useXRay(sim, [WORKS, 0]);
    expect(batteriesOf(merc)).toEqual({ item: NOTHING, status: 0 });
    expect(near.xrayedBy).toBe(merc);
    sim.state.explosives.worldMs += MS_PER_SECOND;
    enterCombatMode(sim.state, Team.OUR);
    const before = merc.actionPoints;
    expect(useXRay(sim, [WORKS])).toEqual([80]);
    expect(before - merc.actionPoints).toBe(AP.USE_REMOTE);
    expect([near.xrayedBy, merc.xrayActivatedTime]).toEqual([merc, START_SECONDS]);
  });

  it('clears whom he x-rayed before when he starts it again', () => {
    const { sim, merc, near, far } = scene();
    useXRay(sim, [WORKS, 0]);
    near.gridNo = OUT_OF_RANGE;
    far.gridNo = IN_RANGE;
    useXRay(sim, [WORKS, 0]);
    expect([near.xrayedBy, far.xrayedBy]).toEqual([null, merc]);
  });

  it('stays refused for a hand without a remote or the detector', () => {
    const { sim, merc } = scene();
    merc.inv[InvSlot.HAND] = objectOf(sim.state, 'GLOCK_17');
    expect(sim.dispatch({ type: 'useRemote', soldier: 0 })).toMatchObject({ ok: false, data: { refusal: 'noRemote' } });
  });
});

describe('turning the x-ray off (TurnOffXRayEffects)', () => {
  it('turns off at his turn start in combat, not at a turn start in real time (EVENT_BeginMercTurn)', () => {
    const { sim, merc, near } = scene();
    useXRay(sim, [WORKS, 0]);
    beginMercTurn(sim.state, merc);
    expect([near.xrayedBy, merc.xrayActivatedTime]).toEqual([merc, START_SECONDS]);
    enterCombatMode(sim.state, Team.OUR);
    beginMercTurn(sim.state, merc);
    expect([near.xrayedBy, merc.xrayActivatedTime]).toEqual([null, 0]);
  });

  it('turns off at the first real-time turn more than 5 world seconds after it started (HandleTacticalEndTurn)', () => {
    const { sim, merc, near } = scene();
    const t = sim.state;
    useXRay(sim, [WORKS, 0]);
    scriptedRandom(sim, []);
    const rng = t.rng as unknown as { int(n: number): number };
    rng.int = () => 0;
    t.explosives.worldMs = (START_SECONDS + XRAY_TIME) * MS_PER_SECOND;
    handleTacticalEndTurn(t, t.realtimeClock);
    expect(near.xrayedBy).toBe(merc);
    t.explosives.worldMs += MS_PER_SECOND;
    handleTacticalEndTurn(t, t.realtimeClock);
    expect([near.xrayedBy, merc.xrayActivatedTime]).toEqual([null, 0]);
  });
});

describe('x-rayed soldiers on the radar (Radar_Screen.cc RenderRadarScreen)', () => {
  it('lists those the squad does not see, by the colour the radar gives them, and the view carries them only while there are any', () => {
    const { sim, merc, near, far } = scene();
    const t = sim.state;
    const hostile = spawnSoldier(sim, FIRST_CIV, Team.CIV, IN_RANGE + 2, Direction.NORTH);
    hostile.neutral = false;
    hostile.side = Side.ENEMY;
    const named = spawnSoldier(sim, FIRST_CIV + 1, Team.CIV, IN_RANGE + 4, Direction.NORTH, { profile: NAMED_PROFILE });
    named.neutral = true;
    const civilian = spawnSoldier(sim, FIRST_CIV + 2, Team.CIV, IN_RANGE + 6, Direction.NORTH);
    civilian.neutral = true;
    const creature = spawnSoldier(sim, TEAM_FIRST_ID[Team.CREATURE], Team.CREATURE, IN_RANGE + 8, Direction.NORTH);
    const militia = spawnSoldier(sim, TEAM_FIRST_ID[Team.MILITIA], Team.MILITIA, IN_RANGE + 10, Direction.NORTH);
    const crow = spawnSoldier(sim, FIRST_CIV + 3, Team.CIV, IN_RANGE + 12, Direction.NORTH, { body: Body.CROW });
    const seen = spawnSoldier(sim, FIRST_ENEMY + 2, Team.ENEMY, IN_RANGE + 14, Direction.NORTH);
    const fallen = spawnSoldier(sim, FIRST_ENEMY + 3, Team.ENEMY, IN_RANGE + 16, Direction.NORTH);
    fallen.life = OKLIFE - 1;
    for (const s of [hostile, named, civilian, creature, militia, crow, fallen, near, far]) s.visible = Visible.HIDDEN;
    seen.visible = Visible.SEEN;
    expect(tacticalViewParts(sim)).not.toHaveProperty('radarContacts');
    useXRay(sim, [WORKS, 0]);
    expect(radarContacts(t)).toEqual([
      { gridNo: near.gridNo, kind: 'enemy' },
      { gridNo: fallen.gridNo, kind: 'unconscious' },
      { gridNo: creature.gridNo, kind: 'creature' },
      { gridNo: militia.gridNo, kind: 'militia' },
      { gridNo: hostile.gridNo, kind: 'hostileCivilian' },
      { gridNo: named.gridNo, kind: 'namedCivilian' },
      { gridNo: civilian.gridNo, kind: 'civilian' },
    ]);
    expect(tacticalViewParts(sim).radarContacts).toEqual(radarContacts(t));
    expect(merc.xrayedBy).toBeNull();
  });
});
