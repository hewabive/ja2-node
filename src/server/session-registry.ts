import { z } from 'zod';
import type { CampaignRequest } from './campaign-factory.ts';
import type { Session } from './session.ts';

export interface SessionRequest {
  readonly seed: number;
  readonly save?: string;
  readonly campaign?: CampaignRequest;
}

export type SessionFactory = (id: string, request: SessionRequest) => Promise<Session>;

export const MAX_SESSIONS = 16;
export const SAVE_NAME = /^[A-Za-z0-9_-]{1,64}$/;

export const NEW_SESSION_SHAPE = {
  seed: z.number().int().nonnegative().optional(),
  save: z.string().regex(SAVE_NAME).optional(),
  campaign: z
    .object({
      difficulty: z.number().int().min(1).max(3).optional().describe('1 easy, 2 medium (default), 3 hard'),
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
    })
    .optional(),
};

export const newSessionRequest = z.object(NEW_SESSION_SHAPE).strict();

export type NewSessionRequest = z.infer<typeof newSessionRequest>;

export function describeSession(session: Session): Record<string, unknown> {
  const view = session.sim.view();
  return {
    session: session.id,
    tick: view.tick,
    map: view.mapPath,
    driver: session.driver,
    soldiers: view.soldiers.length,
    idle: session.sim.isIdle(),
    ...(view.clock ? { clock: view.clock } : {}),
    ...(view.strategic ? { flow: view.strategic.flow, sector: view.strategic.worldSector } : {}),
  };
}

const sessionsBeingCreated = new WeakMap<Map<string, Session>, Set<string>>();

function creating(sessions: Map<string, Session>): Set<string> {
  const ids = sessionsBeingCreated.get(sessions) ?? new Set<string>();
  sessionsBeingCreated.set(sessions, ids);
  return ids;
}

export async function openSession(
  sessions: Map<string, Session>,
  defaultSession: string,
  createSession: SessionFactory,
  request: NewSessionRequest,
): Promise<Session> {
  const pending = creating(sessions);
  if (sessions.size + pending.size >= MAX_SESSIONS) throw new Error(`at most ${MAX_SESSIONS} sessions`);
  if (request.save && request.campaign) throw new Error('pass either save or campaign');
  let n = sessions.size + pending.size;
  const taken = (candidate: string) => sessions.has(candidate) || pending.has(candidate);
  while (taken(`${defaultSession}-${n}`)) n++;
  const id = `${defaultSession}-${n}`;
  pending.add(id);
  try {
    const created = await createSession(id, {
      seed: request.seed ?? n,
      ...(request.save ? { save: request.save } : {}),
      ...(request.campaign ? { campaign: request.campaign } : {}),
    });
    sessions.set(id, created);
    return created;
  } finally {
    pending.delete(id);
  }
}
