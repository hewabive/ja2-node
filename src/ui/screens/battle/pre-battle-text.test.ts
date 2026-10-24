import { describe, expect, it } from 'vitest';
import { KEY_TEXT } from '../../../../tests/support/map-screen.ts';
import {
  buttonStates,
  conditionText,
  departureText,
  enemyLabel,
  gravityPercentage,
  headerBlinks,
  headerColour,
  headerText,
  pbiTransition,
} from './pre-battle-text.ts';

describe('the pre-battle header', () => {
  it('names the encounter, BATTLE IN PROGRESS for the summary, and blinks for the summary and the ambushes', () => {
    expect(headerText(KEY_TEXT, true, 'enemyInvasion')).toBe('gpStrategicString[29]');
    expect(headerText(KEY_TEXT, true, 'enemyAmbush')).toBe('gpStrategicString[30]');
    expect(headerText(KEY_TEXT, false, 'enemyInvasion')).toBe('gzNonPersistantPBIText[8]');
    expect(headerBlinks(false, 'enemyEncounter', false)).toBe(true);
    expect(headerBlinks(true, 'enemyAmbush', false)).toBe(false);
    expect(headerBlinks(true, 'enemyAmbush', true)).toBe(true);
    expect(headerBlinks(true, 'enemyEncounter', true)).toBe(false);
    expect(headerColour(false, 100)).toBe('beige');
    expect(headerColour(true, 1666)).toBe('white');
    expect(headerColour(true, 1667)).toBe('ltRed');
    expect(enemyLabel(KEY_TEXT, 'creatureAttack')).toBe('gpStrategicString[39]');
    expect(enemyLabel(KEY_TEXT, 'bloodcatAmbush')).toBe('gpStrategicString[36]');
  });
});

describe('the pre-battle buttons', () => {
  it('give the persistent fast help by state and the plural retreat help for several groups', () => {
    const options = [
      { choice: 'autoresolve', enabled: false, reason: 'playerInitiatedAttack' },
      { choice: 'enterSector', enabled: true },
      { choice: 'retreat', enabled: true },
    ];
    expect(buttonStates(KEY_TEXT, true, options, 1)).toEqual([
      { choice: 'autoresolve', enabled: false, help: 'gpStrategicString[60]' },
      { choice: 'enterSector', enabled: true, help: 'gpStrategicString[61]' },
      { choice: 'retreat', enabled: true, help: 'gpStrategicString[62]' },
    ]);
    expect(buttonStates(KEY_TEXT, true, options, 2)[2]?.help).toBe('gpStrategicString[63]');
    const ambush = [
      { choice: 'autoresolve', enabled: false, reason: 'ambush' },
      { choice: 'enterSector', enabled: true },
      { choice: 'retreat', enabled: false, reason: 'ambush' },
    ];
    expect(buttonStates(KEY_TEXT, true, ambush, 1).map((b) => b.help)).toEqual([
      'gzNonPersistantPBIText[3]',
      'gpStrategicString[61]',
      'gzNonPersistantPBIText[9]',
    ]);
  });

  it('give the summary its own fast help by the explicit reason', () => {
    const summary = (reason?: string) => [
      reason ? { choice: 'autoresolve', enabled: false, reason } : { choice: 'autoresolve', enabled: true },
      { choice: 'enterSector', enabled: true },
      { choice: 'retreat', enabled: false, reason: 'battleInProgress' },
      { choice: 'close', enabled: true },
    ];
    expect(buttonStates(KEY_TEXT, false, summary(), 1).map((b) => b.help)).toEqual([
      'gzNonPersistantPBIText[2]',
      'gzNonPersistantPBIText[1]',
      'gzNonPersistantPBIText[0]',
    ]);
    expect(buttonStates(KEY_TEXT, false, summary('ambush'), 1)[0]).toEqual({
      choice: 'autoresolve',
      enabled: false,
      help: 'gzNonPersistantPBIText[4]',
    });
    expect(buttonStates(KEY_TEXT, false, summary('hostileCivilians'), 1)[0]?.help).toBe('gzNonPersistantPBIText[6]');
    expect(buttonStates(KEY_TEXT, false, summary('bloodcats'), 1)[0]?.help).toBe('gzNonPersistantPBIText[7]');
  });
});

describe('the pre-battle rows', () => {
  it('print the condition words and the departure as GetMapscreenMercDepartureString does', () => {
    expect(conditionText(KEY_TEXT, 'excellent')).toBe('pConditionStrings[0]');
    expect(conditionText(KEY_TEXT, 'dying')).toBe('pConditionStrings[7]');
    expect(departureText(KEY_TEXT, null)).toBe('gpStrategicString[43]');
    expect(departureText(KEY_TEXT, 3 * 1440)).toBe('3gpStrategicString[44]');
    expect(departureText(KEY_TEXT, 3 * 1440 - 1)).toBe('72gpStrategicString[45]');
    expect(departureText(KEY_TEXT, 5)).toBe('0gpStrategicString[45]');
    expect(departureText(KEY_TEXT, 61)).toBe('2gpStrategicString[45]');
  });
});

describe('the pre-battle opening stretch', () => {
  it('factors the time by the gravity curve of DoTransitionFromMapscreenToPreBattleInterface', () => {
    expect([0, 250, 400, 500, 750, 990, 1000].map(gravityPercentage)).toEqual([0, 13, 32, 50, 87, 100, 100]);
  });

  it('starts as a dot on the sector, ends on the panel and is done at 100 %', () => {
    const start = { x: 500, y: 100 };
    const origin = { x: 0, y: 0 };
    expect(pbiTransition(start, origin, 0)).toEqual({ done: false, rect: { x: 500, y: 100, width: 1, height: 1 } });
    expect(pbiTransition(start, origin, 500)).toEqual({ done: false, rect: { x: 250, y: 51, width: 130, height: 179 } });
    expect(pbiTransition(start, origin, 1000)).toEqual({ done: true, rect: { x: 0, y: 2, width: 261, height: 359 } });
  });
});
