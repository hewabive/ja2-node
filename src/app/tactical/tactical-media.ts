import { type AudioGap, gapPathFor, parseGap } from '../../content/formats/gap.ts';
import type { ProfilePresentation } from '../../content/narrative/profile-presentation.ts';
import type { UiLanguage } from '../../content/text/data-version.ts';
import { type CatalogueItem, ITEM_CATALOGUE_ROUTE, type ItemCatalogue } from '../../protocol/items.ts';
import type { KeyView } from '../../protocol/view.ts';
import type { SpeechPlayback, TacticalMedia } from '../../ui/screens/tactical/environment.ts';
import type { UiAssets } from '../game/ui-assets.ts';
import { readVfsFileOrNull } from '../net/vfs.ts';

export interface SpeechSource {
  readonly speaking: SpeechPlayback | null;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

export async function fetchItemCatalogue(language: UiLanguage | null): Promise<ItemCatalogue> {
  const query = language ? `?lang=${encodeURIComponent(language)}` : '';
  return (await fetchJson(`${ITEM_CATALOGUE_ROUTE}${query}`)) as ItemCatalogue;
}

export async function fetchProfiles(session: string): Promise<readonly ProfilePresentation[]> {
  const body = (await fetchJson(`/api/sessions/${encodeURIComponent(session)}/profiles`)) as { profiles: ProfilePresentation[] };
  return body.profiles;
}

export class TacticalMediaStore implements TacticalMedia {
  readonly gunNut: boolean;
  readonly #assets: UiAssets;
  readonly #items = new Map<string, CatalogueItem>();
  readonly #itemsByIndex = new Map<number, CatalogueItem>();
  readonly #profiles = new Map<number, ProfilePresentation>();
  readonly #loading = new Set<string>();
  readonly #gaps = new Map<string, readonly AudioGap[] | null>();
  readonly #speech: () => SpeechSource | null;

  constructor(
    assets: UiAssets,
    catalogue: ItemCatalogue,
    profiles: readonly ProfilePresentation[],
    speech: () => SpeechSource | null,
    gunNut: boolean,
  ) {
    this.#assets = assets;
    this.#speech = speech;
    this.gunNut = gunNut;
    for (const item of catalogue.items) {
      this.#items.set(item.name, item);
      this.#itemsByIndex.set(item.index, item);
    }
    this.useProfiles(profiles);
  }

  get loading(): number {
    return this.#loading.size;
  }

  useProfiles(profiles: readonly ProfilePresentation[]): void {
    this.#profiles.clear();
    for (const p of profiles) this.#profiles.set(p.id, p);
  }

  image(path: string): boolean {
    if (this.#assets.info(path)) return true;
    if (this.#loading.has(path) || this.#assets.missing.includes(path)) return false;
    this.#loading.add(path);
    void this.#assets
      .image(path)
      .catch(() => false)
      .finally(() => this.#loading.delete(path));
    return false;
  }

  async preload(paths: readonly string[]): Promise<void> {
    await Promise.all(paths.map((path) => this.#assets.image(path).catch(() => false)));
  }

  profile(id: number): ProfilePresentation | null {
    return this.#profiles.get(id) ?? null;
  }

  item(name: string): CatalogueItem | null {
    return this.#items.get(name) ?? null;
  }

  itemByIndex(index: number): CatalogueItem | null {
    return this.#itemsByIndex.get(index) ?? null;
  }

  gaps(file: string): readonly AudioGap[] | null {
    if (this.#gaps.has(file)) return this.#gaps.get(file) ?? null;
    this.#gaps.set(file, null);
    void readVfsFileOrNull(gapPathFor(file)).then((bytes) => {
      if (!bytes) return;
      try {
        this.#gaps.set(file, parseGap(bytes));
      } catch {
        this.#gaps.set(file, null);
      }
    });
    return null;
  }

  speech(): SpeechPlayback | null {
    return this.#speech()?.speaking ?? null;
  }

  keyItem(key: KeyView): string | null {
    return key.item ?? null;
  }
}
