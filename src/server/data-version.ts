import {
  type DataVersion,
  DEFAULT_VANILLA_VERSION,
  displayLanguageOf,
  guessVanillaVersion,
  isUiLanguage,
  parseVanillaVersion,
  STUB_DATA_VERSION,
  UI_LANGUAGES,
  type UiLanguage,
  VANILLA_VERSIONS,
} from '../content/text/data-version.ts';
import { isRepositoryLayer } from '../content/vfs/layers.ts';
import type { Vfs } from '../content/vfs/vfs.ts';

export const DATA_VERSION_ENV = 'JA2_DATA_VERSION';
export const LANGUAGE_ENV = 'JA2_LANG';

export type DataVersionSource = 'stubs' | 'override' | 'detected' | 'default';

export interface DataVersionChoice {
  readonly version: DataVersion;
  readonly source: DataVersionSource;
  readonly warning?: string;
}

export interface DataVersionInput {
  readonly originalData: boolean;
  readonly paths: () => Iterable<string>;
  readonly override?: string | undefined;
}

export function originalDataPaths(vfs: Vfs): string[] {
  return vfs
    .list()
    .filter((f) => !isRepositoryLayer(f.layer))
    .map((f) => f.path);
}

export function chooseDataVersion(input: DataVersionInput): DataVersionChoice {
  const override = input.override?.trim();
  if (!input.originalData)
    return {
      version: STUB_DATA_VERSION,
      source: 'stubs',
      ...(override ? { warning: `${DATA_VERSION_ENV} is ignored without original data (JA2_DATA_DIR)` } : {}),
    };
  if (override) {
    const version = parseVanillaVersion(override);
    if (!version) throw new Error(`${DATA_VERSION_ENV} must be one of ${VANILLA_VERSIONS.join(', ')} (got ${override})`);
    return { version, source: 'override' };
  }
  const guessed = guessVanillaVersion(input.paths());
  return guessed ? { version: guessed, source: 'detected' } : { version: DEFAULT_VANILLA_VERSION, source: 'default' };
}

export function detectDataVersion(vfs: Vfs, originalData: boolean, env: NodeJS.ProcessEnv): DataVersionChoice {
  return chooseDataVersion({ originalData, paths: () => originalDataPaths(vfs), override: env[DATA_VERSION_ENV] });
}

export function chooseDisplayLanguage(value: string | undefined, version: DataVersion): UiLanguage {
  const wanted = value?.trim().toLowerCase();
  if (!wanted) return displayLanguageOf(version);
  if (!isUiLanguage(wanted)) throw new Error(`${LANGUAGE_ENV} must be one of ${UI_LANGUAGES.join(', ')} (got ${value})`);
  return wanted;
}
