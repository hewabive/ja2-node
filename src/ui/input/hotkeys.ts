import type { UiKeyEvent } from './events.ts';

export type HotkeyPhase = 'down' | 'up' | 'repeat';
export const ANY_MODIFIERS = 'any';

export interface Hotkey {
  readonly key: string;
  readonly on?: HotkeyPhase | readonly HotkeyPhase[];
  readonly mods?: number | typeof ANY_MODIFIERS;
  readonly action?: string;
  readonly args?: readonly number[];
  readonly when?: string;
  readonly focus?: string;
}

export type HotkeyTable = readonly Hotkey[];

const PHASE_OF_KIND: Readonly<Record<UiKeyEvent['kind'], HotkeyPhase>> = { keyDown: 'down', keyUp: 'up', keyRepeat: 'repeat' };
const DEFAULT_PHASE: HotkeyPhase = 'down';
const NO_MODIFIERS = 0;

function phases(hotkey: Hotkey): readonly HotkeyPhase[] {
  const on = hotkey.on ?? DEFAULT_PHASE;
  return typeof on === 'string' ? [on] : on;
}

export function hotkeyMatches(hotkey: Hotkey, event: UiKeyEvent): boolean {
  if (hotkey.key !== event.key) return false;
  if (!phases(hotkey).includes(PHASE_OF_KIND[event.kind])) return false;
  const mods = hotkey.mods ?? NO_MODIFIERS;
  return mods === ANY_MODIFIERS || mods === event.modifiers;
}

export function findHotkey(table: HotkeyTable, event: UiKeyEvent, condition: (name: string) => boolean = () => true): Hotkey | null {
  for (const hotkey of table) {
    if (!hotkeyMatches(hotkey, event)) continue;
    if (hotkey.when !== undefined && !condition(hotkey.when)) continue;
    return hotkey;
  }
  return null;
}

export function validateHotkey(value: unknown, where: string): Hotkey {
  if (typeof value !== 'object' || value === null) throw new Error(`${where}: a hotkey is an object`);
  const h = value as Record<string, unknown>;
  if (typeof h.key !== 'string' || h.key.length === 0) throw new Error(`${where}: a hotkey needs a key`);
  if (h.action !== undefined && (typeof h.action !== 'string' || h.action.length === 0)) throw new Error(`${where}: an action is a name`);
  if (h.action === undefined && h.focus === undefined) throw new Error(`${where}: a hotkey needs an action or a focus`);
  const on = h.on === undefined ? [] : Array.isArray(h.on) ? h.on : [h.on];
  for (const phase of on)
    if (phase !== 'down' && phase !== 'up' && phase !== 'repeat') throw new Error(`${where}: bad phase ${String(phase)}`);
  if (
    h.mods !== undefined &&
    h.mods !== ANY_MODIFIERS &&
    (typeof h.mods !== 'number' || !Number.isInteger(h.mods) || h.mods < 0 || h.mods > 7)
  )
    throw new Error(`${where}: mods is a mask 0-7 or "any"`);
  if (h.when !== undefined && typeof h.when !== 'string') throw new Error(`${where}: when names a binding`);
  if (h.focus !== undefined && typeof h.focus !== 'string') throw new Error(`${where}: focus names a text field`);
  if (h.args !== undefined && (!Array.isArray(h.args) || h.args.some((a) => typeof a !== 'number')))
    throw new Error(`${where}: args are numbers`);
  return h as unknown as Hotkey;
}
