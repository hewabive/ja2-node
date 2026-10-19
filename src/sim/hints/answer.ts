import type { CommandResult } from '../command.ts';
import type { KnowledgeWorld } from '../knowledge/knowledge-world.ts';
import { estimateAttack } from './estimate-attack.ts';
import { itemInfo } from './item-info.ts';
import { placements } from './placements.ts';
import { previewAction } from './preview-action.ts';
import { previewMove } from './preview-move.ts';
import { type HintKind, type HintRequestBase, isHintKind, refuseHint } from './types.ts';

type HintAnswerer = (world: KnowledgeWorld, req: HintRequestBase) => CommandResult;

const ANSWERERS: Readonly<Partial<Record<HintKind, HintAnswerer>>> = {
  previewMove,
  estimateAttack,
  previewAction,
  placements,
  itemInfo,
};

export function answerHint(world: KnowledgeWorld, req: HintRequestBase): CommandResult {
  if (!isHintKind(req.type)) return refuseHint('unknownHint', `unknown hint ${req.type}`);
  const answer = ANSWERERS[req.type];
  if (!answer) return refuseHint('notSupported', `${req.type} is not supported yet`);
  return answer(world, req);
}
