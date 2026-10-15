export const TICK_MS = 5;

export function ticksForMs(ms: number): number {
  return Math.max(0, Math.ceil(ms / TICK_MS));
}

export function msForTicks(ticks: number): number {
  return ticks * TICK_MS;
}
