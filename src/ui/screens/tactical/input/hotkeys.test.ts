import { describe, expect, it } from 'vitest';
import type { UiKeyEvent } from '../../../input/events.ts';
import { type HotkeyHost, handleTacticalKey, KEY_MASK } from './hotkeys.ts';
import { UiEvent, UiMode } from './ui-events.ts';

interface Recorder {
  readonly host: HotkeyHost;
  readonly calls: string[];
}

type HostState = Partial<Pick<HotkeyHost, 'mode' | 'locked' | 'inCombat' | 'ourTurn' | 'inConversation' | 'itemInCursor' | 'smPanel'>> & {
  readonly held?: readonly string[];
};

function recorder(state: HostState = {}): Recorder {
  const calls: string[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push(args.length > 0 ? `${name}(${args.join(',')})` : name);
    };
  const known: Record<string, unknown> = {
    mode: UiMode.MOVE_MODE,
    locked: false,
    inCombat: false,
    ourTurn: true,
    inConversation: false,
    itemInCursor: false,
    smPanel: false,
    ...state,
    smButtonEnabled: () => true,
    keyHeld: (key: string) => state.held?.includes(key) === true,
    hasSelected: () => true,
    closeMenu: () => {
      calls.push('closeMenu');
      return true;
    },
    dismissFeedback: () => false,
  };
  const host = new Proxy(known, { get: (target, key: string) => (key in target ? target[key] : record(key)) }) as unknown as HotkeyHost;
  return { host, calls };
}

const down = (key: string, modifiers = 0): UiKeyEvent => ({ kind: 'keyDown', key, code: '', modifiers });
const up = (key: string, modifiers = 0): UiKeyEvent => ({ kind: 'keyUp', key, code: '', modifiers });

describe('the gameplay keys of Turn_Based_Input.cc', () => {
  it('maps the plain keys to their actions and events', () => {
    const r = recorder();
    expect(handleTacticalKey(r.host, down('Tab'), UiEvent.M_ON_TERRAIN)).toBe(UiEvent.I_CHANGELEVEL);
    expect(handleTacticalKey(r.host, down('l'), UiEvent.M_ON_TERRAIN)).toBe(UiEvent.LC_CHANGE_TO_LOOK);
    expect(handleTacticalKey(r.host, down('u'), UiEvent.M_ON_TERRAIN)).toBe(UiEvent.M_CHANGE_TO_ACTION);
    for (const key of ['c', 'p', 's', 'z', 'b', 'x', 'Insert', '3', '0', 'F2', 'PageUp', 'PageDown', 'j', '='])
      handleTacticalKey(r.host, down(key), UiEvent.M_ON_TERRAIN);
    expect(r.calls).toEqual([
      'stance(crouch)',
      'stance(prone)',
      'stance(stand)',
      'stealth(false)',
      'weaponMode',
      'swapPlaces',
      'overheadMap',
      'selectSquad(2)',
      'selectSquad(9)',
      'selectSlot(1,true)',
      'higherStance',
      'lowerStance',
      'climb',
      'selectAllInSector',
    ]);
  });

  it('maps the modified keys', () => {
    const r = recorder();
    handleTacticalKey(r.host, down('F3', KEY_MASK.SHIFT), UiEvent.M_ON_TERRAIN);
    handleTacticalKey(r.host, down('j', KEY_MASK.SHIFT), UiEvent.M_ON_TERRAIN);
    handleTacticalKey(r.host, down('q', KEY_MASK.CTRL), UiEvent.M_ON_TERRAIN);
    handleTacticalKey(r.host, down('z', KEY_MASK.ALT), UiEvent.M_ON_TERRAIN);
    handleTacticalKey(r.host, down('r', KEY_MASK.ALT), UiEvent.M_ON_TERRAIN);
    handleTacticalKey(r.host, down('r', KEY_MASK.CTRL | KEY_MASK.SHIFT), UiEvent.M_ON_TERRAIN);
    expect(r.calls).toEqual(['selectSlot(2,false)', 'climbWindow', 'swapHands', 'stealth(true)', 'reload(false)', 'reload(true)']);
  });

  it('resizes the cover display with Delete held and the sight display with End held, and selects nobody then', () => {
    const r = recorder({ held: ['Delete'] });
    handleTacticalKey(r.host, down('='), UiEvent.M_ON_TERRAIN);
    handleTacticalKey(r.host, down('-'), UiEvent.M_ON_TERRAIN);
    const both = recorder({ held: ['End', 'Delete'] });
    handleTacticalKey(both.host, down('='), UiEvent.M_ON_TERRAIN);
    const none = recorder();
    handleTacticalKey(none.host, down('-'), UiEvent.M_ON_TERRAIN);
    expect([r.calls, both.calls, none.calls]).toEqual([['resizeCover(1)', 'resizeCover(-1)'], ['resizeCover(1)', 'resizeSight(1)'], []]);
  });

  it('switches the head gear with CTRL+N, lowers the music with ALT+- and quick saves and loads with ALT+S and ALT+L', () => {
    const r = recorder();
    handleTacticalKey(r.host, down('n', KEY_MASK.CTRL), UiEvent.M_ON_TERRAIN);
    for (const key of ['-', 's', 'l']) handleTacticalKey(r.host, down(key, KEY_MASK.ALT), UiEvent.M_ON_TERRAIN);
    handleTacticalKey(r.host, down('*'), UiEvent.M_ON_TERRAIN);
    expect(r.calls).toEqual(['switchHeadGear', 'musicDown', 'quickSave', 'quickLoad', 'toggleRedItemGlow']);
    const talking = recorder({ inConversation: true });
    for (const key of ['s', 'l']) handleTacticalKey(talking.host, down(key, KEY_MASK.ALT), UiEvent.M_ON_TERRAIN);
    expect(talking.calls).toEqual([]);
  });

  it('lets only ESC through the UI lock and ends the turn only on our turn in combat', () => {
    const locked = recorder({ locked: true, inCombat: true });
    expect(handleTacticalKey(locked.host, down('Escape'), UiEvent.LU_ON_TERRAIN)).toBe(UiEvent.A_CHANGE_TO_MOVE);
    handleTacticalKey(locked.host, down('c'), UiEvent.LU_ON_TERRAIN);
    expect(locked.calls).toEqual(['cancelSpread', 'closePopups', 'stopSelected']);
    const combat = recorder({ inCombat: true });
    expect(handleTacticalKey(combat.host, down('d'), UiEvent.M_ON_TERRAIN)).toBe(UiEvent.I_ENDTURN);
    const peace = recorder();
    expect(handleTacticalKey(peace.host, down('d'), UiEvent.M_ON_TERRAIN)).toBe(UiEvent.M_ON_TERRAIN);
  });

  it('closes a menu on the ESC key release in the menu modes and ignores the other keys there', () => {
    const r = recorder({ mode: UiMode.MENU_MODE });
    expect(handleTacticalKey(r.host, down('c'), UiEvent.U_MOVEMENT_MENU)).toBe(UiEvent.U_MOVEMENT_MENU);
    expect(handleTacticalKey(r.host, up('Escape'), UiEvent.U_MOVEMENT_MENU)).toBe(UiEvent.A_CHANGE_TO_MOVE);
    expect(r.calls).toEqual(['closeMenu']);
  });
});
