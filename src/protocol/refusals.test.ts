import { describe, expect, it } from 'vitest';
import { refusalMessage, refusalSoldierOf } from './refusals.ts';

describe('refusal messages', () => {
  it("box a move refused in the museum with ME_MUSEUM's map error and one during a bloodcat ambush with ME_COMBAT's", () => {
    expect(refusalMessage('museumChalice')).toEqual({ table: 'pMapErrorString', index: 34, shown: 'box' });
    expect(refusalMessage('inCombat')).toEqual({ table: 'pMapErrorString', index: 11, shown: 'box' });
  });

  it("boxes a vehicle's move with an empty tank with ME_VEHICLE_NO_GAS's map error", () => {
    expect(refusalMessage('vehicleNoGas')).toEqual({ table: 'pMapErrorString', index: 42, shown: 'box' });
  });

  it('logs VEHICLE_CANT_MOVE_IN_TACTICAL for a move click with a vehicle selected', () => {
    expect(refusalMessage('vehicleCantMove')).toEqual({ table: 'TacticalStr', index: 128, shown: 'log' });
  });
});

describe("BeginAutoBandage's OK boxes", () => {
  it('boxes the sector not cleared, AUTOBANDAGE_NOT_NEEDED, STR_LATE_09 and CANT_AUTOBANDAGE_PROMPT', () => {
    expect(refusalMessage('sectorNotCleared')).toEqual({ table: 'Message', index: 44, shown: 'box' });
    expect(refusalMessage('nobodyToBandage')).toEqual({ table: 'TacticalStr', index: 116, shown: 'box' });
    expect(refusalMessage('noMedKit')).toEqual({ table: 'gzLateLocalizedString', index: 8, shown: 'box' });
    expect(refusalMessage('cannotAutoBandage')).toEqual({ table: 'TacticalStr', index: 129, shown: 'box' });
  });

  it('has no message for the orders the mode masks, as no input reaches the game then', () => {
    expect(refusalMessage('autoBandaging')).toBeNull();
    expect(refusalMessage('notAutoBandaging')).toBeNull();
  });
});

describe('the exchange of places (CanExchangePlaces)', () => {
  it('logs STR_LATE_03 for an NPC with a profile and REFUSE_EXCHANGE_PLACES for anyone else', () => {
    expect(refusalMessage('npcRefusesToMove')).toEqual({ table: 'gzLateLocalizedString', index: 2, shown: 'log' });
    expect(refusalMessage('personRefusesToMove')).toEqual({ table: 'TacticalStr', index: 119, shown: 'log' });
    expect(refusalMessage('cannotExchange')).toBeNull();
  });
});

describe('talk to Dimitri on our team (Handle_UI.cc HandleTalkInit)', () => {
  it('logs STR_LATE_32', () => {
    expect(refusalMessage('refusesToTalk')).toEqual({ table: 'gzLateLocalizedString', index: 31, shown: 'log' });
  });
});

describe("the escort's lone move (CanCharacterMoveInStrategic, ME_CUSTOM)", () => {
  it('boxes pMapErrorString 6 for a male escort and 7 for a female one', () => {
    expect(refusalMessage('escortAlone')).toEqual({ table: 'pMapErrorString', index: 6, shown: 'box' });
    expect(refusalMessage('escortAlone', true)).toEqual({ table: 'pMapErrorString', index: 7, shown: 'box' });
    expect(refusalMessage('tooTired', true)).toEqual({ table: 'pMapErrorString', index: 43, shown: 'box' });
  });

  it('reads the soldier a refusal names', () => {
    expect(refusalSoldierOf({ refusal: 'escortAlone', soldier: 11 })).toBe(11);
    expect(refusalSoldierOf({ refusal: 'noPath' })).toBeNull();
  });
});
