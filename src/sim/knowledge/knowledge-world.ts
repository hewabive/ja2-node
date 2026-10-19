import type { TacticalWorld } from '../../content/world/tactical-world.ts';
import type { TacticalContent } from '../tactical/content.ts';
import { type Soldier, Team } from '../tactical/soldier.ts';
import type { TacticalState } from '../tactical/state.ts';
import type { GuardOptions } from './guard.ts';
import { type StrategicKnowledge, type StrategicRules, strategicKnowledge } from './strategic.ts';
import { TacticalProjection } from './tactical.ts';
import type { KnowledgeSoldier, KnowledgeView } from './view.ts';

const MAX_CACHED_MAPS = 2;

export interface KnowledgeWorlds {
  world(mapPath: string): TacticalWorld | null;
}

export class ProjectionCache {
  readonly #content: TacticalContent;
  readonly #worlds: KnowledgeWorlds;
  readonly #projections: TacticalProjection[] = [];

  constructor(content: TacticalContent, worlds: KnowledgeWorlds) {
    this.#content = content;
    this.#worlds = worlds;
  }

  projection(mapPath: string): TacticalProjection | null {
    const at = this.#projections.findIndex((p) => p.mapPath === mapPath);
    if (at >= 0) {
      const [hit] = this.#projections.splice(at, 1);
      if (hit) this.#projections.unshift(hit);
      return hit ?? null;
    }
    const world = this.#worlds.world(mapPath);
    if (!world) return null;
    const made = new TacticalProjection(world, this.#content);
    this.#projections.unshift(made);
    this.#projections.length = Math.min(this.#projections.length, MAX_CACHED_MAPS);
    return made;
  }
}

export interface KnowledgeRules {
  readonly content: TacticalContent | null;
  readonly projections: ProjectionCache | null;
  readonly strategic: StrategicRules | null;
}

export function knowledgeRules(
  content: TacticalContent | null,
  worlds: KnowledgeWorlds,
  strategic: StrategicRules | null = null,
): KnowledgeRules {
  return { content, projections: content ? new ProjectionCache(content, worlds) : null, strategic };
}

export interface KnowledgeOptions {
  readonly strict?: boolean;
}

export interface TacticalKnowledge {
  readonly state: TacticalState;
  readonly mapPath: string;
  soldier(id: number): Soldier | null;
  ownSoldier(id: number): Soldier | null;
  soldierView(id: number): KnowledgeSoldier | null;
}

export interface KnowledgeWorld {
  readonly view: KnowledgeView;
  readonly rules: KnowledgeRules;
  readonly guard: GuardOptions;
  readonly tactical: TacticalKnowledge | null;
  readonly strategic: StrategicKnowledge | null;
}

function tacticalKnowledge(view: KnowledgeView, rules: KnowledgeRules, guard: GuardOptions): TacticalKnowledge | null {
  if (!view.mapPath || !rules.projections) return null;
  const projection = rules.projections.projection(view.mapPath);
  if (!projection) return null;
  const state = projection.sync(view, guard);
  const views = new Map(view.soldiers.map((s) => [s.id, s]));
  const soldier = (id: number) => (views.has(id) ? (state.soldiers[id] ?? null) : null);
  return {
    state,
    mapPath: view.mapPath,
    soldier,
    ownSoldier: (id) => (views.get(id)?.team === Team.OUR ? soldier(id) : null),
    soldierView: (id) => views.get(id) ?? null,
  };
}

export function knowledgeWorld(view: KnowledgeView, rules: KnowledgeRules, options: KnowledgeOptions = {}): KnowledgeWorld {
  const guard: GuardOptions = { strict: options.strict ?? false };
  return {
    view,
    rules,
    guard,
    tactical: tacticalKnowledge(view, rules, guard),
    strategic: strategicKnowledge(view, rules.strategic, guard),
  };
}
