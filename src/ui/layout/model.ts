import { type DataVersion, textVersion } from '../../content/text/data-version.ts';
import { type RgbColor, rgb } from '../draw-list.ts';
import { NO_CURSOR } from '../input/mouse.ts';
import { ButtonSoundScheme } from '../widgets/button-sounds.ts';
import { type ConstantScope, type ConstantTable, ConstantScope as Scope, type Variables } from './constants.ts';
import { getPath } from './controller.ts';
import type { AssetJson, ColorJson, LayoutJson, NumberExpr, StubSpecJson } from './types.ts';

export const MLG_TABLE_PATH = 'tables/mlg.json';

export interface MlgTable {
  readonly ids: readonly string[];
  readonly versions: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export function parseMlgTable(json: unknown): MlgTable {
  const table = json as Partial<MlgTable> | null;
  if (!table || !Array.isArray(table.ids) || typeof table.versions !== 'object' || table.versions === null)
    throw new Error('malformed MLG table');
  return table as MlgTable;
}

export function mlgPath(table: MlgTable, id: string, version: DataVersion): string {
  const path = table.versions[textVersion(version)]?.[id];
  if (!path) throw new Error(`unknown MLG id ${id} for ${version}`);
  return path;
}

export interface LayoutEnvironment {
  readonly tables: ReadonlyMap<string, ConstantTable>;
  readonly mlg: MlgTable;
  readonly dataVersion: DataVersion;
}

export type AssetKind = 'sti' | 'pcx';

export interface ResolvedAsset {
  readonly name: string;
  readonly path: string;
  readonly kind: AssetKind;
  readonly mlg: string | null;
  readonly stub: StubSpecJson | null;
}

const PRIORITY_PREFIX = 'MSYS_PRIORITY_';
const SOUND_PREFIX = 'BUTTON_SOUND_SCHEME_';
const SCHEME_ORDER: readonly ButtonSoundScheme[] = [
  ButtonSoundScheme.NONE,
  ButtonSoundScheme.GENERIC,
  ButtonSoundScheme.VERYSMALLSWITCH1,
  ButtonSoundScheme.VERYSMALLSWITCH2,
  ButtonSoundScheme.SMALLSWITCH1,
  ButtonSoundScheme.SMALLSWITCH2,
  ButtonSoundScheme.SMALLSWITCH3,
  ButtonSoundScheme.BIGSWITCH3,
  ButtonSoundScheme.COMPUTERBEEP2,
  ButtonSoundScheme.COMPUTERSWITCH1,
];
const HEX_COLOR = /^#([0-9a-fA-F]{6})$/;
const NO_CURSOR_NAME = 'MSYS_NO_CURSOR';

function assetPath(asset: AssetJson, env: LayoutEnvironment): { path: string; kind: AssetKind; mlg: string | null } {
  if ('sti' in asset) return { path: asset.sti.toLowerCase(), kind: 'sti', mlg: null };
  if ('pcx' in asset) return { path: asset.pcx.toLowerCase(), kind: 'pcx', mlg: null };
  const path = mlgPath(env.mlg, asset.mlg, env.dataVersion);
  return { path, kind: path.endsWith('.pcx') ? 'pcx' : 'sti', mlg: asset.mlg };
}

export class LayoutModel {
  readonly json: LayoutJson;
  readonly scope: ConstantScope;
  readonly env: LayoutEnvironment;
  readonly assets: ReadonlyMap<string, ResolvedAsset>;

  constructor(json: LayoutJson, env: LayoutEnvironment) {
    this.json = json;
    this.env = env;
    this.scope = new Scope(env.tables, json.constants ?? []);
    const assets = new Map<string, ResolvedAsset>();
    for (const [name, asset] of Object.entries(json.assets ?? {})) {
      assets.set(name, { name, ...assetPath(asset, env), stub: asset.stub ?? null });
    }
    this.assets = assets;
  }

  get debug(): boolean {
    return this.json.debug === true;
  }

  asset(name: string): ResolvedAsset {
    const asset = this.assets.get(name);
    if (!asset) throw new Error(`${this.json.screen}: unknown asset ${name}`);
    return asset;
  }

  number(expression: NumberExpr, variables: Variables = {}, prefix = ''): number {
    if (typeof expression === 'object') throw new Error(`${this.json.screen}: a binding is not a constant (${expression.bind})`);
    return this.scope.number(expression, variables, prefix);
  }

  priority(expression: NumberExpr, variables: Variables = {}): number {
    return this.number(expression, variables, PRIORITY_PREFIX);
  }

  color(value: ColorJson | undefined, fallback: number): number {
    if (value === undefined) return fallback;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return this.number(value);
    throw new Error(`${this.json.screen}: a palette colour is a number or a constant`);
  }

  rgbColor(value: ColorJson | undefined | null, fallback: RgbColor): RgbColor {
    if (value === undefined || value === null) return fallback;
    if (Array.isArray(value)) return rgb(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0);
    if (typeof value === 'string') {
      const m = HEX_COLOR.exec(value);
      if (m) return Number.parseInt(m[1] as string, 16);
      return this.number(value);
    }
    return value as number;
  }

  font(name: string): string {
    const fonts = this.scope.fonts();
    if (name in fonts) return name;
    const value = this.scope.lookup(name);
    if (typeof value === 'string' && value in fonts) return value;
    throw new Error(`${this.json.screen}: unknown font ${name}`);
  }

  cursor(name: string): number {
    if (name === NO_CURSOR_NAME) return NO_CURSOR;
    const value = this.scope.lookup(name);
    if (typeof value !== 'number') throw new Error(`${this.json.screen}: unknown cursor ${name}`);
    return value;
  }

  sound(name: string): ButtonSoundScheme {
    const value = this.scope.lookup(name) ?? this.scope.lookup(`${SOUND_PREFIX}${name}`);
    const scheme = typeof value === 'number' ? SCHEME_ORDER[value] : undefined;
    if (!scheme) throw new Error(`${this.json.screen}: unknown button sound scheme ${name}`);
    return scheme;
  }

  style(name: string): unknown {
    const style = getPath(this.json.styles ?? {}, name);
    if (style === undefined) throw new Error(`${this.json.screen}: unknown style ${name}`);
    return style;
  }
}
