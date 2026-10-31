import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSoldier } from '../../tests/support/combat.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { drivenSession, ReloadingSession, stubSessionSources } from '../../tests/support/session-reload.ts';
import { parseSectorString } from '../content/strategic/sector-ids.ts';
import type { SimEvent } from '../sim/events.ts';
import { sectorInfo } from '../sim/strategic/map/sectors.ts';
import { reduceAttackBusyCount } from '../sim/tactical/combat/barrier.ts';
import { handleSoldierDeath } from '../sim/tactical/combat/death.ts';
import { MercQuote, QuoteSaidExtFlag, QuoteSaidFlag } from '../sim/tactical/narrative/merc-quotes.ts';
import { type Soldier, TEAM_FIRST_ID, Team } from '../sim/tactical/soldier.ts';
import type { TacticalState } from '../sim/tactical/state.ts';
import type { TacticalSim } from '../sim/tactical/tactical-sim.ts';
import { enterCombatMode } from '../sim/tactical/turns/turns.ts';
import { createCampaignSession } from './campaign-factory.ts';
import type { CampaignSession } from './campaign-session.ts';
import type { Session } from './session.ts';

let kit: StubSectorKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
});

afterAll(async () => {
  await kit.dispose();
});

const KESTREL = 0;
const VANT = 1;
const ENEMY_ID = TEAM_FIRST_ID[Team.ENEMY];
const TILES_AHEAD = 3;
const QUOTE_TICKS = 3000;
const DEADLY_GUN = 'M14';
const SECOND_ENEMY_OFFSET = 2;

interface Campaign {
  readonly session: CampaignSession;
  readonly live: Session;
}

async function squadInA9(seed: number): Promise<Campaign> {
  const created = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), seed, { profiles: [KESTREL, VANT], land: false });
  const session = drivenSession(created, stubSessionSources(kit));
  Object.assign(sectorInfo(session.campaign.state.map, parseSectorString('A9')), { numAdmins: 0, numTroops: 0, numElites: 0 });
  const land = { type: 'compressTime', mode: 2 };
  await session.prepare(land);
  expect(session.dispatch(land).ok).toBe(true);
  const live = new ReloadingSession('quotes', session);
  const enter = { type: 'enterSector', sector: 'A9' };
  await session.prepare(enter);
  expect(session.dispatch(enter)).toMatchObject({ ok: true });
  live.advance({ idle: true });
  return { session, live };
}

function loadedSector(c: Campaign): TacticalSim {
  const sim = c.session.campaign.tactical;
  if (!sim) throw new Error('no sector is loaded');
  return sim;
}

function ours(t: TacticalState, profile: number): Soldier {
  const s = t.soldiers.find((m) => m?.placed && m.team === Team.OUR && m.profile === profile);
  if (!s) throw new Error(`no merc with profile ${profile}`);
  return s;
}

function withRolls(t: TacticalState, rolls: readonly number[], run: () => void): void {
  const rng = t.rng as unknown as { int(n: number): number };
  const queued = [...rolls];
  const real = rng.int.bind(rng);
  rng.int = (n: number) => {
    const v = queued.shift();
    return v === undefined ? real(n) : v;
  };
  try {
    run();
  } finally {
    delete (rng as { int?: unknown }).int;
  }
  expect(queued).toEqual([]);
}

function killedBy(t: TacticalState, victim: Soldier, killer: Soldier, rolls: readonly number[]): void {
  t.turn.attackBusyCount = 1;
  victim.attacker = killer;
  victim.life = 0;
  handleSoldierDeath(t, victim);
  withRolls(t, rolls, () => reduceAttackBusyCount(t, killer, false));
}

function quotesSaid(events: readonly SimEvent[], ids: readonly number[]): [number, number][] {
  return events.flatMap((e) => (e.type === 'mercQuote' && ids.includes(e.id) ? [[e.profile, e.id] as [number, number]] : []));
}

describe('kill and battle-end quotes in a campaign (Soldier_Ani.cc HandleKilledQuote, Overhead.cc CheckForEndOfBattle)', () => {
  it('says the gun and buddy lines through the dialogue queue, keeps their flags on the roster until the battle is won', async () => {
    const c = await squadInA9(81);
    const sim = loadedSector(c);
    let t = sim.state;
    const kestrel = ours(t, KESTREL);
    const near = spawnSoldier(sim, ENEMY_ID, Team.ENEMY, kestrel.gridNo + TILES_AHEAD, kestrel.direction);
    spawnSoldier(sim, ENEMY_ID + 1, Team.ENEMY, near.gridNo + SECOND_ENEMY_OFFSET, kestrel.direction);
    enterCombatMode(t, Team.OUR);
    kestrel.attackingWeapon = t.content.items.byName.get(DEADLY_GUN)?.index ?? 0;
    killedBy(t, near, kestrel, [0, 0, 0]);
    const roster = () => c.session.campaign.battle?.roster;
    expect((roster()?.get(kestrel.id)?.quoteSaidFlags ?? 0) & QuoteSaidFlag.LIKESGUN).toBe(QuoteSaidFlag.LIKESGUN);
    const vantId = ours(t, VANT).id;
    expect((roster()?.get(vantId)?.quoteSaidExtFlags ?? 0) & QuoteSaidExtFlag.BUDDY_1_WITNESSED).toBe(QuoteSaidExtFlag.BUDDY_1_WITNESSED);
    const kill = c.live.advance({ ticks: QUOTE_TICKS }).events;
    expect(quotesSaid(kill, [MercQuote.SATISFACTION_WITH_GUN_AFTER_KILL, MercQuote.BUDDY_1_GOOD])).toEqual([
      [KESTREL, MercQuote.SATISFACTION_WITH_GUN_AFTER_KILL],
      [VANT, MercQuote.BUDDY_1_GOOD],
    ]);
    t = loadedSector(c).state;
    const last = t.soldiers[ENEMY_ID + 1];
    if (!last) throw new Error('the second enemy is gone');
    withRolls(t, [1], () => {
      last.life = 0;
      handleSoldierDeath(t, last);
    });
    expect((roster()?.get(vantId)?.quoteSaidExtFlags ?? 0) & QuoteSaidExtFlag.BUDDY_1_WITNESSED).toBe(0);
    const won = c.live.advance({ ticks: QUOTE_TICKS }).events;
    expect(quotesSaid(won, [MercQuote.SECTOR_SAFE])).toEqual([[VANT, MercQuote.SECTOR_SAFE]]);
  });
});
