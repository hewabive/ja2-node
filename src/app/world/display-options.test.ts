import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../ui/settings.ts';
import { tacticalOptionsOf } from './display-options.ts';

describe('the tactical display options of the world renderer', () => {
  it('passes the red item glow of the tactical status on with the display settings', () => {
    expect(tacticalOptionsOf(DEFAULT_SETTINGS).redItemGlow).toBe(false);
    expect(tacticalOptionsOf(DEFAULT_SETTINGS, { redItemGlow: true })).toMatchObject({ redItemGlow: true, glowItems: true });
  });
});
