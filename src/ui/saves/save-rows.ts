// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/SaveLoadScreen.cc DisplaySaveGameEntry (the row fields, the tooltip, the Dead is Dead skull),
// @src SaveLoadSelectedSave (one warning box before a load); src/game/Laptop/Finances.cc InternalSPrintMoney;
// @src src/game/Strategic/Game_Clock.h STARTING_TIME; src/sgp/Types.cc SGPSector::IsValid.

import { isValidSector, sectorShortString } from '../../content/strategic/sector-ids.ts';
import type { GameOptions, Health, LoadWarning, SaveHeader, SaveKind, SaveListing, SessionKind, WorldTime } from '../client/api-types.ts';
import type { LabelId, Labels } from '../text/labels.ts';

const SECONDS_PER_DAY = 86_400;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;
const STARTING_TIME = SECONDS_PER_DAY + SECONDS_PER_HOUR;
const THOUSANDS_GROUP = 3;
const SAVE_NAME_LIMIT = 64;
const SAVE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SAVE_FILE_SUFFIX = /\.(j2s(\.gz)?|gz)$/i;
const RESERVED_SAVE_NAMES: ReadonlySet<string> = new Set(['quicksave', 'auto01', 'auto02', 'error']);
const UPLOAD_FALLBACK_NAME = 'upload';
export const QUICK_SAVE_NAME = 'QuickSave';
export const QUICK_SAVE_ALIAS = 'quick';
const MAX_DESCRIPTION_CHARS = 46;

const DIFFICULTY_LABELS: readonly LabelId[] = ['easy', 'medium', 'hard'];
const SAVE_MODE_LABELS: Readonly<Record<GameOptions['saveMode'], LabelId>> = {
  anywhere: 'saveAnywhere',
  ironMan: 'ironMan',
  deadIsDead: 'deadIsDead',
};
const WARNING_LABELS: Readonly<Record<LoadWarning, LabelId>> = {
  engineDiffers: 'gameVersionDiffers',
  dataVersionDiffers: 'dataVersionDiffers',
  stubPackDiffers: 'stubPackDiffers',
};

export interface SaveRow {
  readonly name: string;
  readonly native: boolean;
  readonly kind: SaveKind | null;
  readonly session: SessionKind | null;
  readonly date: string;
  readonly sector: string;
  readonly mercs: string;
  readonly balance: string;
  readonly description: string;
  readonly deadIsDead: boolean;
  readonly tooltip: string;
  readonly compatible: boolean;
  readonly problems: readonly string[];
}

export function formatMoney(amount: number): string {
  const digits = [...String(Math.trunc(amount))];
  const start = amount < 0 ? 1 : 0;
  const out = ['$'];
  digits.forEach((digit, i) => {
    if (i > start && (digits.length - i) % THOUSANDS_GROUP === 0) out.push(',');
    out.push(digit);
  });
  return out.join('');
}

const twoDigits = (n: number) => String(n).padStart(2, '0');

export function formatDay(labels: Labels, world: WorldTime | null): string {
  if (!world) return '';
  return `${labels.text('day')} ${world.day}, ${twoDigits(world.hour)}:${twoDigits(world.minute)}`;
}

function worldSeconds(world: WorldTime | null): number {
  return world ? world.day * SECONDS_PER_DAY + world.hour * SECONDS_PER_HOUR + world.minute * SECONDS_PER_MINUTE : 0;
}

function nativeSectorString(s: { readonly x: number; readonly y: number; readonly z: number }): string | null {
  if (!isValidSector(s)) return null;
  return s.z ? `${sectorShortString(s)}-${s.z}` : sectorShortString(s);
}

export function formatLocation(labels: Labels, sector: string | null, world: WorldTime | null): string {
  if (sector) return sector;
  return worldSeconds(world) <= STARTING_TIME ? labels.text('notApplicable') : labels.text('noSector');
}

export function formatMercs(labels: Labels, mercs: number): string {
  return `${mercs} ${mercs === 1 ? labels.text('merc') : labels.text('mercs')}`;
}

function optionLines(labels: Labels, options: GameOptions): string[] {
  const difficulty = DIFFICULTY_LABELS[options.difficulty - 1] ?? 'medium';
  return [
    `${labels.text(difficulty)} ${labels.text('difficultySuffix')}`,
    labels.text(SAVE_MODE_LABELS[options.saveMode]),
    labels.text(options.gunNut ? 'tonsOfGuns' : 'normalGuns'),
    labels.text(options.sciFi ? 'sciFiStyle' : 'realisticStyle'),
    `${labels.text('bloodAndGore')}: ${labels.text(options.bloodAndGore ? 'yes' : 'no')}`,
  ];
}

function ownRow(listing: Extract<SaveListing, { native: false }>, labels: Labels): SaveRow {
  const header = listing.header;
  const tooltip = header
    ? [...optionLines(labels, header.options), `${labels.text('dataVersion')}: ${header.content.dataVersion}`, listing.name]
    : [listing.name, ...listing.problems];
  return {
    name: listing.name,
    native: false,
    kind: header?.kind ?? null,
    session: header?.session ?? null,
    date: formatDay(labels, header?.world ?? null),
    sector: header ? formatLocation(labels, header.sector, header.world) : '',
    mercs: header ? formatMercs(labels, header.mercs) : '',
    balance: header ? formatMoney(header.balance) : '',
    description: header?.description ?? listing.name,
    deadIsDead: header?.options.saveMode === 'deadIsDead',
    tooltip: tooltip.join('\n'),
    compatible: listing.compatible,
    problems: listing.problems,
  };
}

function nativeRow(listing: Extract<SaveListing, { native: true }>, labels: Labels): SaveRow {
  const header = listing.header;
  return {
    name: listing.name,
    native: true,
    kind: null,
    session: null,
    date: formatDay(labels, header.world),
    sector: formatLocation(labels, nativeSectorString(header.sector), header.world),
    mercs: formatMercs(labels, header.mercs),
    balance: formatMoney(header.balance),
    description: header.description,
    deadIsDead: header.options.saveMode === 'deadIsDead',
    tooltip: [...optionLines(labels, header.options), labels.text('nativeSave'), `${listing.name}.sav`].join('\n'),
    compatible: listing.compatible,
    problems: listing.problems,
  };
}

export function saveRow(listing: SaveListing, labels: Labels): SaveRow {
  return listing.native ? nativeRow(listing, labels) : ownRow(listing, labels);
}

export function predictLoadWarnings(
  header: SaveHeader,
  health: Pick<Health, 'dataVersion' | 'engine'>,
  listed: readonly LoadWarning[] = [],
): LoadWarning[] {
  const warnings: LoadWarning[] = [...listed];
  if (header.content.dataVersion !== health.dataVersion) warnings.push('dataVersionDiffers');
  const engine = health.engine;
  if (engine && (engine.version !== header.engine.version || engine.commit !== header.engine.commit)) warnings.push('engineDiffers');
  return warnings;
}

export function loadWarningText(labels: Labels, warnings: readonly LoadWarning[]): string {
  return [labels.text('savedGameIssue'), ...warnings.map((w) => `- ${labels.text(WARNING_LABELS[w])}`), labels.text('continueAnyway')].join(
    '\n',
  );
}

export function isQuickSaveName(name: string): boolean {
  return name.toLowerCase() === QUICK_SAVE_NAME.toLowerCase();
}

export function overwriteTarget(row: Pick<SaveRow, 'name' | 'native' | 'kind'>): string | null {
  if (row.native || row.kind === 'auto') return null;
  if (isQuickSaveName(row.name)) return QUICK_SAVE_ALIAS;
  return row.name;
}

export function clampDescription(text: string): string {
  return [...text.replace(/[\r\n\t]+/g, ' ')].slice(0, MAX_DESCRIPTION_CHARS).join('');
}

function cleanBasename(fileName: string): string {
  const base = fileName.split(/[\\/]/).at(-1) ?? '';
  const cleaned = base
    .replace(SAVE_FILE_SUFFIX, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, SAVE_NAME_LIMIT);
  return SAVE_NAME.test(cleaned) ? cleaned : UPLOAD_FALLBACK_NAME;
}

function nameTaken(name: string, taken: ReadonlySet<string>): boolean {
  return RESERVED_SAVE_NAMES.has(name.toLowerCase()) || taken.has(name.toLowerCase());
}

export function uploadName(fileName: string, existing: Iterable<string>): string {
  const taken = new Set([...existing].map((n) => n.toLowerCase()));
  const base = cleanBasename(fileName);
  if (!nameTaken(base, taken)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, SAVE_NAME_LIMIT - suffix.length)}${suffix}`;
    if (!nameTaken(candidate, taken)) return candidate;
  }
}
