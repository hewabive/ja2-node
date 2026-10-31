import { DROP_DOWN_ARROW_FRAMES, DROP_DOWN_BORDER_PIECES } from '../widgets/drop-down.ts';
import { POPUP_BORDER_PIECES } from '../widgets/popup-box.ts';
import { bindingRoot, parseAction } from './controller.ts';
import type { LayoutModel, ResolvedAsset } from './model.ts';
import type { NumberExpr, StubFrameState, TextSourceJson, WidgetJson } from './types.ts';

export interface AssetUse {
  readonly asset: ResolvedAsset;
  readonly frames: Map<number, StubFrameState>;
  readonly roles: Set<string>;
}

export interface LayoutReferences {
  readonly assets: Map<string, AssetUse>;
  readonly fonts: Set<string>;
  readonly cursors: Set<string>;
  readonly strings: [string, number][];
  readonly edts: [string, number][];
  readonly bindings: Set<string>;
  readonly actions: Set<string>;
  readonly literals: string[];
  readonly problems: string[];
}

type JsonObject = Readonly<Record<string, unknown>>;

const BUTTON_STATES: Readonly<Record<string, StubFrameState>> = {
  offNormal: 'normal',
  offHilite: 'hover',
  onNormal: 'pressed',
  onHilite: 'pressedHover',
  grayed: 'grayed',
};
const ACTION_KEYS = [
  'primary',
  'secondary',
  'wheelUp',
  'wheelDown',
  'hover',
  'press',
  'down',
  'doubleClick',
  'repeat',
  'secondaryRepeat',
  'select',
  'close',
  'change',
  'result',
  'focus',
] as const;
const CONDITION_KEYS = ['visible', 'enabled', 'checked', 'open'] as const;
const BINDING_KEYS = ['value'] as const;
const FONT_KEYS = ['font'] as const;
const TEXT_KEYS = ['text', 'tooltip'] as const;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function collectReferences(model: LayoutModel): LayoutReferences {
  const refs: LayoutReferences = {
    assets: new Map(),
    fonts: new Set(),
    cursors: new Set(),
    strings: [],
    edts: [],
    bindings: new Set(),
    actions: new Set(),
    literals: [],
    problems: [],
  };
  const fail = (where: string, error: unknown) => refs.problems.push(`${model.json.screen} ${where}: ${(error as Error).message}`);
  const useAsset = (name: string, frame: number | null, state: StubFrameState, role: string) => {
    try {
      const asset = model.asset(name);
      const use = refs.assets.get(name) ?? { asset, frames: new Map(), roles: new Set() };
      if (frame !== null && frame >= 0 && (!use.frames.has(frame) || use.frames.get(frame) === 'plain')) use.frames.set(frame, state);
      use.roles.add(role);
      refs.assets.set(name, use);
    } catch (error) {
      fail(`asset ${name}`, error);
    }
  };
  const staticNumber = (expr: unknown, vars: Readonly<Record<string, number>>): number | null => {
    if (expr === undefined) return 0;
    if (typeof expr === 'object') return null;
    try {
      return model.number(expr as NumberExpr, vars);
    } catch {
      return null;
    }
  };
  const binding = (path: unknown) => {
    if (typeof path === 'string' && path.length > 0) refs.bindings.add(bindingRoot(path));
  };
  const condition = (value: unknown) => {
    if (typeof value === 'string') binding(value);
    else if (isRecord(value)) {
      if (Array.isArray(value.eq)) binding(value.eq[0]);
      if ('not' in value) condition(value.not);
    }
  };
  const action = (value: unknown, where: string) => {
    if (typeof value !== 'string') return;
    try {
      refs.actions.add(parseAction(value.replace(/\$i\b/g, '0')).name);
    } catch (error) {
      fail(where, error);
    }
  };
  const choiceBindings = (value: unknown) => {
    if (!isRecord(value)) return;
    if (Object.keys(value).length === 1 && typeof value.bind === 'string') binding(value.bind);
    if (typeof value.by === 'string' && isRecord(value.map)) binding(value.by);
    for (const child of Object.values(value)) if (isRecord(child)) choiceBindings(child);
  };
  const choiceFrames = (expr: unknown, vars: Readonly<Record<string, number>>): (number | null)[] =>
    isRecord(expr) && isRecord(expr.map) ? Object.values(expr.map).map((v) => staticNumber(v, vars)) : [staticNumber(expr, vars)];
  const choiceAssets = (asset: unknown): string[] =>
    typeof asset === 'string'
      ? [asset]
      : isRecord(asset) && isRecord(asset.map)
        ? Object.values(asset.map).filter((v) => typeof v === 'string')
        : [];
  const text = (source: unknown, vars: Readonly<Record<string, number>>) => {
    if (source === undefined) return;
    if (typeof source === 'string') {
      refs.literals.push(source);
      return;
    }
    if (!isRecord(source)) return;
    const s = source as TextSourceJson & JsonObject;
    if ('literal' in s) refs.literals.push(String(s.literal));
    if ('bind' in s) binding(s.bind);
    if ('money' in s && isRecord(s.money)) binding((s.money as { bind?: unknown }).bind);
    if ('key' in s && Array.isArray(s.key)) {
      const index = staticNumber(s.key[1], vars);
      if (index === null) fail('string key', new Error(`index ${JSON.stringify(s.key[1])} is not a constant`));
      else refs.strings.push([String(s.key[0]), index]);
    }
    if ('edt' in s && Array.isArray(s.edt)) {
      const row = staticNumber(s.edt[1], vars);
      if (row !== null) refs.edts.push([String(s.edt[0]), row]);
      else if (isRecord(s.edt[1])) binding(s.edt[1].bind);
    }
    if ('format' in s) {
      text(s.format, vars);
      if (Array.isArray(s.args)) for (const a of s.args) if (typeof a !== 'number') text(a, vars);
    }
  };
  const widget = (json: WidgetJson, vars: Readonly<Record<string, number>>) => {
    const where = json.id ?? json.type;
    for (const key of ACTION_KEYS) action(json[key], `${where}.${key}`);
    for (const key of CONDITION_KEYS) condition(json[key]);
    for (const key of BINDING_KEYS) binding(json[key]);
    for (const key of FONT_KEYS) if (typeof json[key] === 'string') refs.fonts.add(json[key] as string);
    for (const key of TEXT_KEYS) text(json[key], vars);
    for (const value of Object.values(json)) choiceBindings(value);
    if (isRecord(json.fit)) {
      text(json.fit.text, vars);
      if (typeof json.fit.font === 'string') refs.fonts.add(json.fit.font);
    }
    if (typeof json.cursor === 'string') refs.cursors.add(json.cursor);
    else if (isRecord(json.cursor) && isRecord(json.cursor.map))
      for (const name of Object.values(json.cursor.map)) if (typeof name === 'string') refs.cursors.add(name);
    if (typeof json.lines === 'string') binding(json.lines);
    else if (Array.isArray(json.lines)) for (const line of json.lines) text(isRecord(line) && 'text' in line ? line.text : line, vars);
    switch (json.type) {
      case 'image':
        for (const name of choiceAssets(json.asset))
          for (const frame of choiceFrames(json.frame, vars)) useAsset(name, frame, 'plain', 'image');
        break;
      case 'button': {
        if (typeof json.asset === 'string') {
          const frames = isRecord(json.frames) ? json.frames : {};
          for (const [key, state] of Object.entries(BUTTON_STATES))
            if (frames[key] !== undefined) useAsset(json.asset, staticNumber(frames[key], vars), state, 'button');
        }
        if (isRecord(json.text)) {
          text(json.text.source, vars);
          if (typeof json.text.font === 'string') refs.fonts.add(json.text.font);
        }
        if (isRecord(json.icon) && typeof json.icon.asset === 'string')
          useAsset(json.icon.asset, staticNumber(json.icon.frame, vars), 'plain', 'icon');
        if (isRecord(json.icon)) condition(json.icon.visible);
        break;
      }
      case 'frame':
      case 'popupMenu':
        if (typeof json.border === 'string') for (const piece of POPUP_BORDER_PIECES) useAsset(json.border, piece, 'plain', 'border');
        if (typeof json.background === 'string') useAsset(json.background, 0, 'plain', 'background');
        if (json.type === 'popupMenu' && typeof json.font === 'string') refs.fonts.add(json.font);
        break;
      case 'slider':
        if (typeof json.thumb === 'string') useAsset(json.thumb, 0, 'plain', 'thumb');
        break;
      case 'dropDown':
        binding(json.model);
        binding(json.labels);
        if (typeof json.border === 'string') for (const piece of DROP_DOWN_BORDER_PIECES) useAsset(json.border, piece, 'plain', 'border');
        if (isRecord(json.scroll) && typeof json.scroll.arrows === 'string')
          for (const frame of DROP_DOWN_ARROW_FRAMES) useAsset(json.scroll.arrows, frame, 'plain', 'arrows');
        if (typeof json.scrollCursor === 'string') refs.cursors.add(json.scrollCursor);
        break;
      case 'tiles':
        if (typeof json.asset === 'string') useAsset(json.asset, staticNumber(json.frame, vars), 'plain', 'image');
        break;
      case 'portrait':
      case 'itemPicture':
        binding(json.type === 'portrait' ? json.state : json.graphic);
        break;
      case 'group':
        binding(json.value);
        break;
      case 'list':
      case 'repeat': {
        const count = staticNumber(json.count, vars);
        const start = staticNumber(json.start, vars) ?? 0;
        const templates = (Array.isArray(json.template) ? json.template : [json.template]) as WidgetJson[];
        const n = count ?? 1;
        for (let i = start; i < start + Math.max(1, n); i++) for (const template of templates) widget(template, { ...vars, i });
        break;
      }
    }
  };
  for (const json of model.json.widgets ?? []) widget(json, {});
  for (const hotkey of model.json.hotkeys ?? []) {
    if (hotkey.action !== undefined) action(hotkey.action, `hotkey ${hotkey.key}`);
    if (hotkey.when) binding(hotkey.when);
  }
  const visit = (value: unknown) => {
    if (typeof value === 'string' && model.assets.has(value)) useAsset(value, null, 'plain', 'style');
    else if (Array.isArray(value)) for (const v of value) visit(v);
    else if (isRecord(value)) {
      for (const [key, v] of Object.entries(value)) {
        if (key === 'cursor' && typeof v === 'string') refs.cursors.add(v);
        visit(v);
      }
    }
  };
  visit(model.json.styles ?? {});
  for (const [name, asset] of model.assets)
    if (!refs.assets.has(name)) refs.assets.set(name, { asset, frames: new Map(), roles: new Set(['declared']) });
  return refs;
}
