import { expect } from 'vitest';
import { parseSectorString } from '../../src/content/strategic/sector-ids.ts';
import { pythSpacesAway } from '../../src/content/world/grid.ts';
import { createCampaignSession } from '../../src/server/campaign-factory.ts';
import type { CampaignSession } from '../../src/server/campaign-session.ts';
import { sectorInfo } from '../../src/sim/strategic/map/sectors.ts';
import type { Soldier } from '../../src/sim/tactical/soldier.ts';
import { armSquadWithPistols } from './pistol-kit.ts';
import type { RunMode } from './reload.ts';
import type { StubSectorKit } from './sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from './session-reload.ts';

export const STUB_DEALER = 91;
export const STUB_REPAIRMAN = 128;
const ROUTE_BUDGET = 10;
const ROUTE_SLICE_SECONDS = 6 * 3600;

export async function stubCampaignInA10(kit: StubSectorKit, seed: number, mode?: RunMode, mercs = 2): Promise<CampaignSession> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { mercs, land: false });
  armSquadWithPistols(created, kit.content.items);
  const session = drivenSession(created, stubSessionSources(kit), mode);
  const start = sectorInfo(session.campaign.state.map, parseSectorString('A9'));
  start.numAdmins = 0;
  start.numTroops = 0;
  start.numElites = 0;
  const land = { type: 'compressTime', mode: 2 };
  await session.prepare(land);
  expect(session.dispatch(land).ok).toBe(true);
  expect(session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
  const first = session.view().strategic?.mercs[0];
  if (!first) throw new Error('no merc');
  expect(session.dispatch({ type: 'route', soldier: first.id, to: 'A10' })).toMatchObject({ ok: true });
  const live = new ReloadingSession('t', session);
  for (let k = 0; k < ROUTE_BUDGET && !session.view().strategic?.mercs.every((m) => m.sector === 'A10' && !m.betweenSectors); k++)
    live.advance({ worldSeconds: ROUTE_SLICE_SECONDS });
  const enter = { type: 'enterSector', sector: 'A10' };
  await session.prepare(enter);
  expect(session.dispatch(enter)).toMatchObject({ ok: true });
  return session;
}

export function stubSoldierOfProfile(session: CampaignSession, profile: number): Soldier {
  const s = session.campaign.tactical?.state.soldiers.find((x) => x?.placed && x.profile === profile);
  if (!s) throw new Error(`profile ${profile} is not in the sector`);
  return s;
}

export function walkNextToProfile(session: CampaignSession, merc: number, profile: number): void {
  const t = session.campaign.tactical?.state;
  const target = stubSoldierOfProfile(session, profile).gridNo;
  const from = t?.soldiers[merc]?.gridNo ?? 0;
  if (pythSpacesAway(from, target) <= 2) return;
  const live = new ReloadingSession('t', session);
  expect(session.dispatch({ type: 'move', soldier: merc, to: target + 2, mode: 'walk' })).toMatchObject({ ok: true });
  live.advance({ idle: true });
}
