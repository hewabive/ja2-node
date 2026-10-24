import { Meanwhile } from '../sim/strategic/ai/constants.ts';
import { meanwhileSceneName } from '../sim/strategic/ai/meanwhile.ts';

export const INTERROGATION_SCENE = meanwhileSceneName(Meanwhile.INTERROGATION);

const SCENE_IDS: ReadonlyMap<string, number> = new Map(Object.values(Meanwhile).map((id) => [meanwhileSceneName(id), id]));

export function meanwhileSceneId(scene: string): number | null {
  return SCENE_IDS.get(scene) ?? null;
}
