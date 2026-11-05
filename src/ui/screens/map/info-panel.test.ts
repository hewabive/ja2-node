import { describe, expect, it } from 'vitest';
import type { StrategicMercView, StrategicVehicleView, StrategicView } from '../../../protocol/view.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { characterName } from './character-list.ts';
import { characterNames, vehicleUnderRepairName } from './info-panel.ts';

const HUMMER_TYPE = 1;
const HUMMER_ID = 2;
const HUMMER_SOLDIER_ID = 118;

const text: UiTextService = {
  string: (table, index) => `${table}[${index}]`,
  edt: () => null,
};

const hummer = { id: HUMMER_ID, type: HUMMER_TYPE } as unknown as StrategicVehicleView;

describe('the repair target on the map screen (MapScreen.cc DrawCharacterInfo)', () => {
  it('names the vehicle under repair by its short name', () => {
    expect(vehicleUnderRepairName(text, [hummer], HUMMER_ID)).toBe('pShortVehicleStrings[1]');
  });

  it('prints no name for the soldier id the toolkit stores, which names no vehicle (deviation "Toolkit repair in tactical")', () => {
    expect(vehicleUnderRepairName(text, [hummer], HUMMER_SOLDIER_ID)).toBe('');
  });
});

describe('the name of a vehicle on the map screen (MapScreen.cc DrawName, DrawCharacterInfo)', () => {
  const vehicle = { id: HUMMER_SOLDIER_ID, name: 'Hummer the profile', kind: 'vehicle', vehicle: HUMMER_ID } as StrategicMercView;
  const merc = { id: 3, name: 'Ivan', vehicle: HUMMER_ID } as StrategicMercView;
  const view = { mercs: [vehicle, merc], vehicles: [hummer] } as unknown as StrategicView;

  it('names a vehicle in the character list by zVehicleName of its type, and a merc aboard by his own name', () => {
    expect([characterName(text, view, vehicle), characterName(text, view, merc)]).toEqual(['zVehicleName[1]', 'Ivan']);
  });

  it("names a vehicle in the info panel by its type's short and full names, never its profile's, and a merc by his", () => {
    expect(characterNames(text, view, vehicle, 'Profile Name')).toEqual({
      nickname: 'pShortVehicleStrings[1]',
      name: 'pVehicleStrings[1]',
    });
    expect(characterNames(text, view, merc, 'Ivan Dolvich')).toEqual({ nickname: 'Ivan', name: 'Ivan Dolvich' });
  });
});
