import type { ActResult, Command } from './mcp-game.ts';
import type { Player } from './player.ts';
import { answerPrompts } from './prompts.ts';

const ANSWER_FIRST: ReadonlySet<string> = new Set(['promptOpen', 'battlePending', 'renewalSequence']);
const ADVANCE_FIRST: ReadonlySet<string> = new Set(['dialogueQueued', 'meanwhileStarting', 'pauseLocked']);
const REST_FIRST: ReadonlySet<string> = new Set(['tooInjured', 'tooTired']);
const RETRIES = 4;

export function refusalOf(result: ActResult): string | null {
  const token = result.data?.refusal;
  return typeof token === 'string' ? token : null;
}

export function needsRest(result: ActResult): boolean {
  const refusal = refusalOf(result);
  return refusal !== null && REST_FIRST.has(refusal);
}

function namesTheNextStep(refusal: string | null): refusal is string {
  return refusal !== null && (ANSWER_FIRST.has(refusal) || ADVANCE_FIRST.has(refusal));
}

async function advanceUntilIdle(p: Player): Promise<void> {
  if ((await p.observe()).strategic?.flow === 'strategic') await p.act({ type: 'stopTime' });
  await p.advance({ idle: true });
}

async function takeTheNextStep(p: Player, refusal: string): Promise<void> {
  if (ANSWER_FIRST.has(refusal) && (await answerPrompts(p, await p.observe()))) return;
  await advanceUntilIdle(p);
}

export async function actAnswering(p: Player, command: Command): Promise<ActResult> {
  let result = await p.act(command);
  for (let retry = 0; !result.ok && retry < RETRIES; retry++) {
    const refusal = refusalOf(result);
    if (!namesTheNextStep(refusal)) break;
    p.log(`  ${command.type} refused (${refusal}): taking the step it names first`);
    await takeTheNextStep(p, refusal);
    result = await p.act(command);
  }
  return result;
}
