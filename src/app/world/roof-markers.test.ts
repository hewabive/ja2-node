import { describe, expect, it } from 'vitest';
import type { SoldierView } from '../../protocol/view.ts';
import { RoofMarkers } from './roof-markers.ts';

const WALKING = 0;
const STANDING = 1;
const CROUCHED = 3;
const CLIMBUPROOF = 32;
const CLIMBDOWNROOF = 35;
const OUR_TEAM = 0;
const ENEMY_TEAM = 1;
const ROOF = 1000;
const NEXT_ROOF = 1001;
const GROUND = 999;
const MERC = 7;
const ENEMY = 40;

function markers(): RoofMarkers {
  return new RoofMarkers({
    climbUpRoof: CLIMBUPROOF,
    stationary: (animation) => animation !== WALKING,
    hasRoof: (g) => g === ROOF || g === NEXT_ROOF,
  });
}

function soldier(over: Partial<SoldierView> = {}): SoldierView {
  return {
    id: MERC,
    team: OUR_TEAM,
    name: '',
    bodyType: 0,
    gridNo: ROOF,
    x: 0,
    y: 0,
    level: 1,
    direction: 0,
    animation: STANDING,
    frame: 0,
    palettes: ['', '', '', ''],
    hand: '',
    frameSlot: 0,
    stateTick: 0,
    frameDelay: 0,
    ...over,
  };
}

const enemy = (over: Partial<SoldierView> = {}) => soldier({ id: ENEMY, team: ENEMY_TEAM, ...over });

describe('the roof marker under a soldier on a roof (HandlePlacingRoofMarker)', () => {
  it('marks the soldiers standing on a roof in the first view, as a new soldier counts as having moved', () => {
    const roof = markers();
    expect(roof.update([soldier(), enemy({ gridNo: NEXT_ROOF })])).toEqual([ROOF, NEXT_ROOF]);
  });

  it('marks only a roofed tile on the second level', () => {
    const roof = markers();
    expect(roof.update([soldier({ gridNo: GROUND }), enemy({ level: 0 })])).toEqual([]);
  });

  it('takes the marker off when he starts moving and puts it on the tile where he stops', () => {
    const roof = markers();
    roof.update([soldier()]);
    expect(roof.update([soldier({ animation: WALKING })])).toEqual([]);
    expect(roof.update([soldier({ animation: WALKING, gridNo: NEXT_ROOF })])).toEqual([]);
    expect(roof.update([soldier({ gridNo: NEXT_ROOF })])).toEqual([NEXT_ROOF]);
  });

  it('counts a merc halted for want of action points as standing (fNoAPToFinishMove)', () => {
    const roof = markers();
    roof.update([soldier({ animation: WALKING })]);
    expect(roof.update([soldier({ animation: WALKING, noApToFinishMove: true })])).toEqual([ROOF]);
  });

  it("marks our merc's roof tile at the end of his climb up (Soldier_Ani.cc 408)", () => {
    const roof = markers();
    roof.update([soldier({ gridNo: GROUND, level: 0 })]);
    roof.update([soldier({ gridNo: GROUND, level: 0, animation: CLIMBUPROOF })]);
    expect(roof.update([soldier({ gridNo: ROOF, level: 1, animation: CLIMBUPROOF })])).toEqual([]);
    expect(roof.update([soldier({ animation: CROUCHED })])).toEqual([ROOF]);
  });

  it('gives an enemy who climbs up in sight no marker until he walks and stops: only our merc is marked at the climb', () => {
    const roof = markers();
    roof.update([enemy({ gridNo: GROUND, level: 0 })]);
    roof.update([enemy({ gridNo: GROUND, level: 0, animation: CLIMBUPROOF })]);
    roof.update([enemy({ animation: CLIMBUPROOF })]);
    expect(roof.update([enemy({ animation: CROUCHED })])).toEqual([]);
    roof.update([enemy({ animation: WALKING })]);
    expect(roof.update([enemy({ gridNo: NEXT_ROOF })])).toEqual([NEXT_ROOF]);
  });

  it('keeps the marker through a climb down until he leaves the roof tile', () => {
    const roof = markers();
    roof.update([soldier()]);
    expect(roof.update([soldier({ animation: CLIMBDOWNROOF })])).toEqual([ROOF]);
    expect(roof.update([soldier({ gridNo: GROUND, animation: CLIMBDOWNROOF })])).toEqual([]);
  });

  it('takes the marker off as the soldier fades out and puts it back when he fades in', () => {
    const roof = markers();
    roof.update([soldier(), enemy({ gridNo: NEXT_ROOF })]);
    expect(roof.update([soldier(), enemy({ gridNo: NEXT_ROOF, fadingOut: true })])).toEqual([ROOF]);
    expect(roof.update([soldier()])).toEqual([ROOF]);
    expect(roof.update([soldier(), enemy({ gridNo: NEXT_ROOF })])).toEqual([ROOF, NEXT_ROOF]);
  });

  it('takes the marker off a soldier who leaves the view while seen', () => {
    const roof = markers();
    roof.update([soldier()]);
    expect(roof.update([])).toEqual([]);
  });

  it('gives no marker to a soldier seen again before his fade-out ends: the fade-in starts only from unseen', () => {
    const roof = markers();
    roof.update([enemy()]);
    roof.update([enemy({ fadingOut: true })]);
    expect(roof.update([enemy()])).toEqual([]);
    roof.update([enemy({ animation: WALKING })]);
    expect(roof.update([enemy()])).toEqual([ROOF]);
  });

  it('marks the tile of an enemy who walks back into sight on a roof until he steps off it: he started moving unseen', () => {
    const roof = markers();
    roof.update([enemy({ gridNo: GROUND, level: 0 })]);
    roof.update([]);
    expect(roof.update([enemy({ animation: WALKING })])).toEqual([ROOF]);
    expect(roof.update([enemy({ animation: WALKING })])).toEqual([ROOF]);
    expect(roof.update([enemy({ animation: WALKING, gridNo: NEXT_ROOF })])).toEqual([]);
  });

  it('starts over after a reset for a sector entry, as every soldier is created moving', () => {
    const roof = markers();
    roof.update([soldier({ animation: WALKING })]);
    roof.reset('created');
    expect(roof.update([soldier()])).toEqual([ROOF]);
  });

  it('marks nobody standing on a roof after a load until he walks and stops, as the save restores fSoldierWasMoving', () => {
    const roof = markers();
    roof.update([soldier()]);
    roof.reset('restored');
    expect(roof.update([soldier(), enemy({ gridNo: NEXT_ROOF })])).toEqual([]);
    expect(roof.update([soldier(), enemy({ gridNo: NEXT_ROOF })])).toEqual([]);
    roof.update([soldier({ animation: WALKING }), enemy({ gridNo: NEXT_ROOF })]);
    expect(roof.update([soldier(), enemy({ gridNo: NEXT_ROOF })])).toEqual([ROOF]);
  });

  it('marks the tile where a soldier walking at the load stops', () => {
    const roof = markers();
    roof.reset('restored');
    expect(roof.update([soldier({ animation: WALKING })])).toEqual([]);
    expect(roof.update([soldier({ gridNo: NEXT_ROOF })])).toEqual([NEXT_ROOF]);
  });
});
