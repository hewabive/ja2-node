import { describe, expect, it } from 'vitest';
import { Body } from './body-types.ts';
import { bodyTypePaletteSubstitution, CAMO_PALETTE, OWN_SHEET_PALETTE, reloadsPalette } from './palette-substitution.ts';

const standing = { stateName: 'STANDING', camouflaged: false };
const camouflaged = { stateName: 'STANDING', camouflaged: true };

describe('the palette a body wears instead of its replacements', () => {
  it('is the camouflage file for a painted merc, his sheet’s own while he burns or explodes, and none otherwise', () => {
    expect(bodyTypePaletteSubstitution(Body.REGFEMALE, camouflaged)).toBe(CAMO_PALETTE);
    expect(bodyTypePaletteSubstitution(Body.BIGMALE, { stateName: 'CHARIOTS_OF_FIRE', camouflaged: true })).toBe(OWN_SHEET_PALETTE);
    expect(bodyTypePaletteSubstitution(Body.REGMALE, { stateName: 'BODYEXPLODING', camouflaged: false })).toBe(OWN_SHEET_PALETTE);
    expect(bodyTypePaletteSubstitution(Body.STOCKYMALE, standing)).toBeNull();
    expect(bodyTypePaletteSubstitution(Body.REGMALE, null)).toBeNull();
  });

  it('is a creature colour file for the adult creatures, the sheet’s own for animals, vehicles, the robot and the queen', () => {
    expect(bodyTypePaletteSubstitution(Body.YAF_MONSTER, standing)).toBe('anims/monsters/fm_brite.col');
    expect(bodyTypePaletteSubstitution(Body.YAM_MONSTER, standing)).toBe('anims/monsters/mn_brite.col');
    expect(bodyTypePaletteSubstitution(Body.ADULTFEMALEMONSTER, null)).toBe('anims/monsters/femmon.col');
    expect(bodyTypePaletteSubstitution(Body.AM_MONSTER, standing)).toBe('anims/monsters/monster.col');
    for (const body of [Body.QUEENMONSTER, Body.CROW, Body.COW, Body.BLOODCAT, Body.ROBOTNOWEAPON, Body.TANK_NE, Body.JEEP])
      expect(bodyTypePaletteSubstitution(body, standing)).toBe(OWN_SHEET_PALETTE);
  });

  it('ignores camouflage and fire on civilians and the young creatures', () => {
    expect(bodyTypePaletteSubstitution(Body.MANCIV, { stateName: 'CHARIOTS_OF_FIRE', camouflaged: true })).toBeNull();
    expect(bodyTypePaletteSubstitution(Body.LARVAE_MONSTER, camouflaged)).toBeNull();
    expect(bodyTypePaletteSubstitution(Body.INFANT_MONSTER, standing)).toBeNull();
  });

  it('is taken again when a soldier starts burning, exploding or a vehicle dies', () => {
    expect(['VEHICLE_DIE', 'CHARIOTS_OF_FIRE', 'BODYEXPLODING', 'STANDING'].map(reloadsPalette)).toEqual([true, true, true, false]);
  });
});
