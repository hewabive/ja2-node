import type { SoldierView } from '../../src/protocol/view.ts';
import { handItem, isGun } from './gear.ts';
import { tiles } from './grid.ts';
import type { Observation } from './mcp-game.ts';
import { ourMercs, type Player, usable } from './player.ts';

const KITS: ReadonlySet<string> = new Set(['FIRSTAIDKIT', 'MEDICKIT']);
const KIT_PREFERENCE = ['FIRSTAIDKIT', 'MEDICKIT'] as const;
const DONE_EVENTS = ['firstAidDone', 'firstAidEnded', 'outOfBandages', 'firstAidRefused'] as const;
const AID_SLICE_TICKS = 2000;
const AID_SLICES = 30;
const HAND = 5;

function kitSlot(merc: SoldierView): number | null {
  for (const kit of KIT_PREFERENCE) {
    const found = merc.inventory?.find((o) => o.item === kit);
    if (found) return found.slot;
  }
  return null;
}

export function holdsKit(merc: SoldierView): boolean {
  return KITS.has(handItem(merc)?.item ?? '');
}

export function hasKit(merc: SoldierView): boolean {
  return kitSlot(merc) !== null;
}

function chooseMedic(view: Observation, patient: SoldierView, medics: readonly number[]): SoldierView | undefined {
  const able = ourMercs(view).filter((m) => usable(m) && hasKit(m));
  const preferred = medics.map((id) => able.find((m) => m.id === id)).find((m) => m !== undefined);
  return preferred ?? able.sort((a, b) => tiles(a.gridNo, patient.gridNo) - tiles(b.gridNo, patient.gridNo) || a.id - b.id)[0];
}

export async function kitInHand(p: Player, medic: SoldierView): Promise<boolean> {
  if (KITS.has(handItem(medic)?.item ?? '')) return true;
  const slot = kitSlot(medic);
  if (slot === null) return false;
  return (await p.act({ type: 'moveItem', soldier: medic.id, from: slot, to: 'hand' })).ok;
}

async function treat(p: Player, medic: SoldierView, patient: SoldierView): Promise<boolean> {
  const started = await p.act({ type: 'bandage', soldier: medic.id, target: patient.id });
  if (!started.ok) return false;
  for (let slice = 0; slice < AID_SLICES; slice++) {
    const report = await p.advance({ ticks: AID_SLICE_TICKS, events: [...DONE_EVENTS, 'combatStarted'] });
    if (report.reason === 'decision' || report.events.some((e) => e.type === 'combatStarted')) return false;
    if (report.events.some((e) => (DONE_EVENTS as readonly string[]).includes(e.type))) return true;
  }
  return false;
}

export async function rearm(p: Player): Promise<void> {
  const view = await p.observe();
  for (const merc of ourMercs(view)) {
    if (!KITS.has(handItem(merc)?.item ?? '')) continue;
    const gun = merc.inventory?.find((o) => o.slot !== HAND && isGun(p.item(o.item)));
    if (gun) await p.act({ type: 'moveItem', soldier: merc.id, from: gun.slot, to: 'hand' });
  }
}

export async function bandageWounded(p: Player, medics: readonly number[], only: ReadonlySet<number> | null = null): Promise<void> {
  let view = await p.observe();
  if (view.combat || view.strategic?.flow !== 'tactical') return;
  const patients = ourMercs(view)
    .filter((m) => (m.life ?? 0) > 0 && (m.life ?? 0) < (m.lifeMax ?? 0) && (only === null || only.has(m.id)))
    .sort((a, b) => (a.life ?? 0) - (b.life ?? 0) || a.id - b.id)
    .map((m) => m.id);
  for (const id of patients) {
    view = await p.observe();
    if (view.combat) break;
    const patient = view.soldiers.find((s) => s.id === id);
    if (!patient) continue;
    const medic = chooseMedic(view, patient, medics);
    if (!medic) break;
    if (!(await kitInHand(p, medic))) continue;
    const fresh = (await p.observe()).soldiers.find((s) => s.id === medic.id) ?? medic;
    if (await treat(p, fresh, patient)) p.memory.bleeding.delete(id);
  }
  await rearm(p);
}
