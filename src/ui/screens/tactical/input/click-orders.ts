import type { CommandEnvelope } from '../../../../protocol/messages.ts';
import type { PlayerView } from '../../../../protocol/view.ts';
import { inCombat } from '../soldiers.ts';

export function clickOrder(cmd: CommandEnvelope, shown: PlayerView | null): CommandEnvelope {
  return inCombat(shown) ? cmd : { ...cmd, realTime: true };
}
