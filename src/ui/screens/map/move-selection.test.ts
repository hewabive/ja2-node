import { describe, expect, it } from 'vitest';
import type { StrategicMercView, StrategicView } from '../../../protocol/view.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { Assignment } from './character-list.ts';
import { MoveError, type MoveMember, MoveSelection, moveMembers } from './move-selection.ts';

const STRINGS: Readonly<Record<string, readonly string[]>> = {
  pMovementMenuStrings: ['Move Mercs In Sector %s', 'Plot Travel Route', 'Cancel', 'Other'],
  pSquadMenuStrings: ['Squad 1', 'Squad 2', 'Squad 3'],
  pVehicleStrings: ['Eldorado', 'Hummer'],
  pAssignmentStrings: Object.assign([], { 21: 'Doctor', 23: 'Vehicle', 25: 'Repair' }),
};

const TEXT: UiTextService = {
  string: (table, index) => STRINGS[table]?.[index] ?? null,
  edt: () => null,
};

function member(id: number, over: Partial<MoveMember> = {}): MoveMember {
  return {
    id,
    name: `M${id}`,
    assignment: 0,
    squad: 0,
    vehicle: null,
    betweenSectors: false,
    listed: true,
    refusal: null,
    ...over,
  };
}

function texts(selection: MoveSelection): string[] {
  return selection.lines(TEXT, 'D13', () => 1).map((l) => l.text);
}

describe('the move box selection', () => {
  it('lists squads with their mercs, vehicles with their passengers, then the others, in that order', () => {
    const selection = new MoveSelection([
      member(1, { squad: 1, assignment: 1 }),
      member(2, { squad: 0 }),
      member(3, { squad: null, vehicle: 7, assignment: Assignment.VEHICLE }),
      member(4, { squad: null, assignment: Assignment.DOCTOR }),
    ]);
    expect(texts(selection)).toEqual([
      'Move Mercs In Sector D13',
      '',
      'Squad 2',
      '   M1',
      'Squad 1',
      '   M2',
      'Hummer',
      '   M3',
      'Other',
      '  M4 ( Doctor )',
      '',
      '',
      'Cancel',
    ]);
  });

  it('marks a picked squad and its mercs, and offers the plot line once something is picked', () => {
    const selection = new MoveSelection([member(1), member(2)]);
    expect(selection.toggleSquad(0)).toBeNull();
    expect(texts(selection)).toEqual([
      'Move Mercs In Sector D13',
      '',
      '*Squad 1*',
      '   *M1*',
      '   *M2*',
      '',
      'Plot Travel Route',
      'Cancel',
    ]);
    expect(selection.plan()).toEqual({ soldiers: [1, 2], squads: [0], vehicles: [] });
  });

  it('picks the movable mercs of a squad, reports the first refusal and leaves the squad itself behind', () => {
    const selection = new MoveSelection([
      member(1),
      member(2, { refusal: 'tooTired' }),
      member(3, { refusal: 'tooInjured', listed: false }),
    ]);
    expect(selection.toggleSquad(0)).toEqual({ refusal: 'tooTired' });
    expect(selection.plan()).toEqual({ soldiers: [1], squads: [], vehicles: [] });
  });

  it('takes the squad along when its last listed merc is picked, keeps it when one stays and drops it with its last mover', () => {
    const selection = new MoveSelection([member(1), member(2)]);
    selection.toggleSoldier(1);
    expect(selection.squadMoving(0)).toBe(false);
    selection.toggleSoldier(2);
    expect(selection.squadMoving(0)).toBe(true);
    selection.toggleSoldier(1);
    expect(selection.plan()).toEqual({ soldiers: [2], squads: [0], vehicles: [] });
    selection.toggleSoldier(2);
    expect(selection.anythingSelected()).toBe(false);
  });

  it('refuses to toggle a merc between sectors and reports why a merc cannot be picked', () => {
    const selection = new MoveSelection([member(1, { betweenSectors: true }), member(2, { refusal: 'tooTired' })]);
    expect(selection.toggleSoldier(1)).toEqual({ mapError: MoveError.BETWEEN_SECTORS });
    expect(selection.toggleSoldier(2)).toEqual({ refusal: 'tooTired' });
    expect(selection.anythingSelected()).toBe(false);
  });

  it('moves a vehicle as soon as one passenger does', () => {
    const passenger = { squad: null, vehicle: 7, assignment: Assignment.VEHICLE };
    const selection = new MoveSelection([member(1, passenger), member(2, { ...passenger, refusal: 'tooTired' })]);
    expect(selection.toggleVehicle(7)).toEqual({ refusal: 'tooTired' });
    expect(selection.plan()).toEqual({ soldiers: [1], squads: [], vehicles: [7] });
    selection.toggleSoldier(1);
    expect(selection.plan()).toEqual({ soldiers: [], squads: [], vehicles: [] });
  });

  it('selects all others it can and reports pMapErrorString[46] for the rest', () => {
    const other = { squad: null, assignment: Assignment.REPAIR };
    const selection = new MoveSelection([member(1, other), member(2, { ...other, refusal: 'onAssignment' })]);
    expect(selection.toggleOthers()).toEqual({ mapError: MoveError.OTHERS_CANNOT_MOVE });
    expect(selection.plan().soldiers).toEqual([1]);
  });

  it('keeps the original test of the others header, which counts vehicle passengers and skips doctors', () => {
    const doctor = member(1, { squad: null, assignment: Assignment.DOCTOR, refusal: 'onAssignment' });
    const passenger = member(2, { squad: null, vehicle: 7, assignment: Assignment.VEHICLE });
    const selection = new MoveSelection([doctor, passenger]);
    expect(selection.allOthersSelected()).toBe(false);
    selection.toggleVehicle(7);
    expect(selection.allOthersSelected()).toBe(true);
    expect(texts(selection)).toContain('*Other*');
  });

  it('orders the listed mercs like the character list and keeps unlisted squad mates for the squad test', () => {
    const merc = (id: number, squad: number | null, life = 50): StrategicMercView =>
      ({ id, name: `M${id}`, assignment: squad ?? Assignment.DOCTOR, squad, betweenSectors: false, life }) as unknown as StrategicMercView;
    const view = { mercs: [merc(1, 0), merc(2, 0), merc(3, null), merc(4, 0, 10)] } as unknown as StrategicView;
    const members = moveMembers(
      view,
      [3, 2, 1, 4],
      [
        { soldier: 1, listed: true },
        { soldier: 2, listed: true },
        { soldier: 3, listed: true, refusal: 'onAssignment' },
        { soldier: 4, listed: false, refusal: 'tooInjured' },
      ],
    );
    expect(members.map((m) => [m.id, m.squad, m.listed, m.refusal])).toEqual([
      [3, null, true, 'onAssignment'],
      [2, 0, true, null],
      [1, 0, true, null],
      [4, 0, false, 'tooInjured'],
    ]);
    const selection = new MoveSelection(members);
    expect(selection.toggleSquad(0)).toEqual({ refusal: 'tooInjured' });
    expect(selection.plan()).toEqual({ soldiers: [2, 1], squads: [], vehicles: [] });
  });
});
