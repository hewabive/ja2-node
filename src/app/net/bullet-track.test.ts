import { describe, expect, it } from 'vitest';
import type { BulletAtTick, ViewFrame } from '../../protocol/view.ts';
import { BulletTrack } from './bullet-track.ts';

const at = (tick: number, x: number): BulletAtTick => ({ tick, x, y: 5, z: 30 });
const frame = (tick: number, bullets: readonly BulletAtTick[]): ViewFrame => ({ tick, changed: [], removed: [], bullets });

describe('the bullet track', () => {
  it('answers the bullets of a tick from frames not yet played, and forgets the ticks played past', () => {
    const track = new BulletTrack();
    track.add([frame(10, [at(9, 90), at(10, 100), at(10, 400)]), frame(20, [at(11, 110)])]);
    expect(track.at(10).map((b) => b.x)).toEqual([100, 400]);
    expect(track.at(10)[0]).toEqual({ tick: 10, x: 100, y: 5, z: 30 });
    expect(track.at(12)).toEqual([]);
    track.forgetBefore(11);
    expect(track.at(10)).toEqual([]);
    expect(track.at(11).map((b) => b.x)).toEqual([110]);
    track.clear();
    expect(track.at(11)).toEqual([]);
  });
});
