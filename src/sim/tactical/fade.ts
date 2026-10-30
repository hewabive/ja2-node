// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-30. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Overhead.cc ExecuteOverhead (fading, NEW_FADE_DELAY, the new-visibility check), HandleAtNewGridNo
// @src (the fade-out cancel); Tactical/OppList.cc ManSeesMan (the fade cancel).

import { setSoldierAniSpeed } from './animation.ts';
import { lightShadeLevel } from './lighting/lighting.ts';
import { NOWHERE, type Soldier, SoldierFade, Team, Visible } from './soldier.ts';
import type { TacticalState } from './state.ts';

const NEW_FADE_DELAY = 60;
const SHADE_MIN = 15;
const FADED_SHADE = SHADE_MIN - 3;
const GROUND = 0;
const ROOF = 1;

function landShade(t: TacticalState, g: number): number {
  return lightShadeLevel(t, g, GROUND);
}

function standingShade(t: TacticalState, s: Soldier): number {
  const onRoof = s.level > 0 && t.lighting.hasRoof[s.gridNo] === 1;
  return lightShadeLevel(t, s.gridNo, onRoof ? ROOF : GROUND);
}

function stepFadeOut(t: TacticalState, s: Soldier): void {
  const shade = Math.min(s.fadeShade + 1, SHADE_MIN);
  if (shade >= FADED_SHADE) {
    s.fade = SoldierFade.NONE;
    s.visible = Visible.HIDDEN;
    setSoldierAniSpeed(t, s);
  }
  s.fadeShade = shade;
}

function stepFadeIn(t: TacticalState, s: Soldier): void {
  const land = landShade(t, s.gridNo);
  let shade = Math.max(0, s.fadeShade - 1);
  if (shade <= land) {
    shade = land;
    s.fade = SoldierFade.NONE;
    setSoldierAniSpeed(t, s);
  }
  s.fadeShade = shade;
}

function stepFade(t: TacticalState, s: Soldier): void {
  if (s.fade === SoldierFade.NONE || t.clockMs < s.nextFadeAt) return;
  s.nextFadeAt = t.clockMs + NEW_FADE_DELAY;
  if (s.fade === SoldierFade.OUT) stepFadeOut(t, s);
  else if (s.fade === SoldierFade.IN) stepFadeIn(t, s);
}

function beginFadeOut(t: TacticalState, s: Soldier): void {
  if (s.gridNo !== NOWHERE) s.fadeShade = landShade(t, s.gridNo);
  s.fade = SoldierFade.OUT;
  s.fadeStartGridNo = s.gridNo;
  s.visible = Visible.FADING_OUT;
}

function beginFadeIn(s: Soldier): void {
  s.fadeShade = FADED_SHADE;
  s.fade = SoldierFade.IN;
  s.fadeStartGridNo = s.gridNo;
}

function noticeNewVisibility(t: TacticalState, s: Soldier): void {
  if (s.lastRenderVisible === s.visible) return;
  if (s.visible === Visible.HIDDEN && s.lastRenderVisible >= Visible.LIMBO) beginFadeOut(t, s);
  if (s.visible !== Visible.HIDDEN && s.lastRenderVisible === Visible.HIDDEN && s.team !== Team.OUR) beginFadeIn(s);
}

export function updateSoldierFade(t: TacticalState, s: Soldier): void {
  stepFade(t, s);
  noticeNewVisibility(t, s);
  s.lastRenderVisible = s.visible;
}

export function cancelFadeOnSighting(t: TacticalState, s: Soldier): void {
  if (s.fade !== SoldierFade.OUT && s.fade !== SoldierFade.IN) return;
  s.fade = SoldierFade.NONE;
  s.fadeShade = standingShade(t, s);
}

export function cancelFadeOutAwayFromStart(t: TacticalState, s: Soldier): void {
  if (s.fade !== SoldierFade.OUT || s.fadeStartGridNo === s.gridNo) return;
  s.fade = SoldierFade.NONE;
  s.fadeShade = standingShade(t, s);
  s.visible = Visible.HIDDEN;
}
