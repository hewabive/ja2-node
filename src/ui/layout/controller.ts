export type BindingType = 'boolean' | 'number' | 'string' | 'list' | 'object';

export interface ActionSpec {
  readonly args?: number;
  readonly payload?: 'string';
}

export interface ControllerContract {
  readonly id: string;
  readonly actions: Readonly<Record<string, ActionSpec>>;
  readonly bindings: Readonly<Record<string, BindingType>>;
}

export interface LayoutController {
  readonly contract: ControllerContract;
  get(path: string): unknown;
  invoke(action: string, args: readonly number[], payload?: string): void;
}

export interface ParsedAction {
  readonly name: string;
  readonly args: readonly number[];
}

const ACTION = /^([A-Za-z_]\w*)(?:\(([^)]*)\))?$/;
const PATH_PART = /([^.[\]]+)|\[(\d+)\]/g;

export function bindingRoot(path: string): string {
  const plain = path.startsWith('!') ? path.slice(1) : path;
  return /^[^.[]*/.exec(plain)?.[0] ?? plain;
}

export function parseAction(text: string): ParsedAction {
  const m = ACTION.exec(text.trim());
  if (!m) throw new Error(`malformed action ${JSON.stringify(text)}`);
  const args = (m[2] ?? '')
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a.length > 0)
    .map((a) => {
      const n = Number(a);
      if (!Number.isInteger(n)) throw new Error(`action ${text} has a non-integer argument ${a}`);
      return n;
    });
  return { name: m[1] as string, args };
}

export function getPath(model: unknown, path: string): unknown {
  let value: unknown = model;
  for (const m of path.matchAll(PATH_PART)) {
    if (value === null || value === undefined) return undefined;
    const key = m[1] ?? Number(m[2]);
    value = (value as Record<string | number, unknown>)[key];
  }
  return value;
}

export function substituteIndex(text: string, index: number): string {
  return text.replace(/\$i\b/g, String(index));
}

export type ActionHandler = (args: readonly number[], payload?: string) => void;

export class ViewModelController implements LayoutController {
  readonly contract: ControllerContract;
  model: Record<string, unknown>;
  readonly #handlers: Readonly<Record<string, ActionHandler>>;
  readonly invoked: { readonly action: string; readonly args: readonly number[]; readonly payload?: string }[] = [];

  constructor(contract: ControllerContract, model: Record<string, unknown>, handlers: Readonly<Record<string, ActionHandler>> = {}) {
    this.contract = contract;
    this.model = model;
    this.#handlers = handlers;
  }

  get(path: string): unknown {
    return getPath(this.model, path);
  }

  invoke(action: string, args: readonly number[], payload?: string): void {
    this.invoked.push(payload === undefined ? { action, args } : { action, args, payload });
    this.#handlers[action]?.(args, payload);
  }
}
