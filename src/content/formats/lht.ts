// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Lighting.cc LightLoad, LightSave (the .LHT layout: node count, LIGHT_NODE records, ray count,
// @src ray list with the LIGHT_NEW_RAY and LIGHT_BACKLIGHT bits).

import { BinaryReader } from '../binary/reader.ts';

const COUNT_BYTES = 2;
const LIGHT_NODE_BYTES = 6;
const RAY_BYTES = 2;

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
  const rays = Array.from({ length: r.u16() }, () => r.u16());
  return { name, lights, rays };
}

export function writeLightTemplateFile(t: LightTemplateData): Uint8Array {
  const bytes = new Uint8Array(COUNT_BYTES + t.lights.length * LIGHT_NODE_BYTES + COUNT_BYTES + t.rays.length * RAY_BYTES);
  const v = new DataView(bytes.buffer);
  let o = 0;
  v.setUint16(o, t.lights.length, true);
  o += COUNT_BYTES;
  for (const n of t.lights) {
    v.setInt16(o, n.dx, true);
    v.setInt16(o + 2, n.dy, true);
    v.setUint8(o + 5, n.light);
    o += LIGHT_NODE_BYTES;
  }
  v.setUint16(o, t.rays.length, true);
  o += COUNT_BYTES;
  for (const ray of t.rays) {
    v.setUint16(o, ray, true);
    o += RAY_BYTES;
  }
  return bytes;
}
