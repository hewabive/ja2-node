import { type AnimationTables, stateId } from '../../content/anim/tables.ts';
import type { TacticalContent } from './content.ts';

const cache = new WeakMap<AnimationTables, Map<string, number>>();

export function anim(content: TacticalContent, name: string): number {
  let byName = cache.get(content.animations);
  if (!byName) {
    byName = new Map();
    cache.set(content.animations, byName);
  }
  let id = byName.get(name);
  if (id === undefined) {
    id = stateId(content.animations, name);
    byName.set(name, id);
  }
  return id;
}

export function animName(content: TacticalContent, state: number): string {
  return content.animations.controls[state]?.id ?? '';
}
