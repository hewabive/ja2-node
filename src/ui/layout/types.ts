export const LAYOUTS_DIR = 'layouts';
export const ORIGINAL_SKIN = 'original';

export interface ChoiceJson<T> {
  readonly by: string;
  readonly map: Readonly<Record<string, T>>;
}

export type NumberExpr = number | string | { readonly bind: string } | ChoiceJson<number | string>;
export type ColorJson = number | string | readonly [number, number, number] | ChoiceJson<number | string>;
export type Condition = boolean | string | { readonly eq: readonly [string, string | number | boolean] } | { readonly not: Condition };

export type TextSourceJson =
  | string
  | { readonly key: readonly [string, NumberExpr] }
  | { readonly format: TextSourceJson; readonly args: readonly (TextSourceJson | number)[] }
  | { readonly bind: string }
  | { readonly edt: readonly [string, NumberExpr] }
  | { readonly literal: string }
  | { readonly money: NumberExpr };

export type FrameName = 'std640' | 'screen' | 'tacticalPanel' | 'tacticalInventory' | 'viewport';
export const FRAME_NAMES: readonly FrameName[] = ['std640', 'screen', 'tacticalPanel', 'tacticalInventory', 'viewport'];

export type AnchorName =
  | 'topLeft'
  | 'topCenter'
  | 'topRight'
  | 'centerLeft'
  | 'center'
  | 'centerRight'
  | 'bottomLeft'
  | 'bottomCenter'
  | 'bottomRight';
export const ANCHOR_NAMES: readonly AnchorName[] = [
  'topLeft',
  'topCenter',
  'topRight',
  'centerLeft',
  'center',
  'centerRight',
  'bottomLeft',
  'bottomCenter',
  'bottomRight',
];

export type StubFrameState = 'plain' | 'normal' | 'hover' | 'pressed' | 'pressedHover' | 'grayed';

export type StubStyle = 'solid' | 'hollow' | 'checker';

export interface StubSpecJson {
  readonly style?: StubStyle;
  readonly frames?: NumberExpr;
  readonly size?: readonly [NumberExpr, NumberExpr];
  readonly sizes?: readonly (readonly [NumberExpr, NumberExpr])[];
  readonly states?: readonly StubFrameState[];
  readonly animated?: NumberExpr;
}

export type AssetJson =
  | { readonly sti: string; readonly stub?: StubSpecJson }
  | { readonly pcx: string; readonly stub?: StubSpecJson }
  | { readonly mlg: string; readonly stub?: StubSpecJson };

export interface WidgetJson {
  readonly type: string;
  readonly id?: string;
  readonly [key: string]: unknown;
}

export interface HotkeyJson {
  readonly key: string;
  readonly on?: string | readonly string[];
  readonly mods?: number | 'any';
  readonly action: string;
  readonly when?: string;
}

export interface LayoutJson {
  readonly '@derived'?: string;
  readonly '@src'?: string | readonly string[];
  readonly screen: string;
  readonly frame: FrameName;
  readonly debug?: boolean;
  readonly constants?: readonly string[];
  readonly assets?: Readonly<Record<string, AssetJson>>;
  readonly styles?: Readonly<Record<string, unknown>>;
  readonly widgets?: readonly WidgetJson[];
  readonly hotkeys?: readonly HotkeyJson[];
  readonly tooltips?: boolean;
  readonly sound?: string;
  readonly unsupported?: readonly string[];
}
