import type { ContractPromptView, NpcRequestPromptView, PromptView } from '../../src/protocol/view.ts';
import type { Observation } from './mcp-game.ts';
import type { Player } from './player.ts';

export interface PromptPolicy {
  preBattle(prompt: Extract<PromptView, { kind: 'preBattle' }>): readonly string[];
  npcRequest(prompt: NpcRequestPromptView): readonly string[];
  renew(prompt: Extract<ContractPromptView, { kind: 'contractRenewal' }>): readonly string[];
}

export const DEFAULT_POLICY: PromptPolicy = {
  preBattle: () => ['enterSector', 'autoresolve', 'retreat'],
  npcRequest: (prompt) => (prompt.request === 'escort' ? ['yes'] : ['no']),
  renew: () => ['week', 'day', 'twoWeeks', 'letGo', 'dismiss'],
};

let policy: PromptPolicy = DEFAULT_POLICY;

export function setPromptPolicy(next: PromptPolicy): void {
  policy = next;
}

function battleChoices(prompt: PromptView, balance: number): readonly string[] {
  switch (prompt.kind) {
    case 'preBattle': {
      const enabled = new Set(prompt.options.filter((o) => o.enabled).map((o) => o.choice));
      return policy.preBattle(prompt).filter((c) => enabled.has(c));
    }
    case 'surrender':
      return ['reject'];
    case 'autoresolveDone':
      return ['done'];
    case 'simultaneousArrival':
      return ['coordinate', 'separately'];
    case 'npcOfNote':
      return ['continue', 'ok'];
    case 'militiaPayment':
    case 'militiaContinue':
      return prompt.cost <= balance ? ['yes', 'no'] : ['no'];
  }
}

function contractChoices(prompt: ContractPromptView): readonly string[] {
  switch (prompt.kind) {
    case 'contractRenewal': {
      const enabled = new Set(prompt.options.filter((o) => o.enabled).map((o) => o.choice));
      return policy.renew(prompt).filter((c) => enabled.has(c));
    }
    case 'mercDeparture':
      return ['here', ...prompt.choices];
    case 'insuranceExtension':
      return ['no'];
  }
}

async function answerWith(p: Player, id: string, kind: string, choices: readonly string[]): Promise<boolean> {
  for (const choice of choices) {
    const answered = await p.act({ type: 'answer', prompt: id, choice });
    if (answered.ok) {
      p.log(`  answered ${kind}: ${choice}`);
      return true;
    }
  }
  throw new Error(`no answer accepted for the ${kind} prompt (tried ${choices.join(', ')})`);
}

export async function answerPrompts(p: Player, view: Observation): Promise<boolean> {
  const balance = view.strategic?.balance ?? 0;
  if (view.prompt) return answerWith(p, view.prompt.id, view.prompt.kind, battleChoices(view.prompt, balance));
  if (view.contractPrompt) return answerWith(p, view.contractPrompt.id, view.contractPrompt.kind, contractChoices(view.contractPrompt));
  if (view.npcRequest)
    return answerWith(p, view.npcRequest.id, `npcRequest ${view.npcRequest.request}`, policy.npcRequest(view.npcRequest));
  if (view.conversation) {
    const closed = await p.act({ type: 'closeTalk' });
    if (closed.ok) return true;
  }
  if (view.shop) {
    const closed = await p.act({ type: 'closeShop' });
    if (closed.ok) return true;
  }
  if (view.strategic?.flow === 'autoresolve') {
    await p.advance({ idle: true });
    return true;
  }
  return false;
}
