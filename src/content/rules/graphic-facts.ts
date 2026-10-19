// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/sgp/STCI.cc (sub-image offsets and widths, app data), src/game/TileEngine/Tile_Cache.cc ubNumFrames

import { FormatError } from '../binary/errors.ts';
import { decodeSti, isSti, type StiAppData } from '../formats/sti.ts';
import { parseStubSpriteManifest, STUB_SPRITE_SUFFIX } from '../picture/stub-sprite.ts';
import { normalizeVfsPath } from '../vfs/path.ts';
import type { ReadFile } from '../world/tileset-loader.ts';
import type { FrameGeometry } from '../world/zstrip.ts';

export const GRAPHIC_FACTS_PREFIX = '@rules/graphics/';
export const GRAPHIC_FACTS_VERSION = 1;
const GRAPHIC_FACTS_SUFFIX = '.json';

export type GraphicFacts =
  | { readonly kind: 'indexed'; readonly frames: readonly FrameGeometry[]; readonly appData: readonly StiAppData[] | null }
  | { readonly kind: 'rgb' }
  | { readonly kind: 'sprite'; readonly frames: readonly FrameGeometry[] }
  | { readonly kind: 'other' }
  | { readonly kind: 'invalid'; readonly reason: string };

type FrameTuple = readonly [offsetX: number, offsetY: number, width: number];
type AppDataTuple = readonly [
  wallOrientation: number,
  numberOfTiles: number,
  tileLocationIndex: number,
  currentFrame: number,
  numberOfFrames: number,
  flags: number,
];

type EncodedFacts =
  | { readonly kind: 'indexed'; readonly frames: readonly FrameTuple[]; readonly appData: readonly AppDataTuple[] | null }
  | { readonly kind: 'rgb' }
  | { readonly kind: 'sprite'; readonly frames: readonly FrameTuple[] }
  | { readonly kind: 'other' }
  | { readonly kind: 'invalid'; readonly reason: string };

const NOT_AN_STI = 'not an STCI file';

export function graphicFactsPath(graphic: string): string {
  return `${GRAPHIC_FACTS_PREFIX}${normalizeVfsPath(graphic)}${GRAPHIC_FACTS_SUFFIX}`;
}

export function isGraphicFactsPath(path: string): boolean {
  return path.startsWith(GRAPHIC_FACTS_PREFIX) && path.endsWith(GRAPHIC_FACTS_SUFFIX);
}

export function graphicOfFactsPath(path: string): string {
  return path.slice(GRAPHIC_FACTS_PREFIX.length, path.length - GRAPHIC_FACTS_SUFFIX.length);
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function spriteFacts(bytes: Uint8Array): GraphicFacts {
  const manifest = parseStubSpriteManifest(JSON.parse(new TextDecoder().decode(bytes)));
  return { kind: 'sprite', frames: manifest.frames.map((f) => ({ offsetX: f.ox, offsetY: f.oy, width: f.w })) };
}

function stiFacts(bytes: Uint8Array): GraphicFacts {
  if (!isSti(bytes)) return { kind: 'other' };
  const sti = decodeSti(bytes, false);
  if (sti.kind !== 'indexed') return { kind: 'rgb' };
  return {
    kind: 'indexed',
    frames: sti.subImages.map((f) => ({ offsetX: f.offsetX, offsetY: f.offsetY, width: f.width })),
    appData: sti.appData,
  };
}

export function graphicFactsOf(graphic: string, bytes: Uint8Array): GraphicFacts {
  try {
    return graphic.endsWith(STUB_SPRITE_SUFFIX) ? spriteFacts(bytes) : stiFacts(bytes);
  } catch (err) {
    return { kind: 'invalid', reason: reasonOf(err) };
  }
}

const frameTuple = (f: FrameGeometry): FrameTuple => [f.offsetX, f.offsetY, f.width];
const frameOf = ([offsetX, offsetY, width]: FrameTuple): FrameGeometry => ({ offsetX, offsetY, width });
const appDataTuple = (a: StiAppData): AppDataTuple => [
  a.wallOrientation,
  a.numberOfTiles,
  a.tileLocationIndex,
  a.currentFrame,
  a.numberOfFrames,
  a.flags,
];
const appDataOf = ([wallOrientation, numberOfTiles, tileLocationIndex, currentFrame, numberOfFrames, flags]: AppDataTuple): StiAppData => ({
  wallOrientation,
  numberOfTiles,
  tileLocationIndex,
  currentFrame,
  numberOfFrames,
  flags,
});

function encoded(facts: GraphicFacts): EncodedFacts {
  switch (facts.kind) {
    case 'indexed':
      return { kind: 'indexed', frames: facts.frames.map(frameTuple), appData: facts.appData?.map(appDataTuple) ?? null };
    case 'sprite':
      return { kind: 'sprite', frames: facts.frames.map(frameTuple) };
    default:
      return facts;
  }
}

export function encodeGraphicFacts(facts: GraphicFacts): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(encoded(facts)));
}

export function decodeGraphicFacts(bytes: Uint8Array): GraphicFacts {
  const facts = JSON.parse(new TextDecoder().decode(bytes)) as EncodedFacts;
  switch (facts.kind) {
    case 'indexed':
      return { kind: 'indexed', frames: facts.frames.map(frameOf), appData: facts.appData?.map(appDataOf) ?? null };
    case 'sprite':
      return { kind: 'sprite', frames: facts.frames.map(frameOf) };
    case 'rgb':
    case 'other':
    case 'invalid':
      return facts;
    default:
      throw new FormatError(`unknown graphic facts in ${JSON.stringify(facts)}`);
  }
}

export async function readGraphicFacts(read: ReadFile, graphic: string): Promise<GraphicFacts | null> {
  const bytes = await read(graphicFactsPath(graphic));
  return bytes ? decodeGraphicFacts(bytes) : null;
}

export function stiFrameGeometry(facts: GraphicFacts): { frames: readonly FrameGeometry[]; appData: readonly StiAppData[] | null } | null {
  switch (facts.kind) {
    case 'indexed':
      return { frames: facts.frames, appData: facts.appData };
    case 'sprite':
      return { frames: facts.frames, appData: null };
    case 'rgb':
      return null;
    case 'other':
      throw new FormatError(NOT_AN_STI);
    case 'invalid':
      throw new FormatError(facts.reason);
  }
}

export function animationFrameCount(facts: GraphicFacts | null): number | null {
  if (!facts) return null;
  switch (facts.kind) {
    case 'indexed':
      return facts.appData?.[0]?.numberOfFrames ?? 1;
    case 'rgb':
      return 1;
    case 'invalid':
      throw new FormatError(facts.reason);
    default:
      return null;
  }
}

export function withGraphicFacts(read: ReadFile): ReadFile {
  const known = new Map<string, Promise<Uint8Array | null>>();
  const facts = async (path: string): Promise<Uint8Array | null> => {
    const graphic = graphicOfFactsPath(path);
    const bytes = await read(graphic);
    return bytes ? encodeGraphicFacts(graphicFactsOf(graphic, bytes)) : null;
  };
  return (path) => {
    const normalized = normalizeVfsPath(path);
    if (!isGraphicFactsPath(normalized)) return read(path);
    let pending = known.get(normalized);
    if (!pending) {
      pending = facts(normalized);
      known.set(normalized, pending);
    }
    return pending;
  };
}
