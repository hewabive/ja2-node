import {
  buildTacticalWorldFromInputs,
  loadTacticalWorldInputs,
  type TacticalWorld,
  type TacticalWorldInputs,
} from '../content/world/tactical-world.ts';
import type { ReadFile } from '../content/world/tileset-loader.ts';
import type { CommandEnvelope } from '../protocol/messages.ts';
import type { PlayerView } from '../protocol/view.ts';
import type { CommandResult } from '../sim/command.ts';
import { answerHint } from '../sim/hints/answer.ts';
import { isHintKind, isServerQueryKind, refuseHint } from '../sim/hints/types.ts';
import { type KnowledgeRules, knowledgeRules, knowledgeWorld } from '../sim/knowledge/knowledge-world.ts';
import type { TacticalContent } from '../sim/tactical/content.ts';
import type { FileExists } from './world-cache.ts';

const MAX_CACHED_INPUTS = 2;

export interface QueryAnswer extends CommandResult {
  readonly tick: number;
}

export interface QuerySubject {
  view(): PlayerView;
  readonly tick: number;
  dispatch(cmd: CommandEnvelope): CommandResult;
  tacticalContent?(): TacticalContent | null;
}

export function isQueryCommand(cmd: CommandEnvelope): boolean {
  if (cmd.type === 'exitSector') return cmd.dryRun === true;
  return isHintKind(cmd.type) || isServerQueryKind(cmd.type);
}

class ProjectionWorlds {
  readonly #read: ReadFile;
  readonly #exists: FileExists;
  readonly #inputs: { readonly path: string; readonly inputs: TacticalWorldInputs }[] = [];

  constructor(read: ReadFile, exists: FileExists) {
    this.#read = read;
    this.#exists = exists;
  }

  async prepare(path: string | null): Promise<void> {
    if (!path || this.#inputs.some((i) => i.path === path) || !this.#exists(path)) return;
    const inputs = await loadTacticalWorldInputs(this.#read, path);
    if (this.#inputs.some((i) => i.path === path)) return;
    this.#inputs.unshift({ path, inputs });
    this.#inputs.length = Math.min(this.#inputs.length, MAX_CACHED_INPUTS);
  }

  world(path: string): TacticalWorld | null {
    const hit = this.#inputs.find((i) => i.path === path);
    return hit ? buildTacticalWorldFromInputs(hit.inputs) : null;
  }
}

export class QueryService {
  readonly #worlds: ProjectionWorlds;
  readonly #rules = new WeakMap<TacticalContent, KnowledgeRules>();

  constructor(read: ReadFile, exists: FileExists) {
    this.#worlds = new ProjectionWorlds(read, exists);
  }

  #rulesFor(content: TacticalContent): KnowledgeRules {
    let rules = this.#rules.get(content);
    if (!rules) {
      rules = knowledgeRules(content, this.#worlds);
      this.#rules.set(content, rules);
    }
    return rules;
  }

  async prepare(subject: QuerySubject): Promise<void> {
    await this.#worlds.prepare(subject.view().mapPath);
  }

  answer(subject: QuerySubject, q: CommandEnvelope): QueryAnswer {
    const view = subject.view();
    const tick = view.tick;
    if (isServerQueryKind(q.type)) return { ...subject.dispatch(q), tick };
    if (!isQueryCommand(q)) return { ...refuseHint('notAQuery', `${q.type} is not a query`), tick };
    const content = subject.tacticalContent?.() ?? null;
    if (!content) return { ...refuseHint('noSector', 'no sector is loaded'), tick };
    const world = knowledgeWorld(view, this.#rulesFor(content));
    return { ...answerHint(world, q), tick };
  }
}
