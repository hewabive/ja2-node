import { beforeAll, describe, expect, it } from 'vitest';
import { newCombatSim, runUntilIdle, spawnSoldier } from '../../../tests/support/combat.ts';
import { itemId } from '../../../tests/support/explosives.ts';
import { loadTestContent } from '../../../tests/support/tactical.ts';
import type { StructureDef, StructureFile } from '../../content/formats/jsd.ts';
import { Direction, gridNo } from '../../content/world/grid.ts';
import { StructureFlags } from '../../content/world/structures.ts';
import { syntheticStructure } from '../../content/world/synthetic.ts';
import type { TileElement } from '../../content/world/tile-database.ts';
import type { SimEvent } from '../events.ts';
import type { TacticalContent } from './content.ts';
import { swapStructureForPartnerAndRecord } from './doors.ts';
import { decaySmokeEffects, newSmokeEffect } from './explosions/smoke.ts';
import { lightSpriteCreate, lightSpritePosition, lightSpritePower } from './lighting/lighting.ts';
import { Team } from './soldier.ts';
import { corpseViews, smokeViews, tileChangeViews, worldLightView } from './world-view.ts';

let content: TacticalContent;

beforeAll(async () => {
  content = await loadTestContent();
});

const CENTRE = gridNo(80, 80);

describe('the world view', () => {
  it('lists a corpse with the palettes and camouflage of the soldier it was', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    spawnSoldier(sim, 0, Team.OUR, gridNo(80, 80), Direction.SOUTH, { marksmanship: 100, life: 100 });
    const enemy = spawnSoldier(sim, 20, Team.ENEMY, gridNo(80, 83), Direction.NORTH, { life: 3 });
    enemy.camo = 40;
    sim.lookAround();
    sim.drainEvents();
    const events: SimEvent[] = [];
    for (let shot = 0; shot < 5 && enemy.placed; shot++) {
      expect(sim.dispatch({ type: 'attack', soldier: 0, target: enemy.gridNo, aimTime: 4 }).ok).toBe(true);
      events.push(...runUntilIdle(sim));
    }
    expect(enemy.placed).toBe(false);
    const [corpse] = corpseViews(t);
    expect(corpse).toMatchObject({
      gridNo: enemy.gridNo,
      level: 0,
      bodyType: enemy.bodyType,
      palettes: ['BLACKHEAD', 'PINKSKIN', 'BLUEVEST', 'JEANPANTS'],
      camo: true,
    });
    expect(corpse?.type).toBe(t.corpses[0]?.type);
  });

  it('lists smoke tiles by effect and marks those a dissipating cloud drew last', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    t.inCombat = true;
    expect(smokeViews(t)).toEqual([]);
    newSmokeEffect(t, CENTRE, itemId(t, 'SMOKE_GRENADE'), 0, null);
    const fresh = smokeViews(t);
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.every((s) => s.effect === 'SMOKE' && s.level === 0 && !s.dissipating)).toBe(true);
    expect(fresh.some((s) => s.gridNo === CENTRE)).toBe(true);
    const cloud = t.explosives.smokeClouds[0];
    if (!cloud) throw new Error('no cloud');
    while (cloud.duration - cloud.age >= 2) decaySmokeEffects(t);
    decaySmokeEffects(t);
    const late = smokeViews(t);
    expect(late.length).toBeGreaterThan(0);
    expect(late.every((s) => s.dissipating === true)).toBe(true);
  });

  it('carries the ambient level and the dynamic light sprites, not the map lights', () => {
    const sim = newCombatSim(content);
    const t = sim.state;
    t.lighting.ambient = 12;
    const mapLight = lightSpriteCreate(t, 'L-R05.LHT');
    if (mapLight) {
      lightSpritePower(mapLight, true);
      lightSpritePosition(t, mapLight, 10, 10);
    }
    expect(worldLightView(t)).toEqual({ ambient: 12, sprites: [] });
    const s = spawnSoldier(sim, 0, Team.OUR, CENTRE, Direction.SOUTH);
    const flash = lightSpriteCreate(t, 'L-R03.LHT');
    if (!flash) throw new Error('no template');
    lightSpritePower(flash, true);
    lightSpritePosition(t, flash, 80, 81);
    s.muzzleFlashLight = flash;
    expect(worldLightView(t)).toEqual({ ambient: 12, sprites: [{ x: 80, y: 81, template: 'L-R03.LHT' }] });
  });

  it('turns recorded structure swaps into tile removals and additions', () => {
    const intact: StructureDef = {
      ...syntheticStructure(StructureFlags.WALLNWINDOW | StructureFlags.WALL),
      number: 0,
      partnerDelta: 1,
    };
    const cracked: StructureDef = { ...syntheticStructure(StructureFlags.WALLNWINDOW | StructureFlags.WALL), number: 1 };
    const file: StructureFile = { structures: [intact, cracked] } as unknown as StructureFile;
    const tile = (index: number, structure: StructureDef): TileElement =>
      ({ index, type: 7, structure, structureFile: file }) as unknown as TileElement;
    const sim = newCombatSim(content);
    const t = sim.state;
    Object.assign(t.world, { tiles: [tile(0, intact), tile(1, intact), tile(2, cracked)] });
    const window = t.world.structures.add(CENTRE, 0, intact, undefined, file);
    if (!window) throw new Error('window not added');
    swapStructureForPartnerAndRecord(t, window);
    expect(tileChangeViews(t)).toEqual([
      { kind: 'remove', gridNo: CENTRE, level: 0, tile: 0 },
      { kind: 'add', gridNo: CENTRE, level: 0, tile: 2 },
    ]);
  });
});
