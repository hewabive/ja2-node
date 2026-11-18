import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Body } from '../../../content/anim/body-types.ts';
import { loadUiStrings } from '../../../content/text/strings.ts';
import { PROJECT_DATA_DIR } from '../../../node/repo.ts';
import type { PlayerView, SoldierView } from '../../../protocol/view.ts';
import { StringsTextService } from '../../text/text-service.ts';
import {
  apColour,
  findActiveAndAliveMerc,
  hasProfile,
  nextMercInTeamPanel,
  soldierName,
  teamPanelMembers,
  vehicleCarrying,
} from './soldiers.ts';

let text: StringsTextService;

beforeAll(async () => {
  const strings = await loadUiStrings(async (path) => new Uint8Array(await readFile(join(PROJECT_DATA_DIR, path))), 'eng');
  text = new StringsTextService(strings);
});

describe('the AP number of a merc in combat (PrintAP)', () => {
  const merc = { id: 2, ap: 4, enoughApToAttack: true } as SoldierView;

  it('turns dark red when he lacks the APs to attack his last target, ahead of the sneaking yellow', () => {
    expect(apColour(merc)).toBe('ltgray');
    expect(apColour({ ...merc, stealth: true })).toBe('ltyellow');
    expect(apColour({ ...merc, stealth: true, enoughApToAttack: false })).toBe('dkred');
    expect(apColour({ ...merc, ap: -2 })).toBe('dkred');
  });

  it('turns light blue under a drink, a hangover, adrenaline or its crash, ahead of the sneaking yellow but not of dark red', () => {
    const influences: readonly Partial<SoldierView>[] = [
      { drunk: 'feelingGood' },
      { drunk: 'hungover' },
      { adrenaline: 'active' },
      { adrenaline: 'crash' },
    ];
    for (const influence of influences) {
      expect(apColour({ ...merc, ...influence, stealth: true })).toBe('ltblue');
      expect(apColour({ ...merc, ...influence, enoughApToAttack: false })).toBe('dkred');
      expect(apColour({ ...merc, ...influence, ap: -1 })).toBe('dkred');
    }
  });
});

describe('the next merc of the keys and the panel buttons', () => {
  const DYING = 10;
  const HEALTHY = 60;
  const ROBOT_BODY = 25;
  const SQUAD = 1;
  const OTHER_SQUAD = 2;
  const merc = (id: number, over: Partial<SoldierView> = {}) =>
    ({ id, team: 0, bodyType: 0, squad: SQUAD, life: HEALTHY, canAct: true, ...over }) as SoldierView;
  const viewOf = (...soldiers: SoldierView[]) => ({ soldiers }) as unknown as PlayerView;

  it('takes the next merc of the panel who can be controlled, skipping the dying, the interrupt-locked and other assignments (FindNextMercInTeamPanel)', () => {
    const current = merc(1);
    const panel = [merc(0), current, merc(2, { life: DYING }), merc(3, { canAct: false }), merc(4, { squad: OTHER_SQUAD }), null, merc(5)];
    expect(nextMercInTeamPanel(viewOf(...panel.flatMap((s) => s ?? [])), panel, current).id).toBe(5);
  });

  it('wraps to the first fit merc before him, and keeps him when nobody fits or he is not on the panel', () => {
    const current = merc(1);
    const before = merc(0);
    expect(nextMercInTeamPanel(null, [before, current, merc(2, { life: DYING })], current)).toBe(before);
    expect(nextMercInTeamPanel(null, [merc(0, { squad: null }), current], current)).toBe(current);
    expect(nextMercInTeamPanel(null, [before, merc(2)], current)).toBe(current);
  });

  it('compares the assignment of mercs off squads on the strategic view', () => {
    const current = merc(1, { squad: null });
    const doctor = merc(2, { squad: null });
    const patient = merc(3, { squad: null });
    const view = {
      soldiers: [current, doctor, patient],
      strategic: {
        mercs: [
          { id: 1, assignment: 21 },
          { id: 2, assignment: 21 },
          { id: 3, assignment: 22 },
        ],
      },
    } as unknown as PlayerView;
    const panelButtons = { goodForLessOkLife: true, onlyRegularMercs: true };
    expect(findActiveAndAliveMerc(view, current, 1, panelButtons).id).toBe(2);
    expect(findActiveAndAliveMerc(view, doctor, 1, panelButtons).id).toBe(1);
  });

  it('steps by id through the regular mercs of his assignment on the map, both ways round (FindActiveAndAliveMerc)', () => {
    const current = merc(2);
    const view = viewOf(
      merc(0),
      merc(1, { kind: 'epc' }),
      current,
      merc(3, { bodyType: ROBOT_BODY }),
      merc(4, { squad: OTHER_SQUAD }),
      merc(5, { canAct: false }),
      merc(6, { vehicle: { id: 0, driver: false } }),
      merc(7),
    );
    const filter = { goodForLessOkLife: true, onlyRegularMercs: true };
    expect(findActiveAndAliveMerc(view, current, 1, filter).id).toBe(7);
    expect(findActiveAndAliveMerc(view, current, -1, filter).id).toBe(0);
    expect(findActiveAndAliveMerc(view, merc(0), -1, filter).id).toBe(7);
  });

  it('takes a dying merc for the panel buttons but not for the shop, and keeps the merc when nobody fits', () => {
    const current = merc(1);
    const dying = merc(2, { life: DYING });
    const view = viewOf(current, dying, merc(3, { life: 0 }));
    expect(findActiveAndAliveMerc(view, current, 1, { goodForLessOkLife: true, onlyRegularMercs: true })).toBe(dying);
    expect(findActiveAndAliveMerc(view, current, 1, { goodForLessOkLife: false, onlyRegularMercs: true })).toBe(current);
  });
});

describe('the team panel of the current squad (CheckForAndAddMercToTeamPanel)', () => {
  const HUMVEE = 22;
  const merc = (id: number, over: Partial<SoldierView> = {}) => ({ id, team: 0, bodyType: 0, squad: 1, ...over }) as SoldierView;

  it("lists a vehicle's passengers in seat order in its place, not the vehicle, and nobody aboard on his own", () => {
    const driver = merc(3, { squad: null, vehicle: { id: 0, driver: true } });
    const passenger = merc(1, { squad: null, vehicle: { id: 0, driver: false } });
    const truck = merc(18, { bodyType: HUMVEE, passengers: [3, 1] });
    const walker = merc(2);
    const view = { soldiers: [passenger, walker, driver, truck] } as unknown as PlayerView;
    expect(teamPanelMembers(view, [walker, truck, driver]).map((s) => s.id)).toEqual([2, 3, 1]);
  });

  it('finds the vehicle of a merc aboard, whose face selects it, and none for a merc on foot', () => {
    const passenger = merc(1, { squad: null, vehicle: { id: 0, driver: false } });
    const truck = merc(18, { bodyType: HUMVEE, passengers: [1] });
    const walker = merc(2);
    const view = { soldiers: [passenger, walker, truck] } as unknown as PlayerView;
    expect(vehicleCarrying(view, passenger)?.id).toBe(18);
    expect(vehicleCarrying(view, walker)).toBeNull();
  });
});

describe('the name of a soldier (Vehicles.cc SetVehicleValuesIntoSoldierType)', () => {
  it("names a vehicle by zVehicleName of its body's type, the ice cream truck a plain Truck, and anybody else by his own name", () => {
    const named = (bodyType: number) => soldierName(text, { name: 'Iggy', bodyType });
    const bodies = [Body.HUMVEE, Body.ELDORADO, Body.ICECREAMTRUCK, Body.JEEP, Body.TANK_NW, Body.TANK_NE, Body.REGMALE];
    expect(bodies.map(named)).toEqual(['Hummer', 'Eldorado', 'Truck', 'Jeep', 'Tank', 'Tank', 'Iggy']);
  });

  it("names a soldier with no name of his own by his team's default in the client's language (Soldier_Create.cc TacticalCopySoldierFromCreateStruct)", () => {
    const defaults = ['enemy', 'militia', 'civilian', 'miner', 'crow', 'creature', 'bloodcat'] as const;
    const named = defaults.map((defaultName) => soldierName(text, { name: '', bodyType: Body.REGMALE, defaultName }));
    expect(named).toEqual(['SOLDIER', 'MILITIA', 'CIVILIAN', 'Miner', 'CROW', 'CREPITUS', 'BLOODCAT']);
  });
});

describe('the profile behind the label above a soldier (Interface.cc GetSoldierAboveGuyPositions)', () => {
  it('gives every vehicle a profile, a tank not ours included, so its label drops to its feet as a profiled merc does', () => {
    const tank = { bodyType: Body.TANK_NE } as SoldierView;
    const enemy = { bodyType: Body.REGMALE } as SoldierView;
    expect([hasProfile(tank), hasProfile(enemy), hasProfile({ ...enemy, profile: 7 })]).toEqual([true, false, true]);
  });
});
