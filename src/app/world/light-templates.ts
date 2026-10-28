// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc CreateSoldierLight (Light2, Light3 with night goggles, Light4 with UV
// @src goggles); src/game/TileEngine/Lighting.cc LightLoadCachedTemplate.

import {
  type LightTemplateData,
  parseLightTemplateFile,
  parseLightTemplatesJson,
  SHIPPED_LIGHT_TEMPLATES_PATH,
} from '../../content/formats/lht.ts';
import { isRepositoryLayer } from '../../content/vfs/layers.ts';
import type { InventoryItemView } from '../../protocol/view.ts';
import { asShippedTemplate, type LightTemplate, lightTemplate } from '../../sim/tactical/lighting/templates.ts';
import type { ReadVfsFile, VfsFile } from '../net/vfs.ts';

const LHT_EXTENSION = '.lht';
const HEAD_SLOTS: readonly number[] = [3, 4];

export const MERC_LIGHT = 'Light2';
export const NIGHT_GOGGLES_LIGHT = 'Light3';
export const UV_GOGGLES_LIGHT = 'Light4';

const STAND_INS: Readonly<Record<string, string>> = {
  [MERC_LIGHT.toUpperCase()]: 'L-R06.LHT',
  [NIGHT_GOGGLES_LIGHT.toUpperCase()]: 'L-R07.LHT',
  [UV_GOGGLES_LIGHT.toUpperCase()]: 'L-R08.LHT',
};

export type LightTemplateOrigin = 'data' | 'generated' | 'standIn';

export interface ResolvedLightTemplate {
  readonly template: LightTemplate;
  readonly origin: LightTemplateOrigin;
}

function anyFile(files: readonly VfsFile[], path: string): VfsFile | null {
  const lower = path.toLowerCase();
  return files.find((f) => f.path.toLowerCase() === lower) ?? null;
}

function lhtFiles(files: readonly VfsFile[]): VfsFile[] {
  return files.filter((f) => f.path.toLowerCase().endsWith(LHT_EXTENSION) && !f.path.includes('/') && !isRepositoryLayer(f.layer));
}

function nameKey(name: string): string {
  const upper = name.toUpperCase();
  return upper.endsWith(LHT_EXTENSION.toUpperCase()) ? upper.slice(0, -LHT_EXTENSION.length) : upper;
}

export function mercLightTemplateName(inventory: readonly InventoryItemView[] | undefined): string {
  const head = (inventory ?? []).filter((i) => HEAD_SLOTS.includes(i.slot)).map((i) => i.item);
  if (head.includes('UVGOGGLES')) return UV_GOGGLES_LIGHT;
  if (head.includes('NIGHTGOGGLES')) return NIGHT_GOGGLES_LIGHT;
  return MERC_LIGHT;
}

export class LightTemplates {
  readonly #fromData: ReadonlyMap<string, LightTemplate>;
  readonly #resolved = new Map<string, ResolvedLightTemplate | null>();

  constructor(fromData: readonly LightTemplateData[] = []) {
    this.#fromData = new Map(fromData.map((t) => [nameKey(t.name), t]));
  }

  static async load(files: readonly VfsFile[], read: ReadVfsFile): Promise<LightTemplates> {
    const json = anyFile(files, SHIPPED_LIGHT_TEMPLATES_PATH);
    const [shipped, lht] = await Promise.all([
      json ? read(json.path).then((bytes) => parseLightTemplatesJson(JSON.parse(new TextDecoder().decode(bytes)))) : [],
      Promise.all(lhtFiles(files).map(async (f) => asShippedTemplate(f.path, parseLightTemplateFile(f.path, await read(f.path))))),
    ]);
    return new LightTemplates([...shipped, ...lht]);
  }

  get fromData(): number {
    return this.#fromData.size;
  }

  resolve(name: string): ResolvedLightTemplate | null {
    const key = nameKey(name);
    const cached = this.#resolved.get(key);
    if (cached !== undefined) return cached;
    const resolved = this.#lookup(name, key);
    this.#resolved.set(key, resolved);
    return resolved;
  }

  #lookup(name: string, key: string): ResolvedLightTemplate | null {
    const data = this.#fromData.get(key);
    if (data) return { template: data, origin: 'data' };
    const generated = lightTemplate(name);
    if (generated) return { template: generated, origin: 'generated' };
    const standIn = STAND_INS[key];
    const fallback = standIn ? lightTemplate(standIn) : null;
    return fallback ? { template: fallback, origin: 'standIn' } : null;
  }
}
