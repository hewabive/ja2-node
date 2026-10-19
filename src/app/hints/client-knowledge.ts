import type { RuleReader } from '../../content/rules/rule-reader.ts';
import {
  buildTacticalWorldFromInputs,
  loadTacticalWorldInputs,
  type TacticalWorld,
  type TacticalWorldInputs,
} from '../../content/world/tactical-world.ts';
import type { EngineIdentityView, WelcomeIdentity } from '../../protocol/messages.ts';
import { type KnowledgeRules, knowledgeRules } from '../../sim/knowledge/knowledge-world.ts';
import type { StrategicRules } from '../../sim/knowledge/strategic.ts';
import type { TacticalContent } from '../../sim/tactical/content.ts';
import { loadTacticalContent } from '../../sim/tactical/load-content.ts';
import type { AssetSource } from '../assets/asset-source.ts';
import { loadClientRules, type RulesCheck } from '../rules/client-rules.ts';
import { clientEngineIdentity, sameEngine } from './engine.ts';

const MAX_CACHED_MAPS = 2;

export interface KnowledgeCheck {
  readonly engine: { readonly expected: EngineIdentityView; readonly actual: EngineIdentityView; readonly matches: boolean };
  readonly rules: RulesCheck;
}

export function knowledgeUsable(check: KnowledgeCheck): boolean {
  return check.engine.matches && check.rules.packMatches && check.rules.scriptsMatch;
}

export type StrategicRulesLoader = (reader: RuleReader) => Promise<StrategicRules | null>;

export class ClientWorlds {
  readonly #reader: RuleReader;
  readonly #inputs: { readonly path: string; readonly inputs: TacticalWorldInputs }[] = [];
  readonly #loading = new Map<string, Promise<void>>();
  readonly failures = new Map<string, string>();

  constructor(reader: RuleReader) {
    this.#reader = reader;
  }

  has(path: string): boolean {
    return this.#inputs.some((i) => i.path === path);
  }

  ensure(path: string): Promise<void> {
    if (this.has(path) || this.failures.has(path)) return Promise.resolve();
    let pending = this.#loading.get(path);
    if (!pending) {
      pending = loadTacticalWorldInputs(this.#reader.read, path).then(
        (inputs) => {
          this.#loading.delete(path);
          this.#inputs.unshift({ path, inputs });
          this.#inputs.length = Math.min(this.#inputs.length, MAX_CACHED_MAPS);
        },
        (err: unknown) => {
          this.#loading.delete(path);
          this.failures.set(path, err instanceof Error ? err.message : String(err));
        },
      );
      this.#loading.set(path, pending);
    }
    return pending;
  }

  world(path: string): TacticalWorld | null {
    const hit = this.#inputs.find((i) => i.path === path);
    return hit ? buildTacticalWorldFromInputs(hit.inputs) : null;
  }
}

export class ClientKnowledge {
  readonly check: KnowledgeCheck;
  readonly content: TacticalContent;
  readonly worlds: ClientWorlds;
  readonly rules: KnowledgeRules;

  private constructor(check: KnowledgeCheck, content: TacticalContent, worlds: ClientWorlds, strategic: StrategicRules | null) {
    this.check = check;
    this.content = content;
    this.worlds = worlds;
    this.rules = knowledgeRules(content, worlds, strategic);
  }

  get usable(): boolean {
    return knowledgeUsable(this.check);
  }

  static async open(
    source: AssetSource,
    identity: WelcomeIdentity,
    strategic: StrategicRulesLoader = async () => null,
    engine: EngineIdentityView = clientEngineIdentity(),
  ): Promise<ClientKnowledge> {
    const reader = await loadClientRules(source, identity.rules);
    const check: KnowledgeCheck = {
      engine: { expected: identity.engine, actual: engine, matches: sameEngine(engine, identity.engine) },
      rules: reader.check,
    };
    const [content, strategicRules] = await Promise.all([loadTacticalContent(reader.read), strategic(reader)]);
    return new ClientKnowledge(check, content, new ClientWorlds(reader), strategicRules);
  }
}
