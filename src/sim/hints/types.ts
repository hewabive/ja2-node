import type { CommandResult } from '../command.ts';

export type MoveModeName = 'walk' | 'run' | 'swat' | 'crawl';

export type HintRefusal = {
  readonly ok: false;
  readonly reason: string;
  readonly data: { readonly refusal: string; readonly [key: string]: unknown };
};

export type HintResult<T> = { readonly ok: true; readonly data: T } | HintRefusal;

export function refuseHint(refusal: string, reason: string): HintRefusal {
  return { ok: false, reason, data: { refusal } };
}

export function hintData<T>(data: T): HintResult<T> {
  return { ok: true, data };
}

export interface HintRequestBase {
  readonly type: string;
  readonly [key: string]: unknown;
}

export const TACTICAL_HINT_KINDS = ['previewMove', 'previewAction', 'estimateAttack', 'placements', 'itemInfo', 'exitSector'] as const;

export const STRATEGIC_HINT_KINDS = [
  'exitSectorOptions',
  'canEnterSector',
  'assignmentOptions',
  'previewRoute',
  'previewHeliRoute',
  'moveBoxOptions',
] as const;

export const HINT_KINDS = [...TACTICAL_HINT_KINDS, ...STRATEGIC_HINT_KINDS] as const;

export type HintKind = (typeof HINT_KINDS)[number];

export const SERVER_QUERY_KINDS = [
  'hireCheck',
  'impCheckCode',
  'aimQuote',
  'bobbyRayQuote',
  'insuranceQuote',
  'impPreview',
  'arrivalTime',
  'quoteTrade',
  'contractOptions',
  'inventory',
] as const;

export type ServerQueryKind = (typeof SERVER_QUERY_KINDS)[number];

const HINT_KIND_SET: ReadonlySet<string> = new Set(HINT_KINDS);
const SERVER_QUERY_SET: ReadonlySet<string> = new Set(SERVER_QUERY_KINDS);

export function isHintKind(type: string): type is HintKind {
  return HINT_KIND_SET.has(type);
}

export function isServerQueryKind(type: string): type is ServerQueryKind {
  return SERVER_QUERY_SET.has(type);
}

export function isQueryKind(type: string): boolean {
  return isHintKind(type) || isServerQueryKind(type);
}

export type AnyHintResult = CommandResult;
