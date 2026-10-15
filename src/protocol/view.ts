export interface SoldierView {
  readonly id: number;
  readonly team: number;
  readonly name: string;
  readonly bodyType: number;
  readonly gridNo: number;
  readonly x: number;
  readonly y: number;
  readonly level: number;
  readonly direction: number;
  readonly animation: number;
  readonly frame: number;
  readonly palettes: readonly [string, string, string, string];
  readonly hand: string;
  readonly ap?: number;
  readonly life?: number;
  readonly lifeMax?: number;
  readonly breath?: number;
}

export interface CombatView {
  readonly team: number;
  readonly round: number;
  readonly interrupt: boolean;
}

export interface PlayerView {
  readonly tick: number;
  readonly mapPath: string | null;
  readonly soldiers: readonly SoldierView[];
  readonly openDoors?: readonly number[];
  readonly combat?: CombatView | null;
  readonly revealedRooms?: readonly number[];
}

export interface ViewFrame {
  readonly tick: number;
  readonly changed: readonly SoldierView[];
  readonly removed: readonly number[];
  readonly openDoors?: readonly number[];
  readonly combat?: CombatView | null;
  readonly revealedRooms?: readonly number[];
}

function sameCombat(a: CombatView | null | undefined, b: CombatView | null | undefined): boolean {
  if (!a || !b) return !a === !b;
  return a.team === b.team && a.round === b.round && a.interrupt === b.interrupt;
}

function sameList(a: readonly number[] | undefined, b: readonly number[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

export function diffPlayerView(previous: PlayerView, next: PlayerView): ViewFrame | null {
  let frame = diffView(previous.soldiers, next.soldiers, next.tick);
  if (!sameList(previous.openDoors, next.openDoors))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), openDoors: next.openDoors ?? [] };
  if (!sameList(previous.revealedRooms, next.revealedRooms))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), revealedRooms: next.revealedRooms ?? [] };
  if (!sameCombat(previous.combat, next.combat))
    frame = { ...(frame ?? { tick: next.tick, changed: [], removed: [] }), combat: next.combat ?? null };
  return frame;
}

function sameSoldier(a: SoldierView, b: SoldierView): boolean {
  return (
    a.gridNo === b.gridNo &&
    a.x === b.x &&
    a.y === b.y &&
    a.level === b.level &&
    a.direction === b.direction &&
    a.animation === b.animation &&
    a.frame === b.frame &&
    a.team === b.team &&
    a.bodyType === b.bodyType &&
    a.hand === b.hand &&
    a.ap === b.ap &&
    a.life === b.life &&
    a.lifeMax === b.lifeMax &&
    a.breath === b.breath
  );
}

export function diffView(previous: readonly SoldierView[], next: readonly SoldierView[], tick: number): ViewFrame | null {
  const before = new Map(previous.map((s) => [s.id, s]));
  const changed = next.filter((s) => {
    const old = before.get(s.id);
    return !old || !sameSoldier(old, s);
  });
  const nextIds = new Set(next.map((s) => s.id));
  const removed = previous.filter((s) => !nextIds.has(s.id)).map((s) => s.id);
  return changed.length === 0 && removed.length === 0 ? null : { tick, changed, removed };
}

export function applyFrame(soldiers: readonly SoldierView[], frame: ViewFrame): SoldierView[] {
  const byId = new Map(soldiers.map((s) => [s.id, s]));
  for (const id of frame.removed) byId.delete(id);
  for (const s of frame.changed) byId.set(s.id, s);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}
