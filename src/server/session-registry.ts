import { z } from 'zod';
import { UI_LANGUAGES, type UiLanguage } from '../content/text/data-version.ts';
import { type GameOptions, SAVE_MODES } from '../sim/options.ts';
import type { SaveImportReport } from '../sim/tactical/save-import.ts';
import type { CampaignRequest } from './campaign-factory.ts';
import { CampaignSession } from './campaign-session.ts';
import { saveStatus, sessionOptions } from './save-rules.ts';
import { SAVE_FILE_NAME } from './save-store.ts';
import type { Session } from './session.ts';

export interface LoadRequest {
  readonly name: string;
  readonly reseed: boolean;
}

export interface SessionRequest {
  readonly seed: number;
  readonly language?: UiLanguage;
  readonly save?: string;
  readonly campaign?: CampaignRequest;
  readonly load?: LoadRequest;
}

export type SessionFactory = (id: string, request: SessionRequest) => Promise<Session>;

export const MAX_SESSIONS = 16;
export const SAVE_NAME = /^[A-Za-z0-9_-]{1,64}$/;

export const NEW_SESSION_SHAPE = {
  seed: z.number().int().nonnegative().optional(),
  language: z
    .enum(UI_LANGUAGES)
    .optional()
    .describe(
      "display language of the UI labels this session resolves (eng, rus, ger, dut, fr, it, pl, chs; default JA2_LANG or the data version's language); dialogue and other data text always come in the data version's language",
    ),
  save: z.string().regex(SAVE_NAME).optional().describe('a native savegame of the SavedGames folder, without .sav'),
  load: z
    .string()
    .regex(SAVE_FILE_NAME)
    .optional()
    .describe('a ja2-node save (listSaves) to load into the new session; same as the load tool without session'),
  reseed: z
    .boolean()
    .optional()
    .describe('with load: false restores the random streams exactly (reproducible); default true reseeds the main stream'),
  campaign: z
    .object({
      options: z
        .object({
          difficulty: z
            .number()
            .int()
            .min(1)
            .max(3)
            .optional()
            .describe('1 easy, 2 medium (default here; the original game defaults to easy), 3 hard'),
          sciFi: z.boolean().optional().describe('sci-fi mode: creatures and the sci-fi items (default true)'),
          gunNut: z.boolean().optional().describe('the full gun list (default false: reduced guns)'),
          saveMode: z
            .enum(SAVE_MODES)
            .optional()
            .describe(
              'anywhere (default), ironMan (no saves in combat or with enemies in the loaded sector) or deadIsDead (one save file the game writes itself)',
            ),
          bloodAndGore: z.boolean().optional().describe('messy deaths and bloody corpses (default true); changeable later with setOption'),
        })
        .strict()
        .optional()
        .describe(
          'the game options of the new campaign, chosen once like on the original game init screen (bloodAndGore can change later)',
        ),
      difficulty: z.number().int().min(1).max(3).optional().describe('alias of options.difficulty'),
      profiles: z.array(z.number().int().min(0).max(39)).min(1).max(6).optional().describe('A.I.M. profile ids hired on a week contract'),
      hire: z
        .array(
          z.object({
            profile: z.number().int().min(0).max(39),
            contract: z.union([z.literal(1), z.literal(7), z.literal(14)]).optional(),
            gear: z.boolean().optional(),
          }),
        )
        .max(6)
        .optional()
        .describe(
          'A.I.M. hires through the laptop (contract days, default 7; gear default: the kit if it has a cost); [] stays in the laptop',
        ),
      imp: z.object({}).passthrough().optional().describe('an impCreate command (without type) run after the hires'),
      mercs: z
        .number()
        .int()
        .min(1)
        .max(6)
        .optional()
        .describe('size of the default squad (hired in order while affordable and available)'),
      land: z.boolean().optional().describe('fly the squad in at once (default true); false closes the laptop at the first hour'),
      saveMode: z.enum(SAVE_MODES).optional().describe('alias of options.saveMode'),
      deadIsDeadName: z.string().regex(SAVE_FILE_NAME).optional().describe('the save name of a deadIsDead campaign (default DeadIsDead)'),
    })
    .optional(),
};

export const newSessionRequest = z.object(NEW_SESSION_SHAPE).strict();

export type NewSessionRequest = z.infer<typeof newSessionRequest>;

export function optionsStatus(sim: Session['sim']): { readonly options?: GameOptions } {
  const options = sessionOptions(sim);
  return options ? { options: { ...options } } : {};
}

export function importReport(session: Session): { readonly import?: SaveImportReport } {
  const report = session.sim instanceof CampaignSession ? session.sim.origin?.report : undefined;
  return report ? { import: report } : {};
}

export function describeSession(session: Session): Record<string, unknown> {
  const view = session.sim.view();
  return {
    session: session.id,
    tick: view.tick,
    map: view.mapPath,
    driver: session.driver,
    language: session.language,
    dataVersion: session.dataVersion,
    soldiers: view.soldiers.length,
    idle: session.sim.isIdle(),
    ...optionsStatus(session.sim),
    ...saveStatus(session.sim),
    ...(view.clock ? { clock: view.clock } : {}),
    ...(view.strategic
      ? {
          flow: view.strategic.flow,
          sector: view.strategic.worldSector,
          campaign: view.strategic.campaign,
          ...(view.strategic.noUsableMercs ? { noUsableMercs: true } : {}),
        }
      : {}),
  };
}

const sessionsBeingCreated = new WeakMap<Map<string, unknown>, Set<string>>();

function creating(sessions: Map<string, unknown>): Set<string> {
  const ids = sessionsBeingCreated.get(sessions) ?? new Set<string>();
  sessionsBeingCreated.set(sessions, ids);
  return ids;
}

export async function openSession<T>(
  sessions: Map<string, T>,
  defaultSession: string,
  createSession: (id: string, request: SessionRequest) => Promise<T>,
  request: NewSessionRequest,
): Promise<T> {
  const pending = creating(sessions);
  if (sessions.size + pending.size >= MAX_SESSIONS) throw new Error(`at most ${MAX_SESSIONS} sessions`);
  if ([request.save, request.campaign, request.load].filter((x) => x !== undefined).length > 1)
    throw new Error('pass at most one of save, campaign and load');
  if (request.reseed !== undefined && !request.load) throw new Error('reseed goes with load');
  let n = sessions.size + pending.size;
  const taken = (candidate: string) => sessions.has(candidate) || pending.has(candidate);
  while (taken(`${defaultSession}-${n}`)) n++;
  const id = `${defaultSession}-${n}`;
  pending.add(id);
  try {
    const created = await createSession(id, {
      seed: request.seed ?? n,
      ...(request.language ? { language: request.language } : {}),
      ...(request.save ? { save: request.save } : {}),
      ...(request.campaign ? { campaign: request.campaign } : {}),
      ...(request.load ? { load: { name: request.load, reseed: request.reseed ?? true } } : {}),
    });
    sessions.set(id, created);
    return created;
  } finally {
    pending.delete(id);
  }
}
