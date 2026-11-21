import { join } from 'node:path';
import { REPO_ROOT } from '../../src/node/repo.ts';
import { bracedBody, readSource, STRACCIATELLA_COMMIT, stripCComments, writeTable } from './c-source.ts';

const FACE_INFO = 'static const FacePosInfo g_face_info[] =';
const COLORS = '} Colors[] =';
const FACE_ROW = /\{\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\}/g;
const COLOR_ROW = /\{\s*([A-Z]+)\s*,\s*([A-Z]+)\s*\}/g;
const COLOR_DEFINE = /#define\s+([A-Z]+)\s+"([A-Z]+)"/g;

function rowsOnly(body: string, row: RegExp): void {
  if (!/^[\s,]*$/.test(body.replace(row, ''))) throw new Error(`table holds more than ${row.source} rows`);
}

function faces(src: string): { eyes: [number, number]; mouth: [number, number] }[] {
  const body = stripCComments(bracedBody(src, FACE_INFO));
  rowsOnly(body, FACE_ROW);
  return [...body.matchAll(FACE_ROW)].map((m) => ({
    eyes: [Number(m[1]), Number(m[2])],
    mouth: [Number(m[3]), Number(m[4])],
  }));
}

function colors(src: string): { skin: string; hair: string }[] {
  const names = new Map([...src.matchAll(COLOR_DEFINE)].map((m) => [m[1] ?? '', m[2] ?? '']));
  const body = stripCComments(bracedBody(src, COLORS));
  rowsOnly(body, COLOR_ROW);
  const palette = (name: string) => {
    const value = names.get(name);
    if (value === undefined) throw new Error(`unknown colour ${name}`);
    return value;
  };
  return [...body.matchAll(COLOR_ROW)].map((m) => ({ skin: palette(m[1] ?? ''), hair: palette(m[2] ?? '') }));
}

const faceInfo = faces(readSource('game/Laptop/IMP_Confirm.cc'));
const palettes = colors(readSource('game/Laptop/IMP_Compile_Character.cc'));
if (faceInfo.length !== palettes.length) throw new Error(`${faceInfo.length} face offsets, ${palettes.length} colours`);

const out = {
  source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: src/game/Laptop/IMP_Confirm.cc g_face_info, src/game/Laptop/IMP_Compile_Character.cc SetMercSkinAndHairColors Colors`,
  license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
  format:
    'portraits: per I.M.P. portrait number (face 200 + number; 0-7 the men, 8-15 the women), the talking face offsets of g_face_info (eyes and mouth, x and y) and the skin and hair palettes of Colors',
  portraits: faceInfo.map((f, i) => ({ ...f, ...palettes[i] })),
};
const target = join(REPO_ROOT, 'data/tables/imp-faces.json');
writeTable(target, out);
console.log(`${faceInfo.length} I.M.P. portraits → ${target}`);
