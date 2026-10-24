import { parseSectorString, type Sector } from '../../src/content/strategic/sector-ids.ts';
import { createCampaignSession } from '../../src/server/campaign-factory.ts';
import type { CampaignSession } from '../../src/server/campaign-session.ts';
import { Session } from '../../src/server/session.ts';
import { beginCaptureSequence, endCaptureSequence, enemyCapturesPlayerSoldier } from '../../src/sim/campaign/merc-fate.ts';
import { getGroup, setGroupSectorValue } from '../../src/sim/strategic/forces/groups.ts';
import { sectorInfo } from '../../src/sim/strategic/map/sectors.ts';
import { Quest } from '../../src/sim/strategic/narrative/fact-ids.ts';
import { QuestStatus } from '../../src/sim/strategic/narrative/facts.ts';
import { Npc } from '../../src/sim/strategic/narrative/npc-ids.ts';
import { removeSoldierFromTacticalSector } from '../../src/sim/tactical/sector-presence.ts';
import { Team } from '../../src/sim/tactical/soldier.ts';
import { teamMembers } from '../../src/sim/tactical/state.ts';
import type { StubSectorKit } from './sectors.ts';

export const N7_MAP = 'stubs/world/maps/n7.dat';
export const PALACE_MAPS = ['stubs/world/maps/p3.dat', 'stubs/world/maps/p3_b1.dat'];
const PALACE_BASEMENT = { x: 3, y: 16, z: 1 } as const;
const AWAY = 'A10';
const QUEEN_LIFE = 1;
const QUEEN_BLEEDING = 1;
const NEXT_BLEED = 0.5;

function quiet(session: CampaignSession, name: string): void {
  Object.assign(sectorInfo(session.campaign.state.map, parseSectorString(name)), { numAdmins: 0, numTroops: 0, numElites: 0 });
}

export async function landSquad(session: CampaignSession, quietSectors: readonly string[]): Promise<void> {
  for (const name of quietSectors) quiet(session, name);
  const land = { type: 'compressTime', mode: 2 };
  await session.prepare(land);
  if (!session.dispatch(land).ok) throw new Error('the squad did not land');
}

async function landed(kit: StubSectorKit, seed: number, mercs: number, quietSectors: readonly string[]): Promise<CampaignSession> {
  const session = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { mercs, land: false });
  await landSquad(session, quietSectors);
  return session;
}

function moveMercs(
  session: CampaignSession,
  sector: Sector & { readonly z?: number },
  which = session.campaign.battle?.roster.all() ?? [],
): void {
  const ctx = session.campaign.strategic;
  if (!ctx) throw new Error('no strategic layer');
  for (const m of which) {
    const group = getGroup(ctx, m.groupId);
    if (group) setGroupSectorValue(ctx, sector, group);
    m.sector = { x: sector.x, y: sector.y, z: sector.z ?? 0 };
  }
}

export async function capturedTwice(kit: StubSectorKit, seed: number): Promise<CampaignSession> {
  const session = await landed(kit, seed, 3, ['A9', 'N7']);
  const c = session.campaign;
  c.state.narrative.quests[Quest.HELD_IN_ALMA] = QuestStatus.DONE;
  const battle = c.battle;
  const t = c.tactical?.state;
  if (!battle || !t) throw new Error('no battle flow');
  const [first, second, free] = battle.roster.all();
  if (!first || !second || !free) throw new Error('three mercs expected');
  beginCaptureSequence(battle);
  for (const m of [first, second]) {
    removeSoldierFromTacticalSector(t, m.soldier);
    if (!enemyCapturesPlayerSoldier(battle, m, c.state.rng)) throw new Error('the capture failed');
  }
  endCaptureSequence(battle);
  removeSoldierFromTacticalSector(t, free.soldier);
  moveMercs(session, parseSectorString(AWAY), [free]);
  c.sectors?.checkAndHandleUnloadingOfCurrentWorld();
  await session.worlds?.prepare([N7_MAP]);
  return session;
}

export async function inTheInterrogation(kit: StubSectorKit, seed: number): Promise<{ session: Session; campaign: CampaignSession }> {
  const campaign = await capturedTwice(kit, seed);
  const session = new Session('interrogation', campaign);
  const begun = session.advance({ compressionStopped: true, mode: 2 });
  if (!begun.events.some((e) => e.type === 'meanwhileStarted')) throw new Error('the interrogation did not start');
  return { session, campaign };
}

export async function inThePalaceBasement(kit: StubSectorKit, seed: number): Promise<CampaignSession> {
  const session = await landed(kit, seed, 2, ['A9']);
  await moveToThePalaceBasement(session);
  return session;
}

export async function moveToThePalaceBasement(session: CampaignSession): Promise<void> {
  await session.worlds?.prepare(PALACE_MAPS);
  moveMercs(session, PALACE_BASEMENT);
  const queen = session.campaign.narrative.profile(Npc.QUEEN);
  if (queen) queen.sectorZ = PALACE_BASEMENT.z;
  if (!session.campaign.sectors?.setCurrentWorldSector(PALACE_BASEMENT)) throw new Error('the palace basement did not load');
}

export function queenBleedingToDeath(session: CampaignSession): void {
  const t = session.campaign.tactical?.state;
  if (!t) throw new Error('no sector');
  const queen = t.soldiers.find((s) => s?.placed && s.profile === Npc.QUEEN);
  const killer = teamMembers(t, Team.OUR)[0];
  if (!queen || !killer) throw new Error('the Queen or the squad is missing');
  queen.attacker = killer;
  queen.life = QUEEN_LIFE;
  queen.bleeding = QUEEN_BLEEDING;
  queen.nextBleed = NEXT_BLEED;
}
