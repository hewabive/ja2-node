// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-11-08. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Merc_Entering.cc the drop's file statics (gHeliSeats, gfHandleHeli, the script position and
// @src state, the round, the merc being dropped, the exit count, the volume and its fades, gfFirstGuyDown,
// @src gfIngagedInDrop, gubMoveAwayRepeated, the shadow tile gpHeli) and HeliStateEnums; gfFirstHeliRun and
// @src GameScreen.cc gfTacticalDoHeliRun (2026-11-08).

export const HeliState = { APPROACH: 0, MOVETO: 1, BEGINDROP: 2, DROP: 3, ENDDROP: 4, MOVEAWAY: 5, EXIT: 6 } as const;

export interface HeliShadow {
  readonly gridNo: number;
  readonly x: number;
  y: number;
  z: number;
}

export interface HelicopterDrop {
  running: boolean;
  readonly seats: number[];
  sweetSpot: number;
  z: number;
  script: number;
  state: number;
  lastStepMs: number;
  curDrop: number;
  exitCount: number;
  round: number;
  volume: number;
  fadingIn: boolean;
  fadingOut: boolean;
  firstGuyDown: boolean;
  engagedInDrop: boolean;
  moveAwayRepeated: number;
  shadow: HeliShadow | null;
  readonly strandedShadows: HeliShadow[];
  doHeliRun: boolean;
  firstHeliRun: boolean;
}

export function createHelicopterDrop(): HelicopterDrop {
  return {
    running: false,
    seats: [],
    sweetSpot: 0,
    z: 0,
    script: 0,
    state: HeliState.APPROACH,
    lastStepMs: 0,
    curDrop: 0,
    exitCount: 0,
    round: 0,
    volume: 0,
    fadingIn: false,
    fadingOut: false,
    firstGuyDown: false,
    engagedInDrop: false,
    moveAwayRepeated: 0,
    shadow: null,
    strandedShadows: [],
    doHeliRun: false,
    firstHeliRun: false,
  };
}

export interface HelicopterShadowView {
  readonly gridNo: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface HelicopterDropView {
  readonly running: boolean;
  readonly engineVolume: number;
  readonly shadows: readonly HelicopterShadowView[];
}

export function helicopterDropRunning(t: { readonly helicopterDrop: HelicopterDrop }): boolean {
  return t.helicopterDrop.running;
}

function shadowView(s: HeliShadow): HelicopterShadowView {
  return { gridNo: s.gridNo, x: s.x, y: s.y, z: s.z };
}

export function helicopterDropView(t: { readonly helicopterDrop: HelicopterDrop }): HelicopterDropView | null {
  const d = t.helicopterDrop;
  const shown = d.shadow ? [...d.strandedShadows, d.shadow] : d.strandedShadows;
  if (!d.running && shown.length === 0) return null;
  return { running: d.running, engineVolume: d.running ? d.volume : 0, shadows: shown.map(shadowView) };
}

export function forgetHelicopterShadows(drop: HelicopterDrop): void {
  drop.shadow = null;
  drop.strandedShadows.length = 0;
}
