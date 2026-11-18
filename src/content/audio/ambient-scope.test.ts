import { describe, expect, it } from 'vitest';
import { ambientsOffTheTacticalScreen } from './ambient-schedule.ts';

describe('the ambient sounds off the tactical screen (GameLoop.cc MusicPoll, Ambient_Control.cc)', () => {
  it('go on over the map screen while the world is loaded', () => {
    expect(ambientsOffTheTacticalScreen('map', true)).toBe('service');
  });

  it('stop once the world is unloaded with the map screen up (StrategicMap.cc DeleteAllAmbients)', () => {
    expect(ambientsOffTheTacticalScreen('map', false)).toBe('stop');
  });

  it('stop on the laptop and the options screens (Laptop.cc, Options_Screen.cc StopAmbients)', () => {
    expect(ambientsOffTheTacticalScreen('laptop', true)).toBe('stop');
    expect(ambientsOffTheTacticalScreen('options', true)).toBe('stop');
  });

  it('are left to the world render on the tactical screen and alone anywhere else', () => {
    expect(ambientsOffTheTacticalScreen('tactical', true)).toBe('leave');
    expect(ambientsOffTheTacticalScreen(undefined, true)).toBe('leave');
  });
});
