import { parseSectorString, type Sector, sectorId, strategicIndex } from '../../src/content/strategic/sector-ids.ts';
import type { CampaignSession } from '../../src/server/campaign-session.ts';
import { enemyGroupCounts } from '../../src/sim/campaign/autoresolve-strategic.ts';
import type { CampaignSim } from '../../src/sim/campaign/campaign-sim.ts';
import { getNumberOfEnemiesInSector, numMobileEnemiesInSector, numStationaryEnemiesInSector } from '../../src/sim/strategic/ai/counts.ts';
import { associateEnemiesWithStrategicGroups } from '../../src/sim/strategic/forces/autoresolve/setup.ts';
import { CellFlag, cosmeticOnMain } from '../../src/sim/strategic/forces/autoresolve/state.ts';
import { createNewEnemyGroupDepartingFromSector, numEnemiesInSector } from '../../src/sim/strategic/forces/groups.ts';
import { sectorInfo } from '../../src/sim/strategic/map/sectors.ts';
import type { TacticalContent } from '../../src/sim/tactical/content.ts';
import { AutoresolveMark, type Report, replayBattle, replayStreams } from './autoresolve-compare.ts';

type Json = Record<string, unknown>;

const SECONDS_PER_DAY = 86_400;
const num = (v: unknown): number => Number(v ?? 0);
const obj = (v: unknown): Json => (v ?? {}) as Json;
const nums = (v: unknown): number[] => ((v ?? []) as unknown[]).map(Number);

function addEnemyGroups(r: Report, c: CampaignSim, setup: Json, sector: Sector): void {
  const ctx = c.strategic;
  if (!ctx) return;
  for (const spec of (setup.groups ?? []) as Json[]) {
    const g = createNewEnemyGroupDepartingFromSector(ctx, sectorId(sector), num(spec.admins), num(spec.troops), num(spec.elites));
    r.same('aftermath: enemy group id', g.id, num(spec.id));
  }
}

function applyArSetup(r: Report, c: CampaignSim, setup: Json): Sector {
  const sector = parseSectorString(String(setup.sector));
  addEnemyGroups(r, c, setup, sector);
  const counts = obj(setup.counts);
  const info = sectorInfo(c.state.map, sector);
  const militia = nums(counts.militia);
  info.militia.splice(0, militia.length, ...militia);
  const [admins = 0, troops = 0, elites = 0] = nums(counts.stationary);
  info.numAdmins = admins;
  info.numTroops = troops;
  info.numElites = elites;
  const clock = c.state.clock;
  const day = num(setup.day);
  if (Math.trunc(clock.seconds / SECONDS_PER_DAY) !== day) {
    clock.seconds = day * SECONDS_PER_DAY + (clock.seconds % SECONDS_PER_DAY);
    clock.previousSeconds = clock.seconds;
  }
  if (setup.tacticalMilitia) {
    c.state.economy.strategicMilitiaChangesMade = true;
    c.sectors?.resetMilitia();
  }
  c.state.encounter.code = num(setup.code);
  c.state.battle.persistent = Boolean(setup.persistent);
  c.state.battle.sector = { ...sector };
  return sector;
}

function countsOf(c: CampaignSim, sector: Sector): Json {
  const info = sectorInfo(c.state.map, sector);
  const total = getNumberOfEnemiesInSector(c.economy ?? (c.strategic as NonNullable<CampaignSim['strategic']>), sector);
  return {
    stationary: [info.numAdmins, info.numTroops, info.numElites],
    total: [total.admins, total.troops, total.elites],
    inSector: c.strategic ? numEnemiesInSector(c.strategic, sector) : 0,
    militia: [...info.militia],
    enemyControlled: c.state.map.elements[strategicIndex(sector)]?.enemyControlled === true,
  };
}

function loyaltyOf(c: CampaignSim, theirs: unknown): unknown {
  if (theirs === null || theirs === undefined) return null;
  const town = num(obj(theirs).town);
  const t = c.state.economy.towns[town];
  return { town, rating: t?.rating, change: t?.change };
}

function compareGroupAssociation(r: Report, content: TacticalContent, c: CampaignSim, p: Json, sector: Sector): void {
  const economy = c.economy;
  if (!economy) return;
  const fresh = replayBattle(content, p).built.ar;
  for (const cell of fresh.enemies) {
    cell.flags &= ~CellFlag.ASSIGNED;
    cell.groupId = 0;
  }
  const ctx = { economy, queen: c.queen, content, roster: c.battle?.roster as NonNullable<CampaignSim['battle']>['roster'] };
  associateEnemiesWithStrategicGroups(
    fresh.enemies,
    getNumberOfEnemiesInSector(economy, sector),
    {
      admins: sectorInfo(c.state.map, sector).numAdmins,
      troops: sectorInfo(c.state.map, sector).numTroops,
      elites: sectorInfo(c.state.map, sector).numElites,
    },
    enemyGroupCounts(ctx, sector),
  );
  const theirs = ((p.setup ?? []) as Json[]).filter((x) => num(x.side) === 2).map((x) => num(obj(x.soldier).groupId));
  r.same(
    'aftermath: enemy group ids',
    fresh.enemies.map((x) => x.groupId),
    theirs,
  );
}

export function compareAutoresolveAftermath(r: Report, content: TacticalContent, session: CampaignSession, setup: Json, p: Json): void {
  const c = session.campaign;
  const flow = c.battle;
  if (!flow) {
    r.same('aftermath', 'battle flow', 'missing');
    return;
  }
  const sector = applyArSetup(r, c, setup);
  r.same('aftermath: counts before', countsOf(c, sector), p.countsBefore);
  r.same('aftermath: loyalty before', loyaltyOf(c, p.result && obj(p.result).loyaltyBefore), obj(p.result).loyaltyBefore);
  compareGroupAssociation(r, content, c, p, sector);
  const { built } = replayBattle(content, p, undefined, { battleRetreat: () => flow.retreatFromAutoresolve(sector) });
  flow.adoptAutoresolve(built.ar, sector, null);
  flow.settleAutoresolve();
  if (obj(p.result).bandaged) {
    const bandage = replayStreams(p, AutoresolveMark.BANDAGE, [AutoresolveMark.CLOSE]);
    flow.useAutoresolveRng(cosmeticOnMain({ pre: bandage.pre, main: bandage.main, fx: bandage.main }));
    const prompt = c.state.battle.prompt;
    r.same('aftermath: bandage', c.dispatch({ type: 'answer', prompt: prompt?.id, choice: 'bandage' }).ok, true);
  }
  const close = replayStreams(p, AutoresolveMark.CLOSE, [AutoresolveMark.POST, AutoresolveMark.DONE]);
  flow.useAutoresolveRng(cosmeticOnMain({ pre: close.pre, main: close.main, fx: close.main }));
  const done = c.state.battle.prompt;
  const answered = c.dispatch({ type: 'answer', prompt: done?.id, choice: 'done' });
  r.same('aftermath: done', answered.ok ? 'ok' : answered.reason, 'ok');
  r.same('aftermath: close draws left', [close.pre.remaining, close.main.remaining], [0, 0]);
  const result = obj(p.result);
  r.same('aftermath: world seconds', c.state.clock.seconds, result.worldSecondsAfter);
  r.same('aftermath: counts after', countsOf(c, sector), result.countsAfter);
  r.same('aftermath: loyalty after', loyaltyOf(c, result.loyaltyAfter), result.loyaltyAfter);
}

export function compareEnemyCounts(session: CampaignSession, p: Json): number {
  const ctx = session.campaign.strategic;
  const sector = parseSectorString(String(p.sector));
  if (!ctx) return 1;
  const info = sectorInfo(ctx.state.map, sector);
  const total = getNumberOfEnemiesInSector(ctx, sector);
  const ours = {
    garrisonId: info.garrisonId,
    garrison: [info.numAdmins, info.numTroops, info.numElites],
    stationary: numStationaryEnemiesInSector(ctx, sector),
    mobile: numMobileEnemiesInSector(ctx, sector),
    total: [total.admins, total.troops, total.elites],
    inSector: numEnemiesInSector(ctx, sector),
  };
  const theirs = {
    garrisonId: p.garrisonId,
    garrison: p.garrison,
    stationary: p.stationary,
    mobile: p.mobile,
    total: p.total,
    inSector: p.inSector,
  };
  const same = JSON.stringify(ours) === JSON.stringify(theirs);
  console.log(
    `enemycounts line ${String(p.line)} ${String(p.sector)}: ${same ? 'ok' : 'MISMATCH'} ${JSON.stringify(ours)}${same ? '' : ` vs ${JSON.stringify(theirs)}`}`,
  );
  return same ? 0 : 1;
}
