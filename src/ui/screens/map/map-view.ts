// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-21. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Map_Screen_Interface_Map.cc DrawMap (b_map.pcx blitted at half scale at MAP_VIEW_START_X + 1,
// @src the unvisited and airspace shading, secret sites, SAM sites, mines, town borders and names, militia, the bullseye,
// @src the sublevel maps with the unvisited sectors filled near black, the mine markers, teams and vehicles or enemies
// @src with militia, items, the level string), ShadeMapElem (ShadowRect one pixel higher for the black shade, the tinted
// @src copies of the cell otherwise), InitializePalettesForMap, ShowTownText, ShowOnDutyTeam, ShowAssignedTeam,
// @src ShowVehicles, ShowEnemiesInSector, ShowUncertainNumberEnemiesInSector, HandleShowingOfEnemyForcesInSector,
// @src ShowPeopleInMotion (the arrows of PlayersBetweenTheseSectors with their offsets and SMALLCOMPFONT counts),
// @src DrawSite, BlitMineText, BlitTownGridMarkers, BlitMineGridMarkers, DisplayLevelString, ShowSAMSitesOnStrategicMap,
// @src BlitSAMGridMarkers, ShowItemsOnMap, DrawMapBoxIcon, DrawMilitiaForcesForSector, DrawBullseye,
// @src HideExistenceOfUndergroundMapSector, DrawMapIndexBigMap, DisplayPositionOfHelicopter (the icon interpolated
// @src between its sector and the next by the flight progress, the passenger count), DisplayDestinationOfHelicopter;
// @src src/game/Strategic/MapScreen.cc RenderMapCursorsIndexesAnims (the white hover outline, the yellow selected outline
// @src flashing white every 300 ms while hovered), RenderMapHighlight; src/game/Strategic/Strategic_Movement.cc
// @src PlayersBetweenTheseSectors (vehicles count one less, the helicopter group skipped in airspace mode,
// @src ABOUT_TO_ARRIVE_DELAY); src/game/Strategic/Map_Screen_Interface.cc HandleBlitOfSectorLocatorIcon (hilite.sti, red
// @src frames from 0 and yellow from 13, ANIMATED_BATTLEICON_FRAME_TIME).

import { MAP_SIDE, type Sector, sectorId, strategicIndex } from '../../../content/strategic/sector-ids.ts';
import { DEFAULT_SHADOW, FontColor } from '../../../content/text/font-colors.ts';
import { idiv } from '../../../core/int.ts';
import type { StrategicHelicopterView, StrategicMercView, StrategicView } from '../../../protocol/view.ts';
import { frameOf, type ImageCatalog } from '../../assets.ts';
import { type DrawList, rgb } from '../../draw-list.ts';
import { type BitmapFont, fontHeight } from '../../text/bitmap-font.ts';
import { centerAlign, hCenterVCenterAlign, stringPixLength } from '../../text/measure.ts';
import { sprintMoney } from '../../text/money.ts';
import { fontColors, mprint, withClip } from '../../text/print.ts';
import type { UiTextService } from '../../text/text-service.ts';
import { Assignment, isVehicle } from './character-list.ts';
import { isSecretFound, isTownFound, LandType, type MapFacts, parseSectorLabel } from './facts.ts';
import { type PathPiece, whiteArrow } from './path-trace.ts';

export const MAP_GRID_X = 21;
export const MAP_GRID_Y = 18;
export const MAP_VIEW_START_X = 270;
export const MAP_VIEW_START_Y = 10;
export const MAP_VIEW_WIDTH = 336;
export const MAP_VIEW_HEIGHT = 298;
const MAP_X_ICON_OFFSET = 2;
const MAP_Y_ICON_OFFSET = 1;
const MERC_ICONS_PER_LINE = 6;
const ROWS_PER_SECTOR = 5;
const SMALL_YELLOW_BOX = 0;
const SMALL_DULL_YELLOW_BOX = 2;
const SMALL_WHITE_BOX = 4;
const SMALL_RED_BOX = 6;
const SMALL_QUESTION_MARK = 8;
const MILITIA_SMALL_ICON = 5;
const MAP_LEVEL_STRING_X = 432;
const MAP_LEVEL_STRING_Y = 305;
const MAP_INDEX_COLOR = 119;
const MAP_HORT_INDEX_X = 292;
const MAP_HORT_INDEX_Y = 10;
const MAP_VERT_INDEX_X = 273;
const MAP_VERT_INDEX_Y = 31;
const ABOUT_TO_ARRIVE_DELAY = 5;
const HELI_ICON = 0;
const HELI_SHADOW_ICON = 1;
const HELI_OFFSET_X = 1;
const HELI_OFFSET_Y = 3;
const HELI_COUNT_DX = 5;
const HELI_COUNT_DY = 1;
const GREY_LINES = rgb(100, 100, 100);
const RGB_WHITE = rgb(255, 255, 255);
const RGB_YELLOW = rgb(255, 255, 0);
const UNDERGROUND_NEAR_BLACK = rgb(2, 2, 0);
const LOYALTY_MIN_X_OFFSET = 23;
const MIN_RATING_TO_TRAIN_TOWN = 20;
const LOCATOR_YELLOW_FRAME = 13;
const LOCATOR_FRAMES = 13;
const ANIMATED_BATTLEICON_FRAME_TIME = 80;
const MAP_STRINGS = {
  vert: 'pMapVertIndex',
  hort: 'pMapHortIndex',
  level: 'sMapLevelString',
  loyal: 'gsLoyalString',
  mine: 'pwMineStrings',
  landTypes: 'strategic-map-land-types',
  towns: 'strategic-map-town-names',
} as const;
const MINE_WORD = 0;
const MINE_ABANDONED = 5;
const MINE_SHUT_DOWN = 6;
const MINE_RUNNING_OUT = 7;

const ARROWS: readonly { readonly dx: number; readonly dy: number }[] = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
];
const ARROW_OFFSETS = {
  northSouthCenter: 5,
  northX: 10,
  southX: 0,
  northY: -10,
  southY: 10,
  eastWestCenter: 2,
  eastY: 8,
  westY: -2,
  eastX: 15,
  westX: -8,
} as const;
const ARROW_TEXT: readonly { readonly x: number; readonly y: number }[] = [
  { x: 1, y: 4 },
  { x: 2, y: 0 },
  { x: 1, y: 2 },
  { x: 4, y: 0 },
];
const ICON_WIDTH = 8;

export type Tint = 'none' | 'black' | 'ltRed' | 'dkRed' | 'ltGreen' | 'dkGreen';

export interface MapBoardArt {
  readonly normal: string;
  readonly ltRed: string;
  readonly dkRed: string;
  readonly ltGreen: string;
  readonly dkGreen: string;
}

export interface MapViewArt {
  readonly board: MapBoardArt;
  readonly subLevels: readonly string[];
  readonly boxes: string;
  readonly mapCursors: string;
  readonly betweenIcons: string;
  readonly arrivingIcons: string;
  readonly helicopter: string;
  readonly hilite: string;
  readonly sam: string;
  readonly mine: string;
  readonly militia: string;
  readonly bullseye: string;
  readonly secretIcon: (path: string) => string;
}

export interface MapFilters {
  towns: boolean;
  mines: boolean;
  teams: boolean;
  militia: boolean;
  airspace: boolean;
  items: boolean;
}

export interface Locator {
  readonly sector: Sector;
  readonly colour: 'red' | 'yellow';
}

export interface MapViewInput {
  readonly strategic: StrategicView;
  readonly level: number;
  readonly filters: MapFilters;
  readonly hover: Sector | null;
  readonly selected: Sector;
  readonly drawCursors: boolean;
  readonly selectedYellow: boolean;
  readonly showSelected: boolean;
  readonly gameJustStarted: boolean;
  readonly changingArrival: boolean;
  readonly permanentPath: readonly PathPiece[];
  readonly animatedNode: number;
  readonly tempPath: readonly PathPiece[];
  readonly locators: readonly Locator[];
  readonly now: number;
  readonly screenWidth: number;
}

export interface MapViewContext {
  readonly list: DrawList;
  readonly origin: { readonly x: number; readonly y: number };
  readonly facts: MapFacts;
  readonly text: UiTextService;
  readonly images: ImageCatalog;
  readonly art: MapViewArt;
  readonly mapFont: BitmapFont;
  readonly iconFont: BitmapFont;
}

function sectorKey(s: { readonly x: number; readonly y: number }): string {
  return `${s.x},${s.y}`;
}

interface Scan {
  readonly visited: Set<string>;
  readonly visitedUnderground: Set<string>;
  readonly enemies: Map<string, number | '?'>;
  readonly militia: Map<string, readonly number[]>;
  readonly items: Map<string, number>;
  readonly airspace: Set<string>;
  readonly playerControlled: Map<string, boolean | null>;
  readonly found: Set<number>;
  readonly towns: Map<number, number>;
}

function scan(strategic: StrategicView): Scan {
  const visited = new Set<string>();
  const enemies = new Map<string, number | '?'>();
  const militia = new Map<string, readonly number[]>();
  const items = new Map<string, number>();
  const playerControlled = new Map<string, boolean | null>();
  for (const s of strategic.sectors) {
    const sector = parseSectorLabel(s.sector);
    if (!sector) continue;
    const key = sectorKey(sector);
    if (s.visited) visited.add(key);
    if (s.enemies !== null) enemies.set(key, s.enemies);
    militia.set(key, s.militia);
    if (s.items !== undefined) items.set(key, s.items);
    playerControlled.set(key, s.playerControlled);
  }
  const visitedUnderground = new Set<string>();
  for (const u of strategic.underground ?? []) {
    const sector = parseSectorLabel(u.sector);
    if (!sector) continue;
    visitedUnderground.add(`${sectorKey(sector)},${sector.z}`);
    items.set(`${sectorKey(sector)},${sector.z}`, u.items);
  }
  const airspace = new Set<string>();
  for (const name of strategic.enemyAirspace ?? []) {
    const sector = parseSectorLabel(name);
    if (sector) airspace.add(sectorKey(sector));
  }
  const found = new Set<number>();
  for (const name of strategic.secretsFound ?? []) {
    const sector = parseSectorLabel(name);
    if (sector) found.add(sectorId(sector));
  }
  const towns = new Map((strategic.towns ?? []).map((t) => [t.town, t.loyalty]));
  return { visited, visitedUnderground, enemies, militia, items, airspace, playerControlled, found, towns };
}

export function cellOrigin(ctx: Pick<MapViewContext, 'origin'>, s: { readonly x: number; readonly y: number }): { x: number; y: number } {
  return { x: ctx.origin.x + MAP_VIEW_START_X + s.x * MAP_GRID_X, y: ctx.origin.y + MAP_VIEW_START_Y + s.y * MAP_GRID_Y };
}

export function mapScreenRect(origin: { readonly x: number; readonly y: number }): { x1: number; y1: number; x2: number; y2: number } {
  return {
    x1: origin.x + MAP_VIEW_START_X + MAP_GRID_X - 2,
    y1: origin.y + MAP_VIEW_START_Y + MAP_GRID_Y - 1,
    x2: origin.x + MAP_VIEW_START_X + MAP_VIEW_WIDTH - 1 + MAP_GRID_X,
    y2: origin.y + MAP_VIEW_START_Y + MAP_VIEW_HEIGHT - 10 + MAP_GRID_Y,
  };
}

function clipToMap(ctx: MapViewContext, draw: () => void): void {
  const r = mapScreenRect(ctx.origin);
  withClip(ctx.list, { x: r.x1, y: r.y1, width: r.x2 - r.x1, height: r.y2 - r.y1 }, draw);
}

function clipForRectangles(ctx: MapViewContext, draw: () => void): void {
  const r = mapScreenRect(ctx.origin);
  withClip(ctx.list, { x: r.x1 - 1, y: r.y1 - 1, width: r.x2 - r.x1 + 3, height: r.y2 - r.y1 + 2 }, draw);
}

function boardImage(art: MapBoardArt, tint: Tint): string {
  switch (tint) {
    case 'ltRed':
      return art.ltRed;
    case 'dkRed':
      return art.dkRed;
    case 'ltGreen':
      return art.ltGreen;
    case 'dkGreen':
      return art.dkGreen;
    default:
      return art.normal;
  }
}

function shadeCell(ctx: MapViewContext, s: Sector, tint: Tint): void {
  const cell = cellOrigin(ctx, s);
  const x = cell.x + 1;
  if (tint === 'black') {
    ctx.list.shadow(x, cell.y - 1, x + MAP_GRID_X - 1, cell.y - 1 + MAP_GRID_Y - 1);
    return;
  }
  const board = { x: ctx.origin.x + MAP_VIEW_START_X + 1, y: ctx.origin.y + MAP_VIEW_START_Y };
  withClip(ctx.list, { x, y: cell.y, width: MAP_GRID_X, height: MAP_GRID_Y }, () =>
    ctx.list.image(boardImage(ctx.art.board, tint), 0, board.x, board.y),
  );
}

function drawSurface(ctx: MapViewContext, input: MapViewInput, s: Scan): void {
  const list = ctx.list;
  list.image(ctx.art.board.normal, 0, ctx.origin.x + MAP_VIEW_START_X + 1, ctx.origin.y + MAP_VIEW_START_Y);
  const airspace = input.filters.airspace;
  for (let x = 1; x <= MAP_SIDE; x++)
    for (let y = 1; y <= MAP_SIDE; y++) {
      const sector = { x, y, z: 0 };
      const key = sectorKey(sector);
      const enemyAir = s.airspace.has(key);
      if (!s.visited.has(key)) shadeCell(ctx, sector, airspace ? (enemyAir ? 'dkRed' : 'dkGreen') : 'black');
      else if (airspace) shadeCell(ctx, sector, enemyAir ? 'ltRed' : 'ltGreen');
    }
  for (const secret of ctx.facts.secrets)
    if (!secret.isSamSite && s.found.has(secret.sector) && secret.mapIcon)
      drawSite(ctx, sectorOfByte(secret.sector), ctx.art.secretIcon(secret.mapIcon));
  showSamSites(ctx, input, s);
  ctx.facts.mines.forEach((mine, i) => {
    const sector = sectorOfByte(mine.entranceSector);
    drawSite(ctx, sector, ctx.art.mine);
    if (input.filters.mines) mineText(ctx, input.strategic, i, sector);
  });
  if (input.filters.towns) {
    townGridMarkers(ctx, s);
    townText(ctx, s);
  }
  if (input.filters.militia) townMilitia(ctx, s);
  if (airspace && !input.changingArrival) bullseye(ctx, input.strategic);
}

function sectorOfByte(id: number): Sector {
  return { x: (id % MAP_SIDE) + 1, y: idiv(id, MAP_SIDE) + 1, z: 0 };
}

function drawSite(ctx: MapViewContext, s: Sector, icon: string): void {
  const cell = cellOrigin(ctx, s);
  const frame = frameOf(ctx.images, icon, 1);
  const maxW = MAP_GRID_X - 1;
  const maxH = MAP_GRID_Y - 1;
  const x = cell.x + 1 + idiv(maxW - frame.width, 2);
  const y = cell.y + (frame.height > maxH ? maxH - frame.height : idiv(maxH - frame.height, 2));
  ctx.list.image(icon, 1, x, y);
}

function showSamSites(ctx: MapViewContext, input: MapViewInput, s: Scan): void {
  if (input.filters.airspace)
    clipForRectangles(ctx, () => {
      for (const sam of ctx.facts.samSectors) {
        if (!isSecretFound(ctx.facts, s.found, sam)) continue;
        const cell = cellOrigin(ctx, sectorOfByte(sam));
        ctx.list.rectangle(cell.x, cell.y - 1, cell.x + MAP_GRID_X, cell.y + MAP_GRID_Y - 1, GREY_LINES);
      }
    });
  for (const sam of ctx.facts.samSectors) {
    if (!isSecretFound(ctx.facts, s.found, sam)) continue;
    const sector = sectorOfByte(sam);
    drawSite(ctx, sector, ctx.art.sam);
    if (!input.filters.airspace) continue;
    const cell = cellOrigin(ctx, sector);
    const label = ctx.text.string(MAP_STRINGS.landTypes, LandType.SAM_SITE) ?? '';
    const x = cell.x + 11 - idiv(stringPixLength(label, ctx.mapFont), 2);
    const y = cell.y + 19;
    const left = ctx.origin.x + MAP_VIEW_START_X;
    const top = ctx.origin.y + MAP_VIEW_START_Y;
    if (x < left || left + MAP_VIEW_WIDTH < x || y < top || top + MAP_VIEW_HEIGHT < y) continue;
    clipToMap(ctx, () => mprint(ctx.list, ctx.mapFont, x, y, label, fontColors(FontColor.MCOLOR_LTYELLOW, DEFAULT_SHADOW)));
  }
}

function centeredBoxed(ctx: MapViewContext, x: number, y: number, text: string, colour: number): void {
  let left = x - idiv(stringPixLength(text, ctx.mapFont), 2);
  const min = ctx.origin.x + MAP_VIEW_START_X + LOYALTY_MIN_X_OFFSET;
  if (left < min) left = min;
  mprint(ctx.list, ctx.mapFont, left, y, text, fontColors(colour, DEFAULT_SHADOW));
}

function mineText(ctx: MapViewContext, strategic: StrategicView, index: number, sector: Sector): void {
  const mine = ctx.facts.mines[index];
  if (!mine) return;
  const cell = cellOrigin(ctx, sector);
  const x = cell.x + idiv(MAP_GRID_X, 2);
  let y = cell.y + MAP_GRID_Y + 1;
  const h = fontHeight(ctx.mapFont);
  const status = (strategic.mines ?? []).find((m) => m.mine === index) ?? null;
  const clip = {
    x: ctx.origin.x + MAP_VIEW_START_X,
    y: ctx.origin.y + MAP_VIEW_START_Y,
    width: MAP_VIEW_WIDTH + MAP_GRID_X,
    height: MAP_VIEW_HEIGHT + 7,
  };
  withClip(ctx.list, clip, () => {
    const town = ctx.text.string(MAP_STRINGS.towns, mine.associatedTownId) ?? '';
    centeredBoxed(ctx, x, y, `${town} ${ctx.text.string(MAP_STRINGS.mine, MINE_WORD) ?? ''}`, FontColor.LTGREEN);
    y += h;
    const statusLine =
      status?.status === 'abandoned'
        ? MINE_ABANDONED
        : status?.status === 'shutDown'
          ? MINE_SHUT_DOWN
          : status?.status === 'runningOut'
            ? MINE_RUNNING_OUT
            : null;
    if (statusLine !== null) {
      centeredBoxed(ctx, x, y, ctx.text.string(MAP_STRINGS.mine, statusLine) ?? '', FontColor.LTGREEN);
      y += h;
    }
    if (status?.playerControls && status.status !== 'abandoned') {
      let text = sprintMoney(status.predictedDailyIncome);
      if (status.maxDailyRemoval > 0) text += ` (${idiv(100 * status.predictedDailyIncome, status.maxDailyRemoval)}%)`;
      centeredBoxed(ctx, x, y, text, FontColor.LTGREEN);
    }
  });
}

function townGridMarkers(ctx: MapViewContext, s: Scan): void {
  clipForRectangles(ctx, () => {
    for (const town of ctx.facts.towns) {
      if (!isTownFound(ctx.facts, s.found, town.townId)) continue;
      for (const id of town.sectors) {
        const sector = sectorOfByte(id);
        const cell = cellOrigin(ctx, sector);
        const w = MAP_GRID_X - 1;
        const h = MAP_GRID_Y;
        const x = cell.x + 2;
        const y = cell.y;
        const blank = (dx: number, dy: number) => ctx.facts.townOf(sectorIdOrBlank(sector.x + dx, sector.y + dy)) === 0;
        if (blank(0, -1)) ctx.list.line(x - 1, y - 1, x + w - 1, y - 1, GREY_LINES);
        if (blank(0, 1)) ctx.list.line(x - 1, y + h - 1, x + w - 1, y + h - 1, GREY_LINES);
        if (blank(-1, 0)) ctx.list.line(x - 2, y - 1, x - 2, y + h - 1, GREY_LINES);
        if (blank(1, 0)) ctx.list.line(x + w - 1, y - 1, x + w - 1, y + h - 1, GREY_LINES);
      }
    }
  });
}

function sectorIdOrBlank(x: number, y: number): number {
  if (x < 1 || y < 1 || x > MAP_SIDE || y > MAP_SIDE) return -1;
  return sectorId({ x, y });
}

function townText(ctx: MapViewContext, s: Scan): void {
  const r = mapScreenRect(ctx.origin);
  withClip(ctx.list, { x: r.x1 + 2, y: r.y1, width: r.x2 - r.x1 - 2, height: r.y2 - r.y1 }, () => {
    for (const town of ctx.facts.towns) {
      if (!isTownFound(ctx.facts, s.found, town.townId)) continue;
      const x = ctx.origin.x + MAP_VIEW_START_X + MAP_GRID_X + idiv(town.townPoint.x * MAP_GRID_X, 10);
      const y = ctx.origin.y + MAP_VIEW_START_Y + MAP_GRID_Y + idiv(town.townPoint.y * MAP_GRID_Y, 10) + 1;
      const left = ctx.origin.x + MAP_VIEW_START_X;
      const top = ctx.origin.y + MAP_VIEW_START_Y;
      if (x < left || left + MAP_VIEW_WIDTH < x || y < top || top + MAP_VIEW_HEIGHT < y) continue;
      const loyalty = s.towns.get(town.townId);
      let colour: number = FontColor.MCOLOR_LTGREEN;
      if (loyalty !== undefined && ctx.facts.usesLoyalty[town.townId] === true) {
        colour = loyalty < MIN_RATING_TO_TRAIN_TOWN && town.isMilitiaTrainingAllowed ? FontColor.MCOLOR_RED : FontColor.MCOLOR_LTGREEN;
        const text = (ctx.text.string(MAP_STRINGS.loyal, 0) ?? '%d%%').replace('%d', String(loyalty)).replace('%%', '%');
        let lx = x - idiv(stringPixLength(text, ctx.mapFont), 2);
        const min = left + LOYALTY_MIN_X_OFFSET;
        if (lx < min) lx = min;
        mprint(ctx.list, ctx.mapFont, lx, y + fontHeight(ctx.mapFont), text, fontColors(colour, DEFAULT_SHADOW));
      }
      const name = ctx.text.string(MAP_STRINGS.towns, town.townId) ?? '';
      mprint(ctx.list, ctx.mapFont, x - idiv(stringPixLength(name, ctx.mapFont), 2), y, name, fontColors(colour, DEFAULT_SHADOW));
    }
  });
}

function boxIcon(ctx: MapViewContext, image: string, frame: number, s: Sector, pos: number): void {
  if (pos >= MERC_ICONS_PER_LINE * ROWS_PER_SECTOR) return;
  const cell = cellOrigin(ctx, s);
  const col = pos % MERC_ICONS_PER_LINE;
  const row = idiv(pos, MERC_ICONS_PER_LINE);
  ctx.list.image(image, frame, cell.x + MAP_X_ICON_OFFSET + 3 * col, cell.y + MAP_Y_ICON_OFFSET + 3 * row);
}

function militiaForSector(ctx: MapViewContext, s: Scan, id: number): void {
  const sector = sectorOfByte(id);
  const key = sectorKey(sector);
  if (s.playerControlled.get(key) === false || !s.playerControlled.has(key)) return;
  const counts = s.militia.get(key) ?? [];
  let pos = 0;
  counts.forEach((n, rank) => {
    for (let i = 0; i < n; i++) boxIcon(ctx, ctx.art.militia, MILITIA_SMALL_ICON + rank, sector, pos++);
  });
}

function townMilitia(ctx: MapViewContext, s: Scan): void {
  clipToMap(ctx, () => {
    for (const town of ctx.facts.towns) for (const id of town.sectors) militiaForSector(ctx, s, id);
    for (const sam of ctx.facts.samSectors) militiaForSector(ctx, s, sam);
  });
}

function militiaCount(s: Scan, sector: Sector): number {
  return (s.militia.get(sectorKey(sector)) ?? []).reduce((a, b) => a + b, 0);
}

function bullseye(ctx: MapViewContext, strategic: StrategicView): void {
  const zone = strategic.landingZone ? parseSectorLabel(strategic.landingZone) : null;
  if (!zone) return;
  const cell = cellOrigin(ctx, zone);
  ctx.list.image(ctx.art.bullseye, 0, cell.x, cell.y - 2);
}

function drawUnderground(ctx: MapViewContext, input: MapViewInput, s: Scan): void {
  const image = ctx.art.subLevels[input.level - 1];
  if (image) ctx.list.image(image, 0, ctx.origin.x + MAP_VIEW_START_X + 21, ctx.origin.y + MAP_VIEW_START_Y + 17);
  for (const u of ctx.facts.underground) {
    if (u.z !== input.level) continue;
    const sector = sectorOfByte(u.sector);
    if (s.visitedUnderground.has(`${sectorKey(sector)},${u.z}`)) continue;
    const cell = cellOrigin(ctx, sector);
    ctx.list.fill(cell.x + 1, cell.y, cell.x + MAP_GRID_X, cell.y + MAP_GRID_Y - 1, UNDERGROUND_NEAR_BLACK);
  }
}

function mineGridMarkers(ctx: MapViewContext): void {
  clipForRectangles(ctx, () => {
    for (const mine of ctx.facts.mines) {
      const cell = cellOrigin(ctx, sectorOfByte(mine.entranceSector));
      ctx.list.rectangle(cell.x, cell.y - 1, cell.x + MAP_GRID_X, cell.y + MAP_GRID_Y - 1, GREY_LINES);
    }
  });
}

function inHelicopter(strategic: StrategicView, m: StrategicMercView): boolean {
  const heli = strategic.helicopter;
  return m.assignment === Assignment.VEHICLE && heli !== undefined && !('destroyed' in heli) && m.vehicle === heli.vehicle;
}

function groupInMotion(strategic: StrategicView, m: StrategicMercView): boolean {
  if (m.assignment === Assignment.VEHICLE) {
    const v = (strategic.vehicles ?? []).find((x) => x.id === m.vehicle);
    if (v) return v.betweenSectors;
  }
  return m.betweenSectors;
}

function mercSector(m: StrategicMercView): Sector | null {
  return parseSectorLabel(m.sector);
}

function sameXyz(a: Sector | null, b: Sector): boolean {
  return a !== null && a.x === b.x && a.y === b.y && a.z === b.z;
}

function teamIcons(ctx: MapViewContext, strategic: StrategicView, sector: Sector, mercs: readonly StrategicMercView[]): number {
  let pos = 0;
  for (const m of mercs) {
    if (isVehicle(m) || !sameXyz(mercSector(m), sector) || m.life <= 0) continue;
    if (m.assignment >= Assignment.ON_DUTY && m.assignment !== Assignment.VEHICLE) continue;
    if (inHelicopter(strategic, m) || groupInMotion(strategic, m)) continue;
    boxIcon(ctx, ctx.art.boxes, SMALL_YELLOW_BOX, sector, pos++);
  }
  for (const m of mercs) {
    if (isVehicle(m) || !sameXyz(mercSector(m), sector) || m.life <= 0) continue;
    if (m.assignment < Assignment.ON_DUTY || m.assignment === Assignment.VEHICLE) continue;
    if (m.assignment === Assignment.IN_TRANSIT || m.assignment === Assignment.ASSIGNMENT_POW) continue;
    if (groupInMotion(strategic, m)) continue;
    boxIcon(ctx, ctx.art.boxes, SMALL_DULL_YELLOW_BOX, sector, pos++);
  }
  const heli = strategic.helicopter;
  const heliId = heli && !('destroyed' in heli) ? heli.vehicle : -1;
  for (const v of strategic.vehicles ?? []) {
    if (v.id === heliId || v.betweenSectors) continue;
    if (!sameXyz(parseSectorLabel(v.sector), sector)) continue;
    boxIcon(ctx, ctx.art.boxes, SMALL_WHITE_BOX, sector, pos++);
  }
  return pos;
}

function enemyIcons(ctx: MapViewContext, input: MapViewInput, s: Scan, sector: Sector, pos: number): void {
  if (input.gameJustStarted || sector.z !== 0) return;
  const known = s.enemies.get(sectorKey(sector));
  if (known === undefined) return;
  if (known === '?') {
    const cell = cellOrigin(ctx, sector);
    ctx.list.image(ctx.art.boxes, SMALL_QUESTION_MARK, cell.x + MAP_X_ICON_OFFSET, cell.y - 1);
    return;
  }
  for (let i = 0; i < known; i++) boxIcon(ctx, ctx.art.boxes, SMALL_RED_BOX, sector, pos + i);
}

interface Traffic {
  leaving: number;
  arriving: number;
  aboutToArrive: boolean;
}

function traffic(input: MapViewInput, from: number, to: number): Traffic {
  const strategic = input.strategic;
  const heli = strategic.helicopter;
  const heliVehicle = heli && !('destroyed' in heli) ? heli.vehicle : -1;
  const heliGroup = (strategic.vehicles ?? []).find((v) => v.id === heliVehicle)?.group ?? -1;
  const vehicleGroups = new Map((strategic.vehicles ?? []).map((v) => [v.group ?? -1, v]));
  const vehicleMercs = new Set(strategic.mercs.filter((m) => isVehicle(m)).map((m) => m.id));
  const t: Traffic = { leaving: 0, arriving: 0, aboutToArrive: false };
  const groups = [
    ...strategic.groups,
    ...(strategic.vehicles ?? [])
      .filter((v) => !strategic.groups.some((g) => g.id === v.group))
      .map((v) => ({
        id: v.group ?? -1,
        sector: v.sector,
        next: v.next ?? null,
        betweenSectors: v.betweenSectors,
        members: v.passengers,
        nextArrivalMinutes: v.nextArrivalMinutes ?? null,
      })),
  ];
  for (const g of groups) {
    const isHeli = g.id === heliGroup;
    if (isHeli && input.filters.airspace) continue;
    if (!g.betweenSectors || !g.next) continue;
    const cur = parseSectorLabel(g.sector);
    const next = parseSectorLabel(g.next);
    if (!cur || !next) continue;
    const vehicle = vehicleGroups.get(g.id);
    const members = g.members.filter((id) => !vehicleMercs.has(id)).length;
    if (members === 0 && !vehicle) continue;
    const curId = strategicIndex(cur);
    const nextId = strategicIndex(next);
    if (curId === from && nextId === to) {
      t.leaving += members;
      if ((g.nextArrivalMinutes ?? Number.MAX_SAFE_INTEGER) <= ABOUT_TO_ARRIVE_DELAY) t.aboutToArrive = true;
    } else if (curId === to && nextId === from) t.arriving += members;
  }
  return t;
}

function peopleInMotion(ctx: MapViewContext, input: MapViewInput, sector: Sector): void {
  if (sector.z !== 0) return;
  const source = strategicIndex(sector);
  ARROWS.forEach((d, dir) => {
    if (dir === 0 && sector.y <= 1) return;
    if (dir === 1 && sector.x >= MAP_SIDE) return;
    if (dir === 2 && sector.y >= MAP_SIDE) return;
    if (dir === 3 && sector.x <= 1) return;
    const dest = strategicIndex({ x: sector.x + d.dx, y: sector.y + d.dy });
    const t = traffic(input, source, dest);
    if (t.leaving <= 0) return;
    let ox: number;
    let oy: number;
    if (dir % 2 === 0) {
      ox = t.arriving > 0 ? (dir === 0 ? ARROW_OFFSETS.northX : ARROW_OFFSETS.southX) : ARROW_OFFSETS.northSouthCenter;
      oy = dir === 0 ? ARROW_OFFSETS.northY : ARROW_OFFSETS.southY;
    } else {
      oy = t.arriving > 0 ? (dir === 1 ? ARROW_OFFSETS.eastY : ARROW_OFFSETS.westY) : ARROW_OFFSETS.eastWestCenter;
      ox = dir === 1 ? ARROW_OFFSETS.eastX : ARROW_OFFSETS.westX;
    }
    const cell = cellOrigin(ctx, sector);
    const x = cell.x + ox;
    const y = cell.y + MAP_Y_ICON_OFFSET + oy;
    ctx.list.image(t.aboutToArrive ? ctx.art.arrivingIcons : ctx.art.betweenIcons, dir, x, y);
    const text = String(t.leaving);
    const at = centerAlign(x + (ARROW_TEXT[dir]?.x ?? 0), y + (ARROW_TEXT[dir]?.y ?? 0), ICON_WIDTH, text, ctx.iconFont);
    mprint(ctx.list, ctx.iconFont, at.x, at.y, text, fontColors(t.aboutToArrive ? FontColor.BLACK : FontColor.WHITE, DEFAULT_SHADOW));
  });
}

function teamsAndVehicles(ctx: MapViewContext, input: MapViewInput, s: Scan, mercs: readonly StrategicMercView[]): void {
  for (let x = 1; x <= MAP_SIDE; x++)
    for (let y = 1; y <= MAP_SIDE; y++) {
      const sector = { x, y, z: input.level };
      const pos = teamIcons(ctx, input.strategic, sector, mercs);
      enemyIcons(ctx, input, s, sector, pos);
      peopleInMotion(ctx, input, sector);
    }
}

function enemiesWithMilitia(ctx: MapViewContext, input: MapViewInput, s: Scan): void {
  for (let x = 1; x <= MAP_SIDE; x++)
    for (let y = 1; y <= MAP_SIDE; y++) {
      const sector = { x, y, z: input.level };
      enemyIcons(ctx, input, s, sector, militiaCount(s, sector));
    }
}

function itemsOnMap(ctx: MapViewContext, input: MapViewInput, s: Scan): void {
  const r = mapScreenRect(ctx.origin);
  withClip(ctx.list, { x: r.x1 + 2, y: r.y1, width: r.x2 - r.x1 - 2, height: r.y2 - r.y1 }, () => {
    for (let x = 1; x <= MAP_SIDE; x++)
      for (let y = 1; y <= MAP_SIDE; y++) {
        const key = input.level === 0 ? sectorKey({ x, y }) : `${sectorKey({ x, y })},${input.level}`;
        const visited = input.level === 0 ? s.visited.has(key) : s.visitedUnderground.has(key);
        if (!visited) continue;
        const n = s.items.get(key) ?? 0;
        if (n === 0) continue;
        const cell = cellOrigin(ctx, { x, y });
        const text = String(n);
        const at = hCenterVCenterAlign(cell.x, cell.y, MAP_GRID_X, MAP_GRID_Y, text, ctx.mapFont);
        mprint(ctx.list, ctx.mapFont, at.x, at.y, text, fontColors(FontColor.MCOLOR_LTGREEN, DEFAULT_SHADOW));
      }
  });
}

function levelString(ctx: MapViewContext, level: number): void {
  if (level === 0) return;
  const text = `${ctx.text.string(MAP_STRINGS.level, 0) ?? ''} ${level}`;
  mprint(
    ctx.list,
    ctx.mapFont,
    ctx.origin.x + MAP_LEVEL_STRING_X,
    ctx.origin.y + MAP_LEVEL_STRING_Y,
    text,
    fontColors(MAP_INDEX_COLOR, DEFAULT_SHADOW),
  );
}

export function allowedToHighlight(facts: MapFacts, s: Sector | null): s is Sector {
  if (!s || s.x < 1 || s.y < 1 || s.x > MAP_SIDE || s.y > MAP_SIDE) return false;
  return facts.traversability(sectorId(s)) !== EDGE_OF_WORLD;
}

const EDGE_OF_WORLD = 12;

function highlight(ctx: MapViewContext, s: Sector, colour: number): void {
  if (!allowedToHighlight(ctx.facts, s)) return;
  const cell = cellOrigin(ctx, s);
  clipForRectangles(ctx, () => ctx.list.rectangle(cell.x, cell.y - 1, cell.x + MAP_GRID_X, cell.y + MAP_GRID_Y - 1, colour));
}

function indexLabels(ctx: MapViewContext, input: MapViewInput): void {
  const height = fontHeight(ctx.mapFont);
  const selectedColour = input.selectedYellow ? FontColor.YELLOW : FontColor.WHITE;
  const candidate = input.showSelected;
  for (let i = 1; i <= MAP_SIDE; i++) {
    const colourX = !input.drawCursors
      ? MAP_INDEX_COLOR
      : i === input.selected.x && candidate
        ? selectedColour
        : i === input.hover?.x
          ? FontColor.WHITE
          : MAP_INDEX_COLOR;
    const hort = ctx.text.string(MAP_STRINGS.hort, i) ?? String(i);
    const at = hCenterVCenterAlign(
      ctx.origin.x + MAP_HORT_INDEX_X + (i - 1) * MAP_GRID_X,
      ctx.origin.y + MAP_HORT_INDEX_Y,
      MAP_GRID_X,
      height,
      hort,
      ctx.mapFont,
    );
    mprint(ctx.list, ctx.mapFont, at.x, at.y, hort, fontColors(colourX, DEFAULT_SHADOW));
    const colourY = !input.drawCursors
      ? MAP_INDEX_COLOR
      : i === input.selected.y && candidate
        ? selectedColour
        : i === input.hover?.y
          ? FontColor.WHITE
          : MAP_INDEX_COLOR;
    const vert = ctx.text.string(MAP_STRINGS.vert, i) ?? '';
    const atY = hCenterVCenterAlign(
      ctx.origin.x + MAP_VERT_INDEX_X,
      ctx.origin.y + MAP_VERT_INDEX_Y + (i - 1) * MAP_GRID_Y,
      height,
      MAP_GRID_Y,
      vert,
      ctx.mapFont,
    );
    mprint(ctx.list, ctx.mapFont, atY.x, atY.y, vert, fontColors(colourY, DEFAULT_SHADOW));
  }
}

function cursors(ctx: MapViewContext, input: MapViewInput): void {
  if (input.drawCursors && input.hover) highlight(ctx, input.hover, RGB_WHITE);
  if (input.drawCursors && input.showSelected) highlight(ctx, input.selected, input.selectedYellow ? RGB_YELLOW : RGB_WHITE);
  indexLabels(ctx, input);
}

function paths(ctx: MapViewContext, input: MapViewInput): void {
  clipToMap(ctx, () => {
    input.permanentPath.forEach((piece, i) => {
      ctx.list.image(ctx.art.mapCursors, piece.frame, piece.x, piece.y);
      const arrow = i === input.animatedNode ? whiteArrow(piece)?.arrow : piece.arrow;
      if (arrow) ctx.list.image(ctx.art.mapCursors, arrow.frame, arrow.x, arrow.y);
    });
    for (const piece of input.tempPath) {
      ctx.list.image(ctx.art.mapCursors, piece.frame, piece.x, piece.y);
      if (piece.arrow) ctx.list.image(ctx.art.mapCursors, piece.arrow.frame, piece.arrow.x, piece.arrow.y);
    }
  });
}

export function helicopterIconPosition(
  ctx: Pick<MapViewContext, 'origin'>,
  heli: StrategicHelicopterView,
): { x: number; y: number } | null {
  const from = parseSectorLabel(heli.sector);
  if (!from) return null;
  const next = heli.next ? parseSectorLabel(heli.next) : null;
  const to = next ?? from;
  const ratio = Math.fround(heli.progress ?? 0);
  const min = cellOrigin(ctx, from);
  const max = cellOrigin(ctx, to);
  const x = Math.trunc(Math.fround(min.x + Math.fround(ratio * (max.x - min.x))));
  const y = Math.trunc(Math.fround(min.y + Math.fround(ratio * (max.y - min.y))));
  return { x: x + HELI_OFFSET_X, y: y + HELI_OFFSET_Y };
}

function helicopter(ctx: MapViewContext, input: MapViewInput): void {
  const heli = input.strategic.helicopter;
  if (!heli || 'destroyed' in heli || !input.filters.airspace || input.level !== 0) return;
  clipToMap(ctx, () => {
    if (heli.path.length > 1) {
      const last = parseSectorLabel(heli.path[heli.path.length - 1] as string);
      if (last) {
        const cell = cellOrigin(ctx, last);
        ctx.list.image(ctx.art.helicopter, HELI_SHADOW_ICON, cell.x + HELI_OFFSET_X, cell.y + HELI_OFFSET_Y);
      }
    }
    const at = helicopterIconPosition(ctx, heli);
    if (!at) return;
    ctx.list.image(ctx.art.helicopter, HELI_ICON, at.x, at.y);
    mprint(
      ctx.list,
      ctx.iconFont,
      at.x + HELI_COUNT_DX,
      at.y + HELI_COUNT_DY,
      String(heli.passengers.length),
      fontColors(FontColor.WHITE, DEFAULT_SHADOW),
    );
  });
}

function locators(ctx: MapViewContext, input: MapViewInput): void {
  const frame = idiv(input.now, ANIMATED_BATTLEICON_FRAME_TIME) % LOCATOR_FRAMES;
  for (const l of input.locators) {
    const cell = cellOrigin(ctx, l.sector);
    ctx.list.image(ctx.art.hilite, frame + (l.colour === 'yellow' ? LOCATOR_YELLOW_FRAME : 0), cell.x, cell.y - 1);
  }
}

export function renderMapView(ctx: MapViewContext, input: MapViewInput): void {
  const s = scan(input.strategic);
  if (input.level === 0) drawSurface(ctx, input, s);
  else drawUnderground(ctx, input, s);
  if (input.filters.mines) mineGridMarkers(ctx);
  const mercs = input.strategic.mercs;
  if (input.filters.teams) clipToMap(ctx, () => teamsAndVehicles(ctx, input, s, mercs));
  else if (input.filters.militia) clipToMap(ctx, () => enemiesWithMilitia(ctx, input, s));
  if (input.filters.items) itemsOnMap(ctx, input, s);
  levelString(ctx, input.level);
  locators(ctx, input);
  cursors(ctx, input);
  helicopter(ctx, input);
  paths(ctx, input);
}
