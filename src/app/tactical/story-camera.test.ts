import { describe, expect, it } from 'vitest';
import type { PlayerView } from '../../protocol/view.ts';
import { Npc } from '../../sim/strategic/narrative/npc-ids.ts';
import { LocateFlag } from '../../ui/screens/tactical/overlays.ts';
import { entryCamera } from './story-camera.ts';

const SCENE_TILE = 12248;
const ENDGAME_TILE = 4561;
const QUEEN = 21;
const MERC = 3;
const QUEEN_TILE = 11608;

function viewIn(flow: string): PlayerView {
  return { strategic: { flow }, soldiers: [{ id: QUEEN, profile: Npc.QUEEN, gridNo: QUEEN_TILE }] } as unknown as PlayerView;
}

const sceneTile = { kind: 'gridNo', gridNo: SCENE_TILE };
const mercCentred = { kind: 'soldier', soldier: MERC, flag: LocateFlag.CENTER_AND_SETLOCATOR };
const queenOffScreen = { kind: 'soldier', soldier: QUEEN, flag: LocateFlag.DONTSETLOCATOR };

describe('the camera of a tactical screen entry (DoneFadeOutMeanwhile, MainGameScreenHandle, EnterTacticalScreen)', () => {
  it('puts a scene started on the map on its tile, then on the merc its load located, then on the Queen if she is off screen: the game screen is entered after the load', () => {
    const moves = entryCamera(viewIn('meanwhile'), { scene: { gridNo: SCENE_TILE, mapScreen: true }, located: MERC });
    expect(moves).toEqual([sceneTile, mercCentred, queenOffScreen]);
  });

  it('leaves the Queen out after the load of a scene started in tactical: the game screen was entered before the load, where she was not yet', () => {
    expect(entryCamera(viewIn('meanwhile'), { scene: { gridNo: SCENE_TILE, mapScreen: false }, located: null })).toEqual([sceneTile]);
  });

  it('locates only the Queen as the tactical screen comes back during a scene with no load', () => {
    expect(entryCamera(viewIn('meanwhile'), null)).toEqual([queenOffScreen]);
  });

  it("puts the endgame's fixed tile after the merc the load located, so the tile is what the player sees", () => {
    expect(entryCamera(viewIn('endgame'), { scene: null, located: MERC })).toEqual([mercCentred, { kind: 'gridNo', gridNo: ENDGAME_TILE }]);
  });

  it('centres only the located merc outside a story flow, and moves nothing with no entry', () => {
    expect(entryCamera(viewIn('tactical'), { scene: null, located: MERC })).toEqual([mercCentred]);
    expect(entryCamera(viewIn('tactical'), null)).toEqual([]);
  });
});
