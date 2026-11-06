import type { Observation } from './mcp-game.ts';
import type { Player } from './player.ts';

const MODE_BUDGET_TICKS = 20_000;
const THE_ENDING_FRAME = 1;

export function autoBandageQuestion(view: Observation): string | null {
  return view.prompt?.kind === 'beginAutoBandage' ? view.prompt.id : null;
}

export async function finishAutoBandage(p: Player): Promise<void> {
  const done = await p.advance({ idle: true, ticks: MODE_BUDGET_TICKS });
  const ended = await p.act({ type: 'endAutoBandage' });
  if (!ended.ok) return;
  const end = await p.advance({ ticks: THE_ENDING_FRAME });
  const report = end.events.find((e) => e.type === 'autoBandageEnded');
  p.log(`  auto-bandage ${done.reason === 'idle' ? 'complete' : done.reason}, ${String(report?.worldSecondsWarped ?? '?')} s warped`);
}

export async function autoBandage(p: Player, prompt: string): Promise<void> {
  const answered = await p.act({ type: 'answer', prompt, choice: 'yes' });
  if (!answered.ok) throw new Error(`the beginAutoBandage prompt refused yes: ${answered.reason ?? ''}`);
  p.log('  answered beginAutoBandage: yes');
  await finishAutoBandage(p);
}
