import { MovementCosts } from '../../content/world/movement-costs.ts';
import { WorldStructures, type WorldStructuresSnapshot } from '../../content/world/structures.ts';
import type { TacticalWorld } from '../../content/world/tactical-world.ts';
import { PreRandom, Rng, type RngState } from '../../core/rng.ts';
import { cachedLightTemplateName, lightTemplate } from '../tactical/lighting/templates.ts';
import { type ClassCodec, SnapshotError } from './codec.ts';
import { type ContentIndex, type ContentRoots, contentIndex, type OpaqueKeys } from './refs.ts';

const LIGHT_TEMPLATE_PREFIX = 'light/';
const WORLD_ROOT_PREFIX = 'world.';
const RESERVED_ROOTS: ReadonlySet<string> = new Set(['light']);

interface PreRandomPayload {
  readonly index: number;
  readonly refill: Rng;
  readonly ring: Uint32Array;
}

export const STREAM_CODECS: readonly ClassCodec[] = [
  {
    tag: '$rng',
    matches: (v) => v instanceof Rng,
    payload: (v) => [...(v as Rng).state().s],
    revive: (p) => Rng.fromState({ s: p as RngState['s'] }),
  },
  {
    tag: '$pre',
    matches: (v) => v instanceof PreRandom,
    payload: (v): PreRandomPayload => {
      const pre = v as PreRandom;
      const state = pre.state();
      return { index: state.index, refill: pre.refillStream(), ring: Uint32Array.from(state.ring) };
    },
    revive: (p) => {
      const { index, refill, ring } = p as PreRandomPayload;
      return PreRandom.fromState({ ring: Array.from(ring), index }, refill);
    },
  },
];

export const WORLD_CODECS: readonly ClassCodec[] = [
  {
    tag: '$structures',
    matches: (v) => v instanceof WorldStructures,
    payload: (v) => (v as WorldStructures).toSnapshot(),
    revive: (p) => WorldStructures.fromSnapshot(p as WorldStructuresSnapshot),
  },
  {
    tag: '$costs',
    matches: (v) => v instanceof MovementCosts,
    payload: (v) => (v as MovementCosts).toSnapshot(),
    revive: (p) => MovementCosts.fromSnapshot(p as Uint8Array),
  },
];

export const SNAPSHOT_CODECS: readonly ClassCodec[] = [...STREAM_CODECS, ...WORLD_CODECS];

const WORLD_OPAQUE: OpaqueKeys = { 'world.map': ['doors'] };

function worldRoots(world: TacticalWorld | null): ContentRoots {
  if (!world) return {};
  return {
    'world.map': world.map,
    'world.tables': world.tables,
    'world.tiles': world.tiles,
    'world.level': world.level,
    'world.terrain': world.terrain,
    'world.doorCosts': world.doorCosts,
  };
}

export interface ExternalSources {
  external(value: object): string | null;
  resolve(key: string): object;
}

function checkRootNames(content: ContentRoots): void {
  for (const name of Object.keys(content)) {
    if (RESERVED_ROOTS.has(name) || name.startsWith(WORLD_ROOT_PREFIX))
      throw new SnapshotError(`the content root name ${name} is reserved`);
  }
}

export function externalSources(content: ContentRoots, world: TacticalWorld | null): ExternalSources {
  checkRootNames(content);
  const shared: ContentIndex = contentIndex(content);
  const loaded: ContentIndex = contentIndex(worldRoots(world), WORLD_OPAQUE);
  return {
    external(value) {
      const key = shared.keyOf(value) ?? loaded.keyOf(value);
      if (key !== null) return key;
      const light = cachedLightTemplateName(value);
      return light === null ? null : LIGHT_TEMPLATE_PREFIX + light;
    },
    resolve(key) {
      if (key.startsWith(WORLD_ROOT_PREFIX)) return loaded.resolve(key);
      if (!key.startsWith(LIGHT_TEMPLATE_PREFIX)) return shared.resolve(key);
      const template = lightTemplate(key.slice(LIGHT_TEMPLATE_PREFIX.length));
      if (!template) throw new SnapshotError(`unknown light template ${key}`);
      return template;
    },
  };
}
