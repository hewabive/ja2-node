// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Faces.cc InitFace, GetFaceRelativeCoordinates (the profile's face index, eye and mouth offsets,
// @src blink and expression frequencies, the RPC small faces); src/externalized/mercs/RPCSmallFaceModel.cc,
// @src AIMListingModel.cc, MERCListingModel.cc (the bio rows).

import type { MercProfile } from '../formats/prof.ts';
import { asArray, asInt, asObject, asString } from '../strategic/json-fields.ts';
import { parseJsoncBytes } from '../strategic/jsonc.ts';
import type { ReadFile } from '../world/tileset-loader.ts';

export const PROFILE_PRESENTATION_PATHS = {
  aimListings: 'externalized/mercs-AIM-listings.json',
  mercListings: 'externalized/mercs-MERC-listings.json',
  smallFaces: 'externalized/mercs-rpc-small-faces.json',
  profileInfo: 'externalized/mercs-profile-info.json',
} as const;

export const AIM_BIOS_FILE = 'binarydata/aimbios.edt';
export const MERC_BIOS_FILE = 'binarydata/mercbios.edt';

export type Offset = readonly [number, number];

export interface FaceOffsets {
  readonly eyes: Offset;
  readonly mouth: Offset;
}

export interface ProfileFaceRecord {
  readonly id: number;
  readonly name: string;
  readonly nickname: string;
  readonly faceIndex: number;
  readonly eyes: Offset;
  readonly mouth: Offset;
  readonly blinkFrequency: number;
  readonly expressionFrequency: number;
}

export interface ProfilePresentation extends ProfileFaceRecord {
  readonly smallFace: FaceOffsets | null;
  readonly aimBio: number | null;
  readonly mercBio: number | null;
}

export interface ProfilePresentationTables {
  readonly aimBio: ReadonlyMap<number, number>;
  readonly mercBio: ReadonlyMap<number, number>;
  readonly smallFaces: ReadonlyMap<number, FaceOffsets>;
}

const HERVE = 151;
const CARLO = 154;

function profileIds(json: unknown): Map<string, number> {
  const ids = new Map<string, number>();
  asArray(json, 'mercs profile info').forEach((v, i) => {
    const o = asObject(v, `mercs profile info[${i}]`);
    ids.set(asString(o.internalName, 'internalName'), asInt(o.profileID, 'profileID'));
  });
  return ids;
}

function idOf(ids: ReadonlyMap<string, number>, value: unknown): number | null {
  if (typeof value === 'number') return value;
  return typeof value === 'string' ? (ids.get(value) ?? null) : null;
}

function offset(value: unknown, what: string): Offset {
  const pair = asArray(value, what);
  return [asInt(pair[0], `${what}[0]`), asInt(pair[1], `${what}[1]`)];
}

function bioRows(json: unknown, ids: ReadonlyMap<string, number>, what: string): Map<number, number> {
  const rows = new Map<number, number>();
  asArray(json, what).forEach((v, i) => {
    const o = asObject(v, `${what}[${i}]`);
    const id = idOf(ids, o.profile);
    if (id !== null) rows.set(id, asInt(o.bioIndex, `${what}[${i}].bioIndex`));
  });
  return rows;
}

function smallFaces(json: unknown, ids: ReadonlyMap<string, number>): Map<number, FaceOffsets> {
  const faces = new Map<number, FaceOffsets>();
  asArray(json, 'rpc small faces').forEach((v, i) => {
    const o = asObject(v, `rpc small faces[${i}]`);
    const id = idOf(ids, o.profile);
    if (id !== null) faces.set(id, { eyes: offset(o.eyesXY, 'eyesXY'), mouth: offset(o.mouthXY, 'mouthXY') });
  });
  return faces;
}

export function parseProfilePresentationTables(
  sources: { readonly [K in keyof typeof PROFILE_PRESENTATION_PATHS]: unknown },
): ProfilePresentationTables {
  const ids = profileIds(sources.profileInfo);
  return {
    aimBio: bioRows(sources.aimListings, ids, 'aim listings'),
    mercBio: bioRows(sources.mercListings, ids, 'merc listings'),
    smallFaces: smallFaces(sources.smallFaces, ids),
  };
}

export async function loadProfilePresentationTables(read: ReadFile): Promise<ProfilePresentationTables> {
  const keys = Object.keys(PROFILE_PRESENTATION_PATHS) as (keyof typeof PROFILE_PRESENTATION_PATHS)[];
  const values = await Promise.all(
    keys.map(async (key) => {
      const bytes = await read(PROFILE_PRESENTATION_PATHS[key]);
      return bytes ? parseJsoncBytes(bytes) : [];
    }),
  );
  return parseProfilePresentationTables(Object.fromEntries(keys.map((key, i) => [key, values[i]])) as never);
}

function sharedFaceIndex(profile: MercProfile): number {
  return profile.id >= HERVE && profile.id <= CARLO ? HERVE : profile.faceIndex;
}

export function profileFaceRecord(profile: MercProfile): ProfileFaceRecord {
  return {
    id: profile.id,
    name: profile.name,
    nickname: profile.nickname,
    faceIndex: sharedFaceIndex(profile),
    eyes: [profile.eyesX, profile.eyesY],
    mouth: [profile.mouthX, profile.mouthY],
    blinkFrequency: profile.blinkFrequency,
    expressionFrequency: profile.expressionFrequency,
  };
}

export function profilePresentation(record: ProfileFaceRecord, tables: ProfilePresentationTables): ProfilePresentation {
  return {
    ...record,
    smallFace: tables.smallFaces.get(record.id) ?? null,
    aimBio: tables.aimBio.get(record.id) ?? null,
    mercBio: tables.mercBio.get(record.id) ?? null,
  };
}
