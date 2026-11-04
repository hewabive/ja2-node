import type { SimEventBase } from '../events.ts';

export interface FenceCutEvent extends SimEventBase {
  readonly type: 'fenceCut';
  readonly soldier: number;
  readonly gridNo: number;
}

export interface JarFilledEvent extends SimEventBase {
  readonly type: 'jarFilled';
  readonly soldier: number;
  readonly item: string;
}

export interface CanAttachedEvent extends SimEventBase {
  readonly type: 'canAttached';
  readonly soldier: number;
  readonly gridNo: number;
}

export type TileToolEvent = FenceCutEvent | JarFilledEvent | CanAttachedEvent;
