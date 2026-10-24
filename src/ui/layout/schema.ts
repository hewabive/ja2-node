import { validateHotkey } from '../input/hotkeys.ts';
import { ANCHOR_NAMES, FRAME_NAMES, type LayoutJson } from './types.ts';

type Kind =
  | 'number'
  | 'string'
  | 'boolean'
  | 'condition'
  | 'text'
  | 'action'
  | 'binding'
  | 'asset'
  | 'assetChoice'
  | 'font'
  | 'color'
  | 'cursor'
  | 'object'
  | 'array'
  | 'widgets'
  | 'anchor'
  | 'frame'
  | 'centerX'
  | 'any';

const COMMON: Readonly<Record<string, Kind>> = {
  type: 'string',
  id: 'string',
  x: 'number',
  y: 'number',
  anchor: 'anchor',
  within: 'frame',
  centerX: 'centerX',
  visible: 'condition',
};

const BOX: Readonly<Record<string, Kind>> = { width: 'number', height: 'number' };

const INPUT: Readonly<Record<string, Kind>> = {
  priority: 'number',
  cursor: 'cursor',
  tooltip: 'text',
  enabled: 'condition',
  allowDisabledTooltip: 'boolean',
  primary: 'action',
  secondary: 'action',
  wheelUp: 'action',
  wheelDown: 'action',
  hover: 'action',
  press: 'action',
  down: 'action',
  doubleClick: 'action',
};

export const WIDGET_PROPERTIES: Readonly<Record<string, Readonly<Record<string, Kind>>>> = {
  image: { asset: 'assetChoice', frame: 'number', shade: 'object', effect: 'string', outline: 'color', clip: 'array', center: 'boolean' },
  fill: { ...BOX, color: 'color' },
  shade: { ...BOX, factor: 'number' },
  hatch: { ...BOX, pattern: 'string', color: 'color' },
  line: { x2: 'number', y2: 'number', color: 'color' },
  rect: { x2: 'number', y2: 'number', color: 'color' },
  text: {
    ...BOX,
    text: 'text',
    font: 'font',
    color: 'color',
    shadow: 'color',
    background: 'color',
    align: 'string',
    alignRule: 'string',
    valign: 'string',
    wrap: 'object',
    ian: 'boolean',
    ellipsis: 'boolean',
    shadowed: 'boolean',
  },
  frame: { ...BOX, border: 'asset', background: 'asset' },
  textBox: {
    text: 'text',
    style: 'string',
    width: 'number',
    marginX: 'number',
    marginTop: 'number',
    marginBottom: 'number',
    icon: 'string',
  },
  region: { ...BOX, ...INPUT, animatesCursor: 'boolean', flashesCursor: 'boolean', mouseText: 'boolean', fit: 'object' },
  button: {
    ...BOX,
    ...INPUT,
    kind: 'string',
    asset: 'asset',
    frames: 'object',
    checked: 'condition',
    text: 'object',
    icon: 'object',
    disabledStyle: 'string',
    sound: 'string',
  },
  group: { members: 'array', value: 'binding', select: 'action' },
  slider: {
    style: 'string',
    length: 'number',
    steps: 'number',
    thumb: 'asset',
    priority: 'number',
    cursor: 'cursor',
    value: 'binding',
    change: 'action',
  },
  textField: {
    ...BOX,
    maxLength: 'number',
    filter: 'string',
    priority: 'number',
    value: 'binding',
    change: 'action',
    font: 'font',
    scheme: 'object',
  },
  popupMenu: {
    width: 'number',
    border: 'asset',
    background: 'asset',
    font: 'font',
    margins: 'array',
    lineSpace: 'number',
    lines: 'any',
    colors: 'object',
    secondColors: 'object',
    shadow: 'color',
    minWidth: 'number',
    secondColumnOffset: 'number',
    center: 'boolean',
    resize: 'boolean',
    open: 'condition',
    select: 'action',
    close: 'action',
    priority: 'number',
  },
  list: { count: 'number', start: 'number', dx: 'number', dy: 'number', template: 'widgets' },
  repeat: { count: 'number', start: 'number', dx: 'number', dy: 'number', template: 'widgets' },
  progressBar: { ...BOX, style: 'string', color: 'color', value: 'number' },
  modal: { style: 'number', text: 'text', buttons: 'number', open: 'condition', result: 'action', centering: 'array' },
  custom: { ...BOX, renderer: 'string', params: 'object' },
  tiles: { asset: 'asset', frame: 'number', columns: 'number', rows: 'number', dx: 'number', dy: 'number' },
  portrait: { face: 'number', size: 'string', state: 'binding', shadeWidth: 'number', shadeHeight: 'number' },
  itemPicture: { ...BOX, graphic: 'binding', shadow: 'condition' },
};

const TOP_LEVEL = new Set([
  '@derived',
  '@src',
  'screen',
  'frame',
  'debug',
  'constants',
  'assets',
  'styles',
  'widgets',
  'hotkeys',
  'tooltips',
  'sound',
  'unsupported',
]);

export class LayoutSchemaError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isChoice(value: unknown): boolean {
  return isRecord(value) && typeof value.by === 'string' && isRecord(value.map);
}

function checkKind(kind: Kind, value: unknown, where: string, problems: string[]): void {
  const bad = (what: string) => problems.push(`${where}: expected ${what}`);
  switch (kind) {
    case 'number':
      if (
        typeof value !== 'number' &&
        typeof value !== 'string' &&
        !(isRecord(value) && typeof value.bind === 'string') &&
        !isChoice(value)
      )
        bad('a number, a constant expression, {bind} or {by, map}');
      return;
    case 'string':
    case 'action':
    case 'binding':
    case 'asset':
    case 'font':
      if (typeof value !== 'string' || value.length === 0) bad('a non-empty string');
      return;
    case 'cursor':
      if (!(typeof value === 'string' && value.length > 0) && !isChoice(value)) bad('a cursor name or {by, map}');
      return;
    case 'assetChoice':
      if (!(typeof value === 'string' && value.length > 0) && !isChoice(value)) bad('an asset name or {by, map}');
      return;
    case 'anchor':
      if (typeof value !== 'string' || !(ANCHOR_NAMES as readonly string[]).includes(value)) bad(`one of ${ANCHOR_NAMES.join(', ')}`);
      return;
    case 'frame':
      if (typeof value !== 'string' || !(FRAME_NAMES as readonly string[]).includes(value)) bad(`one of ${FRAME_NAMES.join(', ')}`);
      return;
    case 'centerX':
      if (typeof value !== 'boolean' && value !== 'screen') bad('a boolean or "screen"');
      return;
    case 'boolean':
      if (typeof value !== 'boolean') bad('a boolean');
      return;
    case 'condition':
      if (typeof value !== 'boolean' && typeof value !== 'string' && !(isRecord(value) && (Array.isArray(value.eq) || 'not' in value)))
        bad('a boolean, a binding, "!binding", {eq} or {not}');
      return;
    case 'text':
      if (typeof value !== 'string' && !isRecord(value)) bad('a text source');
      return;
    case 'color':
      if (typeof value !== 'number' && typeof value !== 'string' && !Array.isArray(value) && value !== null && !isChoice(value))
        bad('a colour');
      return;
    case 'object':
      if (!isRecord(value)) bad('an object');
      return;
    case 'array':
      if (!Array.isArray(value)) bad('an array');
      return;
    case 'widgets':
      if (!isRecord(value) && !Array.isArray(value)) bad('a widget or a list of widgets');
      else for (const [i, w] of (Array.isArray(value) ? value : [value]).entries()) checkWidget(w, `${where}[${i}]`, problems);
      return;
    case 'any':
      return;
  }
}

export function checkWidget(value: unknown, where: string, problems: string[]): void {
  if (!isRecord(value)) {
    problems.push(`${where}: a widget is an object`);
    return;
  }
  const type = value.type;
  if (typeof type !== 'string' || !(type in WIDGET_PROPERTIES)) {
    problems.push(`${where}: unknown widget type ${String(type)}`);
    return;
  }
  const properties = { ...COMMON, ...(WIDGET_PROPERTIES[type] ?? {}) };
  for (const [key, child] of Object.entries(value)) {
    const kind = properties[key];
    if (!kind) problems.push(`${where}: ${type} has no property ${key}`);
    else checkKind(kind, child, `${where}.${key}`, problems);
  }
}

export function validateLayout(json: unknown, where = 'layout'): LayoutJson {
  const problems: string[] = [];
  if (!isRecord(json)) throw new LayoutSchemaError(`${where}: a layout is an object`);
  for (const key of Object.keys(json)) if (!TOP_LEVEL.has(key)) problems.push(`${where}: unknown key ${key}`);
  if (typeof json.screen !== 'string' || json.screen.length === 0) problems.push(`${where}: screen names the controller`);
  if (typeof json.frame !== 'string' || !(FRAME_NAMES as readonly string[]).includes(json.frame))
    problems.push(`${where}: frame is one of ${FRAME_NAMES.join(', ')}`);
  if (json.constants !== undefined && (!Array.isArray(json.constants) || json.constants.some((c) => typeof c !== 'string')))
    problems.push(`${where}: constants lists table names`);
  if (json.assets !== undefined) {
    if (!isRecord(json.assets)) problems.push(`${where}: assets is an object`);
    else
      for (const [name, asset] of Object.entries(json.assets)) {
        const kinds = isRecord(asset) ? ['sti', 'pcx', 'mlg'].filter((k) => typeof asset[k] === 'string') : [];
        if (kinds.length !== 1) problems.push(`${where}.assets.${name}: exactly one of sti, pcx or mlg`);
        if (isRecord(asset))
          for (const key of Object.keys(asset))
            if (!['sti', 'pcx', 'mlg', 'stub'].includes(key)) problems.push(`${where}.assets.${name}: unknown key ${key}`);
      }
  }
  if (json.widgets !== undefined) {
    if (!Array.isArray(json.widgets)) problems.push(`${where}: widgets is a list`);
    else for (const [i, w] of json.widgets.entries()) checkWidget(w, `${where}.widgets[${i}]`, problems);
  }
  if (json.hotkeys !== undefined) {
    if (!Array.isArray(json.hotkeys)) problems.push(`${where}: hotkeys is a list`);
    else
      json.hotkeys.forEach((h, i) => {
        try {
          validateHotkey(h, `${where}.hotkeys[${i}]`);
        } catch (error) {
          problems.push((error as Error).message);
        }
      });
  }
  if (json.unsupported !== undefined && (!Array.isArray(json.unsupported) || json.unsupported.some((u) => typeof u !== 'string')))
    problems.push(`${where}: unsupported lists names`);
  if (problems.length > 0) throw new LayoutSchemaError(problems.join('\n'));
  return json as unknown as LayoutJson;
}
