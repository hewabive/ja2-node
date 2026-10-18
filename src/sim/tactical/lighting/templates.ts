// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Lighting.cc LightCreateTemplateNode, LightAddTemplateNode, LightAddRayNode, LightInsertRayNode,
// @src LightAddNode, LightInsertNode, LinearDistanceDouble, LightCastRay, LightGenerateElliptical, LightCreateOmni,
// @src LightLoadCachedTemplate; assets/externalized/light-templates.json (form of the shipped templates). See docs/20.

import { i16, idiv } from '../../../core/int.ts';

export const LIGHT_NEW_RAY = 0x8000;
export const LIGHT_CENTRE_NODE = 1;

const DISTANCE_SCALE = 4;
const LIGHT_DECAY = 0.9;
const RAY_MARKER_COORD = 32767;

export interface LightNode {
  readonly dx: number;
  readonly dy: number;
  readonly light: number;
}

export interface LightTemplate {
  readonly name: string;
  readonly lights: readonly LightNode[];
  readonly rays: readonly number[];
}

interface TemplateBuilder {
  readonly lights: LightNode[];
  readonly rays: number[];
}

const OMNI_TEMPLATES: Readonly<Record<string, readonly [intensity: number, radius: number]>> = {
  'L-R01.LHT': [1, 1],
  'L-R01I2.LHT': [4, 2],
  'L-R02.LHT': [2, 2],
  'L-R03.LHT': [3, 3],
  'L-R04.LHT': [4, 4],
  'L-R05.LHT': [5, 5],
  'L-R06.LHT': [6, 6],
  'L-R07.LHT': [7, 7],
  'L-R08.LHT': [8, 8],
};

function addTemplateNode(t: TemplateBuilder, x: number, y: number, light: number): number {
  const existing = t.lights.findIndex((n) => n.dx === x && n.dy === y);
  if (existing >= 0) return existing;
  t.lights.push({ dx: x, dy: y, light });
  return t.lights.length - 1;
}

function linearDistance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = Math.abs(x1 - x2);
  const dy = Math.abs(y1 - y2);
  return Math.sqrt(dx * dx + dy * dy);
}

function shadeAt(hotSpotX: number, hotSpotY: number, x: number, y: number, intensity: number): number {
  const decay = Math.trunc((linearDistance(x, y, hotSpotX, hotSpotY) / DISTANCE_SCALE) * LIGHT_DECAY);
  return decay >= intensity ? 0 : intensity - decay;
}

function rayNode(t: TemplateBuilder, hotSpotX: number, hotSpotY: number, x: number, y: number, intensity: number, flags: number): number {
  const shade = shadeAt(hotSpotX, hotSpotY, x, y, intensity);
  return addTemplateNode(t, i16(idiv(x, DISTANCE_SCALE)), i16(idiv(y, DISTANCE_SCALE)), shade) | flags;
}

function addRayMarker(t: TemplateBuilder): void {
  t.rays.push(rayNode(t, RAY_MARKER_COORD, RAY_MARKER_COORD, RAY_MARKER_COORD, RAY_MARKER_COORD, 0, LIGHT_NEW_RAY));
}

interface RayPlotter {
  plot(x: number, y: number): void;
}

function rayPlotter(t: TemplateBuilder, startX: number, startY: number, intensity: number, insertAt: number | null): RayPlotter {
  return {
    plot(x, y) {
      const node = rayNode(t, startX, startY, x, y, intensity, 0);
      if (insertAt === null) t.rays.push(node);
      else t.rays.splice(insertAt, 0, node);
    },
  };
}

function plotRun(p: RayPlotter, count: number, at: { x: number; y: number }, stepX: number, stepY: number): void {
  for (let i = 0; i < count; i++) {
    p.plot(at.x, at.y);
    at.x += stepX;
    at.y += stepY;
  }
}

function plotMajorAxisLine(
  p: RayPlotter,
  at: { x: number; y: number },
  major: number,
  minor: number,
  xMajor: boolean,
  xAdvance: number,
): void {
  const wholeStep = idiv(major, minor);
  const adjUp = (major % minor) * 2;
  const adjDown = minor * 2;
  let errorTerm = (major % minor) - minor * 2;
  let initialPixelCount = idiv(wholeStep, 2) + 1;
  const finalPixelCount = initialPixelCount;
  if (adjUp === 0 && (wholeStep & 1) === 0) initialPixelCount--;
  if ((wholeStep & 1) !== 0) errorTerm += minor;
  const runX = xMajor ? xAdvance : 0;
  const runY = xMajor ? 0 : 1;
  const stepAcross = () => {
    if (xMajor) at.y++;
    else at.x += xAdvance;
  };
  plotRun(p, initialPixelCount, at, runX, runY);
  stepAcross();
  for (let j = 0; j < minor - 1; j++) {
    let runLength = wholeStep;
    errorTerm += adjUp;
    if (errorTerm > 0) {
      runLength++;
      errorTerm -= adjDown;
    }
    plotRun(p, runLength, at, runX, runY);
    stepAcross();
  }
  plotRun(p, finalPixelCount, at, runX, runY);
  stepAcross();
}

function lightCastRay(t: TemplateBuilder, startX: number, startY: number, endX: number, endY: number, intensity: number): void {
  const reversed = startY > endY;
  const at = reversed ? { x: endX, y: endY } : { x: startX, y: startY };
  const toX = reversed ? startX : endX;
  const toY = reversed ? startY : endY;
  let xDelta = toX - at.x;
  let xAdvance = 1;
  if (xDelta < 0) {
    xAdvance = -1;
    xDelta = -xDelta;
  }
  const yDelta = toY - at.y;
  if (xDelta === 0 && yDelta === 0) return;
  addRayMarker(t);
  const p = rayPlotter(t, startX, startY, intensity, reversed ? t.rays.length : null);
  if (xDelta === 0) plotRun(p, yDelta + 1, at, 0, 1);
  else if (yDelta === 0) plotRun(p, xDelta + 1, at, xAdvance, 0);
  else if (xDelta === yDelta) plotRun(p, xDelta + 1, at, xAdvance, 1);
  else if (xDelta >= yDelta) plotMajorAxisLine(p, at, xDelta, yDelta, true, xAdvance);
  else plotMajorAxisLine(p, at, yDelta, xDelta, false, xAdvance);
}

function castSymmetricRays(t: TemplateBuilder, intensity: number, x: number, y: number): void {
  lightCastRay(t, 0, 0, x, -y, intensity);
  lightCastRay(t, 0, 0, -x, -y, intensity);
  lightCastRay(t, 0, 0, x, y, intensity);
  lightCastRay(t, 0, 0, -x, y, intensity);
}

function lightGenerateElliptical(t: TemplateBuilder, intensity: number, a: number, b: number): void {
  const aSquared = a * a;
  const bSquared = b * b;
  lightCastRay(t, 0, 0, 0, b, intensity);
  lightCastRay(t, 0, 0, 0, -b, intensity);
  for (let workingX = 1; ; workingX++) {
    const temp = bSquared - (bSquared * workingX * workingX) / aSquared;
    const workingY = temp >= 0 ? Math.trunc(Math.sqrt(temp) + 0.5) : 0;
    if (workingY / bSquared <= workingX / aSquared) break;
    castSymmetricRays(t, intensity, workingX, workingY);
  }
  lightCastRay(t, 0, 0, a, 0, intensity);
  lightCastRay(t, 0, 0, -a, 0, intensity);
  for (let workingY = 1; ; workingY++) {
    const temp = aSquared - (aSquared * workingY * workingY) / bSquared;
    const workingX = temp >= 0 ? Math.trunc(Math.sqrt(temp) + 0.5) : 0;
    if (workingX / aSquared < workingY / bSquared) break;
    castSymmetricRays(t, intensity, workingX, workingY);
  }
}

export function lightCreateOmni(intensity: number, radius: number): LightTemplate {
  const t: TemplateBuilder = { lights: [], rays: [] };
  lightGenerateElliptical(t, intensity, radius * DISTANCE_SCALE, radius * DISTANCE_SCALE);
  return { name: `LTO${radius}.LHT`, lights: t.lights, rays: t.rays };
}

function splitRays(rays: readonly number[]): number[][] {
  const split: number[][] = [];
  let current: number[] | null = null;
  for (const entry of rays) {
    if (entry & LIGHT_NEW_RAY) {
      if (current) split.push(current);
      current = [];
    } else if (current && current[current.length - 1] !== entry) current.push(entry);
  }
  return split;
}

export function asShippedTemplate(name: string, template: LightTemplate): LightTemplate {
  const seen = new Set<string>();
  const rays: number[] = [];
  for (const ray of splitRays(template.rays)) {
    const key = ray.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    rays.push(LIGHT_NEW_RAY, ...ray);
  }
  return { name, lights: template.lights, rays };
}

const cache = new Map<string, LightTemplate | null>();

function buildTemplate(name: string): LightTemplate | null {
  const omni = OMNI_TEMPLATES[name];
  if (!omni) return null;
  return asShippedTemplate(name, lightCreateOmni(omni[0], omni[1]));
}

export function cachedLightTemplateName(value: object): string | null {
  const name = (value as { readonly name?: unknown }).name;
  return typeof name === 'string' && cache.get(name) === value ? name : null;
}

export function lightTemplate(name: string): LightTemplate | null {
  const key = name.toUpperCase();
  let template = cache.get(key);
  if (template === undefined) {
    template = buildTemplate(key);
    cache.set(key, template);
  }
  return template;
}
