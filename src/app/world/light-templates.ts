// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Soldier_Control.cc CreateSoldierLight (Light2, Light3 with night goggles, Light4 with UV
// @src goggles); src/game/TileEngine/Lighting.cc LightLoadCachedTemplate, LightLoad.

import { parseLightTemplateFile } from '../../content/formats/lht.ts';
import { LIGHT_TEMPLATE_NAMES, type LightTemplate, lightTemplateKey } from '../../content/world/light-templates.ts';
import type { InventoryItemView } from '../../protocol/view.ts';
import type { ReadVfsFile, VfsFile } from '../net/vfs.ts';

const HEAD_SLOTS: readonly number[] = [3, 4];
const STUB_PREFIX = 'stubs/';

export const MERC_LIGHT = 'Light2';
export const NIGHT_GOGGLES_LIGHT = 'Light3';
export const UV_GOGGLES_LIGHT = 'Light4';

export type LightTemplateOrigin = 'data' | 'stubs';

export interface ResolvedLightTemplate {
  readonly template: LightTemplate;
  readonly origin: LightTemplateOrigin;
}

interface TemplateFile {
  readonly name: string;
  readonly path: string;
  readonly origin: LightTemplateOrigin;
}

export function mercLightTemplateName(inventory: readonly InventoryItemView[] | undefined): string {
  const head = (inventory ?? []).filter((i) => HEAD_SLOTS.includes(i.slot)).map((i) => i.item);
  if (head.includes('UVGOGGLES')) return UV_GOGGLES_LIGHT;
  if (head.includes('NIGHTGOGGLES')) return NIGHT_GOGGLES_LIGHT;
  return MERC_LIGHT;
}

function templateFiles(files: readonly VfsFile[]): TemplateFile[] {
  const listed = new Set(files.map((f) => f.path.toLowerCase()));
  return LIGHT_TEMPLATE_NAMES.flatMap((name): TemplateFile[] => {
    const path = name.toLowerCase();
    if (listed.has(path)) return [{ name, path, origin: 'data' }];
    const stub = `${STUB_PREFIX}${path}`;
    return listed.has(stub) ? [{ name, path: stub, origin: 'stubs' }] : [];
  });
}

export class LightTemplates {
  readonly #templates: ReadonlyMap<string, ResolvedLightTemplate>;

  constructor(templates: readonly ResolvedLightTemplate[] = []) {
    this.#templates = new Map(templates.map((t) => [lightTemplateKey(t.template.name), t]));
  }

  static async load(files: readonly VfsFile[], read: ReadVfsFile): Promise<LightTemplates> {
    const loaded = await Promise.all(
      templateFiles(files).map(async (f) => ({ template: parseLightTemplateFile(f.name, await read(f.path)), origin: f.origin })),
    );
    return new LightTemplates(loaded);
  }

  get loaded(): number {
    return this.#templates.size;
  }

  get byKey(): ReadonlyMap<string, LightTemplate> {
    return new Map([...this.#templates].map(([key, t]) => [key, t.template]));
  }

  resolve(name: string): ResolvedLightTemplate | null {
    return this.#templates.get(lightTemplateKey(name)) ?? null;
  }
}
