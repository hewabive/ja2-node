export interface ChangeCounts {
  smoke: number;
  light: number;
  fog: number;
  blood: number;
  occupancy: number;
}

export interface Counted {
  readonly changes: ChangeCounts;
}

export function createChangeCounts(): ChangeCounts {
  return { smoke: 0, light: 0, fog: 0, blood: 0, occupancy: 0 };
}

export function smokeChanged(t: Counted): void {
  t.changes.smoke++;
}

export function lightChanged(t: Counted): void {
  t.changes.light++;
}

export function fogChanged(t: Counted): void {
  t.changes.fog++;
}

export function bloodChanged(t: Counted): void {
  t.changes.blood++;
}

export function occupancyChanged(t: Counted): void {
  t.changes.occupancy++;
}
