import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DataVfs, openDataVfs } from '../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../node/repo.ts';
import type { CampaignSim } from '../sim/campaign/campaign-sim.ts';
import { MercKind } from '../sim/campaign/roster.ts';
import { Quest } from '../sim/strategic/narrative/fact-ids.ts';
import { QuestStatus } from '../sim/strategic/narrative/facts.ts';
import { Npc } from '../sim/strategic/narrative/npc-ids.ts';
import { tacticalCreateSoldier } from '../sim/tactical/creation.ts';
import { drawStandingFrame, NEUTRAL_POPULATION, soldierSlotTaken } from '../sim/tactical/init-list.ts';
import { addSoldierToSector, Insertion } from '../sim/tactical/insertion.ts';
import { profileSoldierCreate } from '../sim/tactical/narrative/profile-insertion.ts';
import { firstFreeSoldierId, Team } from '../sim/tactical/soldier.ts';
import { createSaveSession } from './save-session.ts';

const dataDir = process.env.JA2_DATA_DIR ?? '';
const gameRoot = basename(dataDir).toLowerCase() === 'data' ? dirname(dataDir) : dataDir;
const save = join(gameRoot, 'SavedGames', 'SaveGame01.sav');
const NEAR_SQUAD = 9037;
const SOUTH = 4;
const AWAY_CIVILIAN_SLOTS: ReadonlySet<number> = new Set([119, 120]);

function addProfiledCivilian(c: CampaignSim, profile: number, at: number): number {
  const t = c.tactical?.state;
  if (!t) throw new Error('no loaded sector');
  const id = firstFreeSoldierId((n) => soldierSlotTaken(t, n) || AWAY_CIVILIAN_SLOTS.has(n), Team.CIV);
  const s = tacticalCreateSoldier(t, profileSoldierCreate(profile, Team.CIV, SOUTH), id, NEUTRAL_POPULATION);
  if (!s) throw new Error(`no soldier for profile ${profile}`);
  drawStandingFrame(t);
  s.insertionGridNo = at;
  addSoldierToSector(t, s, { code: Insertion.GRIDNO, data: at, direction: SOUTH }, {}, false);
  return s.id;
}

describe.skipIf(!process.env.JA2_DATA_DIR || !existsSync(save))('escorting the tourists on the original data', () => {
  let data: DataVfs;
  const read = async (p: string) => (data.vfs.stat(p) ? data.vfs.read(p) : null);

  beforeAll(async () => {
    data = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir });
  });
  afterAll(async () => {
    await data.close();
  });

  it('John brings Mary along, starts their quest, and both leave the team again from the map screen', async () => {
    const { session } = await createSaveSession(read, new Uint8Array(readFileSync(save)), 1, (p) => data.vfs.stat(p) !== undefined);
    const c = session.campaign;
    const john = addProfiledCivilian(c, Npc.JOHN, NEAR_SQUAD);
    addProfiledCivilian(c, Npc.MARY, NEAR_SQUAD + 2);
    const env = c.talk?.npcActions.env;
    const host = c.talk?.host;
    if (!env || !host) throw new Error('no narrative');
    host.context.dest = john;
    const flow = c.talk?.npcActions.recruitFlow;
    const escorted = flow?.recruitEpc(Npc.JOHN);
    flow?.handleStuffForNpcEscorted(Npc.JOHN);
    expect(escorted).toBe(true);
    const roster = c.battle?.roster;
    expect(roster?.byProfile(Npc.JOHN)?.kind).toBe(MercKind.EPC);
    expect(roster?.byProfile(Npc.MARY)?.kind).toBe(MercKind.EPC);
    expect(c.state.narrative.quests[Quest.ESCORT_TOURISTS]).toBe(QuestStatus.IN_PROGRESS);
    expect(session.dispatch({ type: 'mapScreen' })).toEqual({ ok: true });
    const id = roster?.byProfile(Npc.JOHN)?.id;
    const released = session.dispatch({ type: 'unescort', soldier: id });
    expect(released.ok, released.reason).toBe(true);
    const profiles = (released.data as { released: { profile: number }[] }).released.map((r) => r.profile);
    expect(profiles).toEqual([Npc.JOHN, Npc.MARY]);
    expect(roster?.byProfile(Npc.JOHN)).toBeUndefined();
    expect(roster?.byProfile(Npc.MARY)).toBeUndefined();
    const t = c.tactical?.state;
    expect(t?.soldiers.filter((s) => s?.placed && s.team === Team.CIV && (s.profile === Npc.JOHN || s.profile === Npc.MARY))).toHaveLength(
      2,
    );
  });
});
