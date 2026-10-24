// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/GameSettings.cc InitGameOptions (easy, sci-fi, reduced guns, save anywhere), InitGameSettings (blood on);
// @src src/game/GameInitOptionsScreen.cc (the game init screen's choices). See docs/27 §2.2, §8.3.

import type { UiLanguage } from '../../content/text/data-version.ts';
import type { Difficulty, GameOptions, SaveMode } from './api-types.ts';

export type SquadChoice = 'default' | 'laptop';
export type StartPage = 'strategic' | 'tactical';

export interface CampaignForm {
  readonly difficulty: Difficulty;
  readonly sciFi: boolean;
  readonly gunNut: boolean;
  readonly saveMode: SaveMode;
  readonly bloodAndGore: boolean;
  readonly deadIsDeadName: string;
  readonly deadIsDeadDescription?: string;
  readonly squad: SquadChoice;
  readonly squadSize: number | null;
  readonly land: boolean;
  readonly page: StartPage;
}

const DEFAULT_DEAD_IS_DEAD_NAME = 'DeadIsDead';
export const MAX_SQUAD_SIZE = 6;
const SAVE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const RESERVED_SAVE_NAMES: ReadonlySet<string> = new Set(['quicksave', 'auto01', 'auto02', 'error']);

export const ORIGINAL_OPTIONS: GameOptions = {
  difficulty: 1,
  sciFi: true,
  gunNut: false,
  saveMode: 'anywhere',
  bloodAndGore: true,
};

export const DEFAULT_CAMPAIGN_FORM: CampaignForm = {
  ...ORIGINAL_OPTIONS,
  deadIsDeadName: DEFAULT_DEAD_IS_DEAD_NAME,
  squad: 'default',
  squadSize: null,
  land: true,
  page: 'strategic',
};

export interface CampaignBody {
  readonly seed?: number;
  readonly language?: UiLanguage;
  readonly campaign: {
    readonly options: GameOptions;
    readonly deadIsDeadName?: string;
    readonly deadIsDeadDescription?: string;
    readonly hire?: readonly never[];
    readonly mercs?: number;
    readonly land?: false;
  };
}

export type CampaignProblem = 'deadIsDeadName' | 'squadSize';

export type CampaignRequest =
  | { readonly ok: true; readonly body: CampaignBody; readonly page: StartPage }
  | { readonly ok: false; readonly problem: CampaignProblem };

export function validDeadIsDeadName(name: string): boolean {
  return SAVE_NAME.test(name) && !RESERVED_SAVE_NAMES.has(name.toLowerCase());
}

function squadPart(form: CampaignForm): Pick<CampaignBody['campaign'], 'hire' | 'mercs' | 'land'> {
  if (form.squad === 'laptop') return { hire: [] };
  return {
    ...(form.squadSize !== null ? { mercs: form.squadSize } : {}),
    ...(form.land ? {} : { land: false as const }),
  };
}

function startPage(form: CampaignForm): StartPage {
  const landed = form.squad === 'default' && form.land;
  return landed ? form.page : 'strategic';
}

function deadIsDeadPart(form: CampaignForm): { readonly deadIsDeadName?: string; readonly deadIsDeadDescription?: string } | null {
  if (form.saveMode !== 'deadIsDead') return {};
  const description = form.deadIsDeadDescription?.trim();
  if (description) return { deadIsDeadDescription: description };
  const name = form.deadIsDeadName.trim();
  return validDeadIsDeadName(name) ? { deadIsDeadName: name } : null;
}

export function campaignRequest(form: CampaignForm, language: UiLanguage | null, seed: number | null = null): CampaignRequest {
  const deadIsDead = deadIsDeadPart(form);
  if (!deadIsDead) return { ok: false, problem: 'deadIsDeadName' };
  if (form.squadSize !== null && (!Number.isInteger(form.squadSize) || form.squadSize < 1 || form.squadSize > MAX_SQUAD_SIZE))
    return { ok: false, problem: 'squadSize' };
  const options: GameOptions = {
    difficulty: form.difficulty,
    sciFi: form.sciFi,
    gunNut: form.gunNut,
    saveMode: form.saveMode,
    bloodAndGore: form.bloodAndGore,
  };
  return {
    ok: true,
    page: startPage(form),
    body: {
      ...(seed !== null ? { seed } : {}),
      ...(language ? { language } : {}),
      campaign: { options, ...deadIsDead, ...squadPart(form) },
    },
  };
}

export function pageUrl(page: StartPage, session: string): string {
  return `/src/devtools/${page}/?session=${encodeURIComponent(session)}`;
}

export function playUrl(session: string): string {
  return `/play?session=${encodeURIComponent(session)}`;
}
