import type { StrategicMercView } from '../../src/protocol/view.ts';
import type { Observation } from './mcp-game.ts';
import { sectorInventory } from './outfit.ts';
import type { Player } from './player.ts';
import { mapScreen, squad, waitHours } from './travel.ts';

const HEALTHY = 0.85;
const RESTED_BREATH = 70;
const REST_SLICE_HOURS = 3;
const MEDICAL_KIT = 'MEDICKIT';
const SQUAD = 0;

function hurt(m: StrategicMercView): boolean {
  return m.life > 0 && m.life < m.lifeMax * HEALTHY;
}

function tired(m: StrategicMercView): boolean {
  return m.breathMax > 0 && m.breathMax < RESTED_BREATH;
}

function inSector(view: Observation, sector: string): StrategicMercView[] {
  return squad(view).filter((m) => m.sector === sector && !m.betweenSectors);
}

async function doctorFor(p: Player, sector: string, medics: readonly number[], exclude: readonly number[]): Promise<number | null> {
  const inv = await sectorInventory(p, sector);
  if (!inv) return null;
  const withKit = inv.mercs
    .filter((m) => m.accessible && !exclude.includes(m.id) && m.inventory.some((o) => o.item === MEDICAL_KIT))
    .map((m) => m.id);
  return medics.find((id) => withKit.includes(id)) ?? withKit[0] ?? null;
}

export async function rejoinSquad(p: Player, ids: readonly number[]): Promise<void> {
  for (const id of ids) await p.act({ type: 'assign', soldiers: [id], to: { kind: 'squad', squad: SQUAD } });
}

export async function restAndHeal(
  p: Player,
  sector: string,
  medics: readonly number[],
  maxHours: number,
  exclude: readonly number[] = [],
): Promise<void> {
  if (!(await mapScreen(p))) return;
  let view = await p.observe();
  const resting = (v: Observation) => inSector(v, sector).filter((m) => !exclude.includes(m.id));
  if (!resting(view).some((m) => hurt(m) || tired(m))) return;
  const doctor = await doctorFor(p, sector, medics, exclude);
  const everyone = resting(view).map((m) => m.id);
  const patients = resting(view)
    .filter((m) => hurt(m) && m.id !== doctor)
    .map((m) => m.id);
  if (doctor !== null) {
    const assigned = await p.act({ type: 'assign', soldiers: [doctor], to: { kind: 'doctor' } });
    if (!assigned.ok) p.log(`  doctor refused: ${assigned.reason ?? JSON.stringify(assigned.data)}`);
  }
  if (patients.length > 0) await p.act({ type: 'assign', soldiers: patients, to: { kind: 'patient' } });
  const sleepers = everyone.filter((id) => id !== doctor);
  for (const id of sleepers) await p.act({ type: 'sleep', soldier: id });
  p.log(`  resting in ${sector}: doctor ${doctor ?? 'none'}, patients ${patients.join(', ') || 'none'}`);
  for (let hours = 0; hours < maxHours; hours += REST_SLICE_HOURS) {
    await waitHours(p, REST_SLICE_HOURS);
    view = await p.observe();
    if (!resting(view).some((m) => hurt(m) || tired(m))) break;
  }
  for (const id of sleepers) await p.act({ type: 'wake', soldier: id });
  await rejoinSquad(p, everyone);
}
