import { parseSectorString, sameSector, sectorId } from '../../src/content/strategic/sector-ids.ts';
import type { CampaignSession } from '../../src/server/campaign-session.ts';
import { ReplayStream, type TracedDraw } from '../../src/sim/strategic/forces/autoresolve/replay-rng.ts';
import { EncounterCode } from '../../src/sim/strategic/forces/constants.ts';
import { createNewEnemyGroupDepartingFromSector, type Group } from '../../src/sim/strategic/forces/groups.ts';
import type { RollSource } from '../../src/sim/strategic/forces/ports.ts';
import { determineEncounterCode, wakeUpAllMercsInSectorUnderAttack } from '../../src/sim/strategic/forces/pre-battle.ts';

type Json = Record<string, unknown>;
type Draw = readonly [string, number, number, number];

const num = (v: unknown): number => Number(v ?? 0);

function rolls(stream: ReplayStream): RollSource {
  return { int: (n) => stream.int(n), chance: (percent) => stream.int(100) < percent };
}

function traced(draws: readonly Draw[], kind: string): TracedDraw[] {
  return draws.filter(([s]) => s === kind).map(([, n, v]) => ({ n, v }));
}

export function comparePreBattle(session: CampaignSession, p: Json): number {
  const label = `pbi line ${String(p.line)} ${String(p.sector)} ${String(p.group)}`;
  const c = session.campaign;
  const economy = c.economy;
  if (!economy) {
    console.log(`${label}: MISMATCH no economy`);
    return 1;
  }
  const sector = parseSectorString(String(p.sector));
  let group: Group | null = null;
  if (p.group === 'player')
    group = economy.state.forces.groups.find((g) => g.player && g.size !== 0 && !g.betweenSectors && sameSector(g.sector, sector)) ?? null;
  else if (p.group === 'enemy') {
    const counts = ((p.enemies as Json | null)?.counts as number[] | undefined) ?? [0, 4, 0];
    group = createNewEnemyGroupDepartingFromSector(economy, sectorId(sector), counts[0] ?? 0, counts[1] ?? 4, counts[2] ?? 0);
  }
  const life = num(p.mercsLife);
  if (life > 0) for (const m of session.roster?.all() ?? []) if (!m.betweenSectors && sameSector(m.sector, sector)) m.soldier.life = life;
  const draws = (p.draws ?? []) as Draw[];
  const main = new ReplayStream('main', traced(draws, 'm'));
  const pre = new ReplayStream('pre', traced(draws, 'p'));
  const ctx = { ...economy, random: rolls(main), preRandom: rolls(pre) };
  const enc = economy.state.encounter;
  enc.highPotentialForAmbush = p.highPotentialIn === true;
  enc.cantRetreatInPBI = p.cantRetreatIn === true;
  enc.code = EncounterCode.NO_ENCOUNTER;
  try {
    wakeUpAllMercsInSectorUnderAttack(ctx, sector);
    determineEncounterCode(ctx, group, sector);
  } catch (e) {
    console.log(`${label}: MISMATCH ${String(e)}`);
    return 1;
  }
  const ours = { groupId: group?.id ?? -1, code: enc.code, drawsLeft: [main.remaining, pre.remaining] };
  const theirs = { groupId: num(p.groupId), code: num(p.code), drawsLeft: [0, 0] };
  const same = JSON.stringify(ours) === JSON.stringify(theirs);
  console.log(`${label}: ${same ? 'ok' : 'MISMATCH'} ${JSON.stringify(ours)}${same ? '' : ` vs ${JSON.stringify(theirs)}`}`);
  return same ? 0 : 1;
}
