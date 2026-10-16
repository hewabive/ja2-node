import { describe, expect, it } from 'vitest';
import { readDataJson } from '../../../tests/support/tactical.ts';
import { openDataVfs } from '../../node/data-vfs.ts';
import { PROJECT_DATA_DIR } from '../../node/repo.ts';
import {
  EXPLOSION_ANIMATIONS_PATH,
  loadExplosionContent,
  parseExplosionContent,
  SMOKE_EFFECTS_PATH,
  SmokeEffectId,
  stiFrameCount,
} from './explosions.ts';

describe('explosion content', () => {
  const content = parseExplosionContent(readDataJson(EXPLOSION_ANIMATIONS_PATH), readDataJson(SMOKE_EFFECTS_PATH));

  it('numbers smoke effects by position and fills the optional flags', () => {
    expect([...content.smokeEffects.values()].map((s) => [s.name, s.id])).toEqual([
      ['SMOKE', SmokeEffectId.SMOKE],
      ['TEARGAS', SmokeEffectId.TEARGAS],
      ['MUSTARDGAS', SmokeEffectId.MUSTARDGAS],
      ['CREATUREGAS', SmokeEffectId.CREATUREGAS],
    ]);
    expect(content.smokeEffects.get('TEARGAS')).toMatchObject({
      damage: 0,
      breathDamage: 20,
      ignoresGasMask: false,
      affectsMonsters: true,
    });
    expect(content.smokeEffects.get('CREATUREGAS')).toMatchObject({
      damage: 5,
      ignoresGasMask: true,
      affectsRobot: true,
      affectsMonsters: false,
    });
  });

  it('ends an animation right after its damage frame when the graphic is not available', () => {
    const blast = content.animations.get('BLAST_1');
    expect(blast).toMatchObject({ blastSpeed: 80, damageKeyframe: 3, waterAnimation: 'WATER_BLAST' });
    expect(blast?.frames).toBe(4);
    expect(stiFrameCount(null)).toBeNull();
    expect(stiFrameCount(Uint8Array.of(1, 2, 3, 4))).toBeNull();
  });
});

describe.skipIf(!process.env.JA2_DATA_DIR)('explosion graphics from the original data', () => {
  it('reach the damage frame on land and never in water', async () => {
    const d = await openDataVfs({ projectDataDir: PROJECT_DATA_DIR, dataDir: process.env.JA2_DATA_DIR });
    try {
      const read = async (path: string) => (d.vfs.stat(path) ? d.vfs.read(path) : null);
      const loaded = await loadExplosionContent(read);
      for (const a of loaded.animations.values()) {
        if (a.name === 'WATER_BLAST') expect(a.frames).toBeLessThan(a.damageKeyframe);
        else expect(a.frames).toBeGreaterThan(a.damageKeyframe);
      }
    } finally {
      await d.close();
    }
  });
});
