import type { CommandResult } from '../command.ts';
import type { KnowledgeWorld } from '../knowledge/knowledge-world.ts';
import { assignmentOptions } from './assignment-options.ts';
import { canEnterSector } from './can-enter-sector.ts';
import { estimateAttack } from './estimate-attack.ts';
import { exitSectorDryRun, exitSectorOptions } from './exit-sector.ts';
import { itemInfo } from './item-info.ts';
import { moveBoxOptions } from './move-box-options.ts';
import { placements } from './placements.ts';
import { previewAction } from './preview-action.ts';
import { previewHeliRoute } from './preview-heli-route.ts';
import { previewMove } from './preview-move.ts';
import { previewRoute } from './preview-route.ts';
import { type HintKind, type HintRequestBase, isHintKind, refuseHint } from './types.ts';

type HintAnswerer = (world: KnowledgeWorld, req: HintRequestBase) => CommandResult;

const ANSWERERS: Readonly<Partial<Record<HintKind, HintAnswerer>>> = {
  previewMove,
  estimateAttack,
  previewAction,
  placements,
  itemInfo,
  previewRoute,
  previewHeliRoute,
  canEnterSector,
  assignmentOptions,
  moveBoxOptions,
  exitSector: exitSectorDryRun,
  exitSectorOptions,
};

export function answerHint(world: KnowledgeWorld, req: HintRequestBase): CommandResult {
  if (!isHintKind(req.type)) return refuseHint('unknownHint', `unknown hint ${req.type}`);
  const answer = ANSWERERS[req.type];
  if (!answer) return refuseHint('notSupported', `${req.type} is not supported yet`);
  return answer(world, req);
}
