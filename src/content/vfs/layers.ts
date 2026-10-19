export const PROJECT_DATA_LAYER = 'ja2-node-data';
export const STUBS_LAYER = 'stubs';
export const REPOSITORY_LAYERS: readonly string[] = [PROJECT_DATA_LAYER, STUBS_LAYER];

export function isRepositoryLayer(layer: string): boolean {
  return REPOSITORY_LAYERS.includes(layer);
}
