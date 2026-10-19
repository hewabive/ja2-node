// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Lighting.cc LightLoad (the .LHT layout: node count, LIGHT_NODE records, ray count, ray list);
// @src src/externalized/content/LightTemplate.cc LightTemplate::deserialize (light-templates.json). See docs/20 §2.

import { FormatError } from '../binary/errors.ts';
import { BinaryReader } from '../binary/reader.ts';

const RAY_FLAG_MASK = 0x4000;
const LIGHTS_ENTRY_LENGTH = 4;

export interface LightNodeData {
  readonly dx: number;
  readonly dy: number;
  readonly light: number;
}

export interface LightTemplateData {
  readonly name: string;
  readonly lights: readonly LightNodeData[];
  readonly rays: readonly number[];
}

export function parseLightTemplateFile(name: string, bytes: Uint8Array): LightTemplateData {
  const r = new BinaryReader(bytes);
  const lights = Array.from({ length: r.u16() }, () => {
    const dx = r.i16();
    const dy = r.i16();
    r.u8();
    return { dx, dy, light: r.u8() };
  });
  const rays = Array.from({ length: r.u16() }, () => r.u16() & ~RAY_FLAG_MASK);
  return { name, lights, rays };
}

function isLightsEntry(v: unknown): v is readonly number[] {
  return Array.isArray(v) && v.length === LIGHTS_ENTRY_LENGTH && v.every((n) => typeof n === 'number');
}

export function parseLightTemplatesJson(json: unknown): LightTemplateData[] {
  if (!Array.isArray(json)) throw new FormatError('light-templates.json is not a list');
  return json.map((entry: unknown) => {
    const e = entry as { internalName?: unknown; rays?: unknown; lights?: unknown };
    if (typeof e.internalName !== 'string' || !Array.isArray(e.rays) || !Array.isArray(e.lights) || !e.lights.every(isLightsEntry))
      throw new FormatError('malformed light template');
    return {
      name: e.internalName,
      rays: e.rays.map(Number),
      lights: e.lights.map(([dx, dy, , light]) => ({ dx: dx as number, dy: dy as number, light: light as number })),
    };
  });
}
