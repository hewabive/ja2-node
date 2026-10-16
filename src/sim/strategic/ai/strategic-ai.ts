import type { Sector } from '../../../content/strategic/sector-ids.ts';
import { u8 } from '../../../core/int.ts';
import type { Group } from '../forces/groups.ts';
import type { StrategicAiPort, StrategicContext } from '../forces/ports.ts';
import { EventKind } from '../time/constants.ts';
import type { EventDispatch } from '../time/dispatch.ts';
import type { StrategicEvent } from '../time/event-queue.ts';
import { createQueenContext, type QueenContext, type QueenContextOptions } from './context.ts';
import { numStationaryEnemiesInSector } from './counts.ts';
import { checkEnemyControlledSector, okayForEnemyToMoveThroughSector, strategicAILookForAdjacentGroups } from './detection.ts';
import { queenProgress } from './difficulty.ts';
import { evaluateQueenSituation } from './evaluate.ts';
import { initStrategicAI, initStrategicStatus } from './init.ts';
import { handleMeanwhileEvent, handleOutskirtsOfMedunaMeanwhileScene, isMedunaOutskirts } from './meanwhile.ts';
import { removeGroupFromStrategicAILists, repollSAIGroup } from './orders.ts';
import { queenBasementTaken, strategicHandleQueenLosingControlOfSector } from './reactions.ts';

export class StrategicAi implements StrategicAiPort {
  readonly #options: QueenContextOptions;
  #queen: QueenContext | null = null;

  constructor(options: QueenContextOptions) {
    this.#options = options;
  }

  bind(ctx: StrategicContext): QueenContext {
    this.#queen = createQueenContext(ctx, this.#options);
    return this.#queen;
  }

  get context(): QueenContext {
    if (!this.#queen) throw new Error('strategic AI is not bound to a strategic context');
    return this.#queen;
  }

  lookForAdjacentGroups(group: Group): boolean {
    return strategicAILookForAdjacentGroups(this.context, group);
  }

  removeGroupFromLists(group: Group): void {
    removeGroupFromStrategicAILists(this.context, group.id);
  }

  repollGroup(group: Group): void {
    repollSAIGroup(this.context, group);
  }

  progressPercentage(): number {
    return queenProgress(this.context);
  }

  okayForEnemyToMoveThroughSector(sectorId: number): boolean {
    return okayForEnemyToMoveThroughSector(this.context, sectorId);
  }

  numStationaryEnemiesInSector(sector: Sector): number {
    return numStationaryEnemiesInSector(this.context, sector);
  }

  queenLostControlOfSector(sector: Sector): void {
    strategicHandleQueenLosingControlOfSector(this.context, sector);
  }

  queenBasementTaken(): void {
    queenBasementTaken(this.context);
  }

  medunaOutskirtsTaken(sector: Sector): void {
    if (isMedunaOutskirts(sector)) handleOutskirtsOfMedunaMeanwhileScene(this.context);
  }
}

export function initStrategicAiForNewCampaign(q: QueenContext): void {
  initStrategicAI(q);
  initStrategicStatus(q);
}

export function handleEvaluateQueenSituationEvent(q: QueenContext): void {
  evaluateQueenSituation(q);
}

export function handleCheckEnemyControlledSectorEvent(q: QueenContext, e: StrategicEvent): void {
  checkEnemyControlledSector(q, u8(e.param));
}

export function registerStrategicAiEvents<S>(dispatch: EventDispatch<S>, q: QueenContext): void {
  dispatch.register(EventKind.EVALUATE_QUEEN_SITUATION, () => handleEvaluateQueenSituationEvent(q));
  dispatch.register(EventKind.CHECK_ENEMY_CONTROLLED_SECTOR, (_, e) => handleCheckEnemyControlledSectorEvent(q, e));
  dispatch.register(EventKind.MEANWHILE, (_, e) => handleMeanwhileEvent(q, e));
}
