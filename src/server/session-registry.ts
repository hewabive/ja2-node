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
      profiles: z.array(z.number().int().min(0).max(39)).min(1).max(6).optional().describe('A.I.M. profile ids (original data)'),
      mercs: z.number().int().min(1).max(6).optional().describe('number of stub mercs (stub data)'),
      land: z.boolean().optional().describe('fly the squad in at once (default true); false leaves the game at the first hour'),
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

export async function openSession(
  sessions: Map<string, Session>,
  defaultSession: string,
  createSession: SessionFactory,
  request: NewSessionRequest,
): Promise<Session> {
  if (sessions.size >= MAX_SESSIONS) throw new Error(`at most ${MAX_SESSIONS} sessions`);
  if (request.save && request.campaign) throw new Error('pass either save or campaign');
  let n = sessions.size;
  while (sessions.has(`${defaultSession}-${n}`)) n++;
  const id = `${defaultSession}-${n}`;
  const created = await createSession(id, {
    seed: request.seed ?? n,
    ...(request.save ? { save: request.save } : {}),
    ...(request.campaign ? { campaign: request.campaign } : {}),
  });
  sessions.set(id, created);
  return created;
}
