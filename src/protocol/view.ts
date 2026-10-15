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
}

export interface PlayerView {
  readonly tick: number;
  readonly mapPath: string | null;
  readonly soldiers: readonly SoldierView[];
}

export interface ViewFrame {
  readonly tick: number;
  readonly changed: readonly SoldierView[];
  readonly removed: readonly number[];
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
    a.bodyType === b.bodyType
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
