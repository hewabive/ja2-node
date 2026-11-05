import { describe, expect, it } from 'vitest';
import type { StrategicVehicleView } from '../../../protocol/view.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { vehicleUnderRepairName } from './info-panel.ts';

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
