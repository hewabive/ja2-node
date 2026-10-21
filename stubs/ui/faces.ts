import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { encodeStiIndexed, type StiSubImage } from '../../src/content/formats/sti.ts';
import { asArray, asInt, asObject } from '../../src/content/strategic/json-fields.ts';
import { PROJECT_DATA_DIR } from '../../src/node/repo.ts';
import { GENERIC_FACE, GENERIC_FACE_BODY_TYPES, genericFacePath } from '../../src/ui/screens/tactical/generic-face.ts';
import { type PortraitSize, portraitPath } from '../../src/ui/widgets/portrait.ts';
import { buildPalette, color, type RampName } from '../palette.ts';
import { IndexedRaster } from '../raster.ts';
import { encodeStubAsset } from './skin.ts';

export const FACE_WIDTH = 48;
export const FACE_HEIGHT = 43;
export const EYES_WIDTH = 24;
export const EYES_HEIGHT = 7;
export const MOUTH_WIDTH = 14;
export const MOUTH_HEIGHT = 6;
export const FACE_FRAMES = 8;

const STUB_PROFILES_FILE = 'profiles.json';
const FACES_DIR = 'faces';
const FACE_INDEX_DIGITS = 2;

export type EyeState = 'open' | 'closed' | 'half' | 'frown' | 'surprise';
export type MouthState = 'closed' | 'small' | 'wide' | 'round';

const EYE_FRAMES: readonly EyeState[] = ['closed', 'half', 'frown', 'surprise'];
const MOUTH_FRAMES: readonly MouthState[] = ['small', 'wide', 'round'];

export interface BodyLook {
  readonly headRx: number;
  readonly headRy: number;
  readonly hair: RampName;
  readonly shirt: RampName;
  readonly longHair: boolean;
  readonly hairline: number;
}

const BODY_LOOKS: readonly BodyLook[] = [
  { headRx: 13, headRy: 17, hair: 'brown', shirt: 'blue', longHair: false, hairline: 9 },
  { headRx: 15, headRy: 18, hair: 'gray', shirt: 'olive', longHair: false, hairline: 7 },
  { headRx: 16, headRy: 16, hair: 'rust', shirt: 'khaki', longHair: false, hairline: 10 },
  { headRx: 13, headRy: 17, hair: 'sand', shirt: 'violet', longHair: true, hairline: 9 },
];

const BACKDROP = color('steel', 4);
const SKIN = color('skin', 8);
const SKIN_DARK = color('skin', 5);
const EYE_WHITE = color('gray', 14);
const PUPIL = color('blue', 3);
const LID_LINE = color('brown', 2);
const LIP = color('red', 5);
const MOUTH_INSIDE = color('red', 2);
const TEETH = color('gray', 13);
const HEAD_CENTER_X = 24;
const HEAD_CENTER_Y = 21;
const SHOULDER_TOP = 37;
const LEFT_EYE = 3;
const RIGHT_EYE = 15;
const EYE_LENGTH = 6;
const PUPIL_OFFSET = 2;

function brow(r: IndexedRaster, look: BodyLook, state: EyeState): void {
  const ink = color(look.hair, 3);
  if (state === 'frown') {
    r.line(1, 0, 8, 2, ink);
    r.line(22, 0, 15, 2, ink);
    return;
  }
  const y = state === 'surprise' ? 0 : 1;
  r.line(2, y, 9, y, ink);
  r.line(14, y, 21, y, ink);
}

function eye(r: IndexedRaster, x: number, state: EyeState): void {
  switch (state) {
    case 'closed':
      r.line(x, 4, x + EYE_LENGTH - 1, 4, LID_LINE);
      return;
    case 'half':
      r.line(x, 3, x + EYE_LENGTH - 1, 3, SKIN_DARK);
      r.rect(x, 4, EYE_LENGTH, 2, EYE_WHITE);
      r.rect(x + PUPIL_OFFSET, 4, 2, 2, PUPIL);
      return;
    case 'frown':
      r.rect(x, 4, EYE_LENGTH, 2, EYE_WHITE);
      r.rect(x + PUPIL_OFFSET, 4, 2, 2, PUPIL);
      return;
    case 'surprise':
      r.rect(x, 2, EYE_LENGTH, 5, EYE_WHITE);
      r.rect(x + PUPIL_OFFSET, 3, 2, 3, PUPIL);
      return;
    case 'open':
      r.rect(x, 3, EYE_LENGTH, 3, EYE_WHITE);
      r.rect(x + PUPIL_OFFSET, 3, 2, 3, PUPIL);
      return;
  }
}

export function eyesRaster(look: BodyLook, state: EyeState): IndexedRaster {
  const r = new IndexedRaster(EYES_WIDTH, EYES_HEIGHT);
  r.rect(0, 0, EYES_WIDTH, EYES_HEIGHT, SKIN);
  brow(r, look, state);
  eye(r, LEFT_EYE, state);
  eye(r, RIGHT_EYE, state);
  return r;
}

export function mouthRaster(state: MouthState): IndexedRaster {
  const r = new IndexedRaster(MOUTH_WIDTH, MOUTH_HEIGHT);
  r.rect(0, 0, MOUTH_WIDTH, MOUTH_HEIGHT, SKIN);
  switch (state) {
    case 'closed':
      r.line(2, 3, MOUTH_WIDTH - 3, 3, LIP);
      return r;
    case 'small':
      r.rect(4, 2, 6, 3, MOUTH_INSIDE);
      r.line(4, 1, 9, 1, LIP);
      return r;
    case 'wide':
      r.rect(2, 1, MOUTH_WIDTH - 4, 5, MOUTH_INSIDE);
      r.line(3, 1, MOUTH_WIDTH - 4, 1, TEETH);
      return r;
    case 'round':
      r.ellipse(7, 3, 3, 2.5, () => MOUTH_INSIDE);
      return r;
  }
}

function blit(target: IndexedRaster, source: IndexedRaster, x: number, y: number): void {
  for (let j = 0; j < source.height; j++) for (let i = 0; i < source.width; i++) target.set(x + i, y + j, source.get(i, j));
}

export function faceRaster(look: BodyLook): IndexedRaster {
  const r = new IndexedRaster(FACE_WIDTH, FACE_HEIGHT);
  r.rect(0, 0, FACE_WIDTH, FACE_HEIGHT, BACKDROP);
  const hair = color(look.hair, 7);
  if (look.longHair) r.ellipse(HEAD_CENTER_X, HEAD_CENTER_Y + 4, look.headRx + 3, look.headRy + 2, () => hair);
  r.rect(4, SHOULDER_TOP, FACE_WIDTH - 8, FACE_HEIGHT - SHOULDER_TOP, color(look.shirt, 7));
  r.rect(HEAD_CENTER_X - 4, SHOULDER_TOP - 3, 9, 3, SKIN);
  r.ellipse(HEAD_CENTER_X, HEAD_CENTER_Y, look.headRx, look.headRy, () => SKIN);
  r.ellipse(HEAD_CENTER_X, HEAD_CENTER_Y - 6, look.headRx, look.headRy - 6, (_nx, ny) => (ny < -0.2 ? hair : SKIN));
  for (let y = 0; y < look.hairline; y++) for (let x = 0; x < FACE_WIDTH; x++) if (r.get(x, y) === SKIN) r.set(x, y, hair);
  r.rect(HEAD_CENTER_X - 1, 22, 2, 4, SKIN_DARK);
  const [eyesX, eyesY] = GENERIC_FACE.eyes;
  const [mouthX, mouthY] = GENERIC_FACE.mouth;
  blit(r, eyesRaster(look, 'open'), eyesX, eyesY);
  blit(r, mouthRaster('closed'), mouthX, mouthY);
  return r;
}

function subImage(r: IndexedRaster): StiSubImage {
  return { offsetX: 0, offsetY: 0, width: r.width, height: r.height, pixels: r.pixels };
}

export function encodeStubFace(bodyType: number): Uint8Array {
  const look = BODY_LOOKS[bodyType] ?? (BODY_LOOKS[0] as BodyLook);
  const frames = [
    faceRaster(look),
    ...EYE_FRAMES.map((state) => eyesRaster(look, state)),
    ...MOUTH_FRAMES.map((state) => mouthRaster(state)),
  ];
  return encodeStiIndexed({ palette: buildPalette(), subImages: frames.map(subImage) });
}

export interface StubFaceProfile {
  readonly id: number;
  readonly faceIndex: number;
  readonly bodyType: number;
}

export async function stubFaceProfiles(): Promise<StubFaceProfile[]> {
  const json = JSON.parse(await readFile(join(import.meta.dirname, '..', STUB_PROFILES_FILE), 'utf8'));
  return asArray(asObject(json, 'stub profiles').profiles, 'stub profiles').map((p, i) => {
    const o = asObject(p, `stub profiles[${i}]`);
    const id = asInt(o.id, `stub profiles[${i}].id`);
    const face = o.face === undefined ? {} : asObject(o.face, `stub profiles[${i}].face`);
    const faceIndex = face.index === undefined ? id : asInt(face.index, `stub profiles[${i}].face.index`);
    return { id, faceIndex, bodyType: o.bodyType === undefined ? 0 : asInt(o.bodyType, `stub profiles[${i}].bodyType`) };
  });
}

export function smallFacePath(faceIndex: number): string {
  return `${FACES_DIR}/${String(faceIndex).padStart(FACE_INDEX_DIGITS, '0')}.sti`;
}

export async function buildStubFaces(out: string, aliases: Map<string, string>): Promise<string[]> {
  const written: string[] = [];
  for (let body = 0; body < GENERIC_FACE_BODY_TYPES; body++) {
    const path = genericFacePath(body);
    await mkdir(dirname(join(out, path)), { recursive: true });
    await writeFile(join(out, path), encodeStubFace(body));
    written.push(path);
  }
  for (const profile of await stubFaceProfiles()) aliases.set(smallFacePath(profile.faceIndex), genericFacePath(profile.bodyType));
  return written;
}

const AIM_MEMBERS_TABLE = 'tables/ui-constants/AIMMembers.json';
const MEDIUM_FACE = { width: 31, height: 27 };

async function bigFaceSize(): Promise<{ width: number; height: number }> {
  const constants = asObject(
    asObject(JSON.parse(await readFile(join(PROJECT_DATA_DIR, AIM_MEMBERS_TABLE), 'utf8')), 'AIMMembers').constants,
    'constants',
  );
  return { width: asInt(constants.FACE_WIDTH, 'FACE_WIDTH'), height: asInt(constants.FACE_HEIGHT, 'FACE_HEIGHT') };
}

export async function buildStubPortraits(out: string, exists: (path: string) => boolean): Promise<string[]> {
  const sizes: readonly (readonly [PortraitSize, { width: number; height: number }])[] = [
    ['big', await bigFaceSize()],
    ['medium', MEDIUM_FACE],
  ];
  const written: string[] = [];
  const faces = [...new Set((await stubFaceProfiles()).map((p) => p.faceIndex))].sort((a, b) => a - b);
  for (const face of faces)
    for (const [size, { width, height }] of sizes) {
      const path = portraitPath(face, size);
      if (exists(path)) continue;
      const bytes = await encodeStubAsset({
        path,
        kind: 'sti',
        frames: [{ width, height, state: 'plain', hollow: false }],
        animated: 0,
        layouts: [],
        style: 'solid',
      });
      await mkdir(dirname(join(out, path)), { recursive: true });
      await writeFile(join(out, path), bytes);
      written.push(path);
    }
  return written;
}
