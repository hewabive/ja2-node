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
  type VanillaVersion,
} from '../content/text/data-version.ts';
import { matchResourcePacks, parseResourcePack, RESOURCE_PACKS_DIR, type ResourcePack } from '../content/text/resource-packs.ts';
import { isRepositoryLayer, PROJECT_DATA_LAYER } from '../content/vfs/layers.ts';
import type { Vfs } from '../content/vfs/vfs.ts';
import { dataDirFiles, dataDirHasher } from '../node/data-dir-files.ts';

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
  readonly resources?: () => Promise<VanillaVersion | null>;
  readonly override?: string | undefined;
}

export interface DataSource {
  readonly vfs: Vfs;
  readonly dataDir: string | null;
}

const JSON_EXTENSION = '.json';

export function originalDataPaths(vfs: Vfs): string[] {
  return vfs
    .list()
    .filter((f) => !isRepositoryLayer(f.layer))
    .map((f) => f.path);
}

export async function resourcePacks(vfs: Vfs): Promise<ResourcePack[]> {
  const paths = vfs
    .list()
    .filter((f) => f.layer === PROJECT_DATA_LAYER && f.path.startsWith(`${RESOURCE_PACKS_DIR}/`) && f.path.endsWith(JSON_EXTENSION))
    .map((f) => f.path)
    .sort();
  return Promise.all(paths.map(async (path) => parseResourcePack(JSON.parse(new TextDecoder().decode(await vfs.read(path))))));
}

async function guessByResources(input: DataVersionInput): Promise<DataVersionChoice> {
  const fallback: DataVersionChoice = { version: DEFAULT_VANILLA_VERSION, source: 'default' };
  try {
    const matched = (await input.resources?.()) ?? null;
    return matched ? { version: matched, source: 'detected' } : fallback;
  } catch (err) {
    return { ...fallback, warning: `the data version guess by resource packs failed: ${(err as Error).message}` };
  }
}

export async function chooseDataVersion(input: DataVersionInput): Promise<DataVersionChoice> {
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
  return guessed ? { version: guessed, source: 'detected' } : guessByResources(input);
}

export function detectDataVersion(data: DataSource, env: NodeJS.ProcessEnv): Promise<DataVersionChoice> {
  const dataDir = data.dataDir;
  return chooseDataVersion({
    originalData: dataDir !== null,
    paths: () => originalDataPaths(data.vfs),
    ...(dataDir !== null
      ? { resources: async () => matchResourcePacks(await resourcePacks(data.vfs), await dataDirFiles(dataDir), dataDirHasher(dataDir)) }
      : {}),
    override: env[DATA_VERSION_ENV],
  });
}

export function chooseDisplayLanguage(value: string | undefined, version: DataVersion): UiLanguage {
  const wanted = value?.trim().toLowerCase();
  if (!wanted) return displayLanguageOf(version);
  if (!isUiLanguage(wanted)) throw new Error(`${LANGUAGE_ENV} must be one of ${UI_LANGUAGES.join(', ')} (got ${value})`);
  return wanted;
}
