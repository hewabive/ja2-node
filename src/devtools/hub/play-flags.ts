import type { PlayFlag } from './open-page.ts';

const STORAGE_KEY = 'ja2-node:dev-play-flags';
const DEFAULT_VALUE = '1';

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function storedParams(): readonly string[] {
  try {
    const value: unknown = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function storeParams(params: readonly string[]): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(params));
  } catch {
    return;
  }
}

export class PlayFlags {
  readonly #inputs = [...document.querySelectorAll<HTMLInputElement>('input[data-param]')];

  constructor(changed: () => void) {
    const stored = storedParams();
    for (const input of this.#inputs) {
      input.checked = stored.includes(input.dataset.param ?? '');
      input.addEventListener('change', () => {
        storeParams(this.current().map(([param]) => param));
        changed();
      });
    }
  }

  current(): PlayFlag[] {
    return this.#inputs.filter((i) => i.checked).map((i) => [i.dataset.param ?? '', i.dataset.value ?? DEFAULT_VALUE] as const);
  }
}
