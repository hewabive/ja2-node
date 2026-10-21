import type { ProfilePresentation } from '../../content/narrative/profile-presentation.ts';
import { sectorMapPath } from '../../content/strategic/sector-maps.ts';
import type { ItemCatalogue } from '../../protocol/items.ts';
import type { MessageEntry } from '../../protocol/message-log.ts';
import type { MapMedia } from '../../ui/screens/map/environment.ts';
import { parseSectorLabel } from '../../ui/screens/map/facts.ts';
import type { EdtTextCache } from '../../ui/text/edt-text.ts';
import type { AssetSource } from '../assets/asset-source.ts';
import type { UiAssets } from '../game/ui-assets.ts';
import { type SpeechSource, TacticalMediaStore } from '../tactical/tactical-media.ts';
import { radarPathForMap } from '../world/radar.ts';
import { BOARD_KEYS } from './map-board.ts';

export interface MapMediaSources {
  readonly assets: UiAssets;
  readonly source: AssetSource;
  readonly edt: EdtTextCache;
  readonly catalogue: ItemCatalogue;
  readonly profiles: readonly ProfilePresentation[];
  readonly speech: () => SpeechSource | null;
  readonly gunNut: boolean;
  readonly messages: () => readonly MessageEntry[];
}

export class MapMediaStore extends TacticalMediaStore implements MapMedia {
  readonly board = BOARD_KEYS;
  readonly radar: (sector: string) => string | null;
  readonly #source: AssetSource;
  readonly #edt: EdtTextCache;
  readonly #messages: () => readonly MessageEntry[];
  readonly #loadingText = new Set<string>();

  constructor(sources: MapMediaSources) {
    super(sources.assets, sources.catalogue, sources.profiles, sources.speech, sources.gunNut);
    this.#source = sources.source;
    this.#edt = sources.edt;
    this.#messages = sources.messages;
    this.radar = (label) => this.#radar(label);
  }

  #radar(label: string): string | null {
    const sector = parseSectorLabel(label);
    if (!sector) return null;
    const exists = (path: string) => this.#source.resolve(path) !== undefined;
    const path = radarPathForMap(sectorMapPath(exists, sector, false));
    return exists(path) ? path : null;
  }

  messages(): readonly MessageEntry[] {
    return this.#messages();
  }

  dialogueText(file: string, row: number): string | null {
    if (this.#edt.has(file)) return this.#edt.field(file, row);
    const key = file.toLowerCase();
    if (!this.#loadingText.has(key)) {
      this.#loadingText.add(key);
      void this.#source.readOptional(file).then((bytes) => {
        if (bytes) this.#edt.add(file, bytes);
      });
    }
    return null;
  }
}
