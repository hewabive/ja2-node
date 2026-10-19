import { describe, expect, it } from 'vitest';
import { BOBBY_RAY_SPEEDS, bobbyRaySpeedLabel } from './bobby-ray.ts';

describe("Bobby Ray's delivery speeds (BobbyRMailOrder.cc CalculateOrderDelay, rule finding 6)", () => {
  it('names speed 0 overnight express and speed 2 standard service, as the order form lists them', () => {
    expect(BOBBY_RAY_SPEEDS).toEqual(['overnightExpress', 'twoBusinessDays', 'standardService']);
    expect([0, 1, 2, 3].map(bobbyRaySpeedLabel)).toEqual(['overnight express', '2 business days', 'standard service', '3']);
  });
});
