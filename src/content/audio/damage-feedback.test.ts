import { describe, expect, it } from 'vitest';
import { BLEED_GRUNT_GAP_MS, BleedGrunts, damageFeedbackSounds } from './damage-feedback.ts';

describe('the sounds of bleeding, gas and electric damage', () => {
  it('lets a soldier grunt only when more than a second has passed since his last grunt, counted per soldier', () => {
    const grunts = new BleedGrunts();
    expect(grunts.due(1, 5_000)).toBe(true);
    expect(grunts.due(2, 5_000)).toBe(true);
    expect(grunts.due(1, 5_000 + BLEED_GRUNT_GAP_MS)).toBe(false);
    expect(grunts.due(1, 5_001 + BLEED_GRUNT_GAP_MS)).toBe(true);
    expect(grunts.due(1, 5_001 + 2 * BLEED_GRUNT_GAP_MS)).toBe(false);
  });

  it('cries DIE1 for a seen soldier hurt by gas or electricity, never at bleeding, before the grunts', () => {
    expect(damageFeedbackSounds({ cause: 'electricity', seen: true, conscious: false }, true)).toEqual(['DIE1', 'HIT1']);
    expect(damageFeedbackSounds({ cause: 'electricity', seen: false, conscious: false }, true)).toEqual(['HIT1']);
    expect(damageFeedbackSounds({ cause: 'bleeding', seen: true, conscious: false }, true)).toEqual(['HIT1']);
    expect(damageFeedbackSounds({ cause: 'bleeding', seen: true, conscious: false }, false)).toEqual([]);
  });

  it('grunts once more for gas that leaves the soldier conscious, even when the timed grunt is not due', () => {
    expect(damageFeedbackSounds({ cause: 'gas', seen: true, conscious: true }, true)).toEqual(['DIE1', 'HIT1', 'HIT1']);
    expect(damageFeedbackSounds({ cause: 'gas', seen: false, conscious: true }, false)).toEqual(['HIT1']);
  });
});
