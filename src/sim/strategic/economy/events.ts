import type { EconomyPrompt } from './state.ts';

export type EconomyEvent =
  | { readonly type: 'assignmentDone'; readonly soldier: number; readonly sayQuote: boolean }
  | { readonly type: 'assignmentAborted'; readonly soldier: number; readonly reason: AbortReason }
  | { readonly type: 'fellAsleep'; readonly soldier: number; readonly collapsed: boolean }
  | { readonly type: 'wokeUp'; readonly soldier: number }
  | { readonly type: 'tiredComplaint'; readonly soldier: number }
  | { readonly type: 'itemRepaired'; readonly repairer: number; readonly owner: number; readonly item: number }
  | { readonly type: 'gunUnjammed'; readonly repairer: number; readonly owner: number; readonly item: number }
  | { readonly type: 'militiaTrained'; readonly sector: number; readonly trained: number }
  | { readonly type: 'militiaPromoted'; readonly greenToRegular: number; readonly regularToElite: number; readonly greenToElite: number }
  | { readonly type: 'militiaDefected'; readonly sector: number; readonly removed: number }
  | { readonly type: 'loyaltyChanged'; readonly town: number; readonly rating: number }
  | { readonly type: 'mineIncome'; readonly amount: number }
  | { readonly type: 'mineRunningOut'; readonly mine: number }
  | { readonly type: 'mineEmpty'; readonly mine: number }
  | { readonly type: 'mineShutDown'; readonly mine: number }
  | { readonly type: 'mineReopened'; readonly mine: number }
  | { readonly type: 'headMinerQuote'; readonly mine: number; readonly profile: number; readonly quote: number }
  | { readonly type: 'moneyChanged'; readonly code: number; readonly amount: number; readonly balance: number }
  | { readonly type: 'militiaPrompt'; readonly prompt: EconomyPrompt }
  | { readonly type: 'militiaTrainingRejected'; readonly soldiers: readonly number[]; readonly reason: RejectReason };

export type AbortReason = 'noMedkits' | 'insufficientDoctorSkill' | 'noToolkits' | 'insufficientRepairSkill';
export type RejectReason = 'declined' | 'cannotAfford' | 'loyaltyTooLow' | 'militiaFull';
