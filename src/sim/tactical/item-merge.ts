// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-18. See LICENSE (SFI-SCLA).
// @src src/game/Tactical/Items.cc AttachObject (the in-game attachment with its skill check and the merges),
// @src EvaluateValidMerge, ValidMerge, GetAttachmentInfo. See docs/12 §2.

import { ItemClass, type ItemTable, NOTHING } from '../../content/items/items.ts';
import {
  attachmentPosition,
  attachObject,
  canAttachAsAttachment,
  damageObject,
  deleteObject,
  type ItemObject,
  NO_ATTACHMENT_POSITION,
} from '../items/object.ts';
import type { CombatContext } from './combat/context.ts';
import { StatCause, statChange } from './combat/experience.ts';
import { SkillCheckReason, skillCheck } from './combat/skill-check.ts';
import { AP, deductPoints, enoughPoints } from './points.ts';
import { StatKind } from './profiles.ts';
import type { Soldier } from './soldier.ts';

export const MergeAction = {
  COMBINE_POINTS: 'COMBINE_POINTS',
  TREAT_ARMOUR: 'TREAT_ARMOUR',
  DESTRUCTION: 'DESTRUCTION',
  ELECTRONIC_MERGE: 'ELECTRONIC_MERGE',
  EXPLOSIVE: 'EXPLOSIVE',
} as const;

export interface MergeOutcome {
  readonly result: number;
  readonly action: string;
}

export type AttachResult = 'attached' | 'merged' | 'destroyed' | 'failedCheck' | 'noAPs' | 'impossible';

const SKILL_CHECKS: Readonly<Record<string, number>> = {
  ATTACHING_SPECIAL_ITEM_CHECK: SkillCheckReason.ATTACHING_SPECIAL_ITEM,
  ATTACHING_SPECIAL_ELECTRONIC_ITEM_CHECK: SkillCheckReason.ATTACHING_SPECIAL_ELECTRONIC_ITEM,
  ATTACHING_DETONATOR_CHECK: SkillCheckReason.ATTACHING_DETONATOR,
  ATTACHING_REMOTE_DETONATOR_CHECK: SkillCheckReason.ATTACHING_REMOTE_DETONATOR,
};

const MERGE_CHECK_MODIFIER = -30;
const COMBO_MERGE_EXPERIENCE = 20;
const EXPLOSIVE_MERGE_EXPERIENCE = 25;
const FULL_POINTS = 100;

export function evaluateValidMerge(items: ItemTable, merge: number, item: number): MergeOutcome | null {
  if (merge === item && items.byIndex.get(item)?.itemClass === ItemClass.AMMO) return { result: item, action: MergeAction.COMBINE_POINTS };
  return items.rules.merges.get(`${merge}:${item}`) ?? null;
}

export function validMerge(items: ItemTable, merge: number, item: number): boolean {
  return evaluateValidMerge(items, merge, item) !== null;
}

function failCheck(target: ItemObject, attachment: ItemObject, margin: number): AttachResult {
  damageObject(target, -margin);
  damageObject(attachment, -margin);
  return 'failedCheck';
}

function attachAsAttachment(t: CombatContext, s: Soldier, target: ItemObject, attachment: ItemObject): AttachResult {
  const items = t.content.items;
  const info = items.rules.attachmentInfo.get(attachment.item);
  const reason = info ? SKILL_CHECKS[info.check] : undefined;
  if (info && reason !== undefined) {
    const margin = skillCheck(t, s, reason, info.mod);
    if (margin < 0) return failCheck(target, attachment, margin);
  }
  const before = target.item;
  if (!attachObject(items, target, attachment)) return 'impossible';
  if (target.item !== before && info && info.mod < COMBO_MERGE_EXPERIENCE)
    statChange(t, s, StatKind.MECHANICAL, COMBO_MERGE_EXPERIENCE - info.mod, StatCause.SUCCESS);
  return 'attached';
}

function combinePoints(items: ItemTable, target: ItemObject, attachment: ItemObject, indexInStack: number): void {
  const def = items.byIndex.get(target.item);
  const limit = def?.itemClass === ItemClass.AMMO ? (def.magazine?.capacity ?? 0) : FULL_POINTS;
  for (let k = attachment.count - 1; k >= 0; k--) {
    const into = target.status[indexInStack] ?? 0;
    const from = attachment.status[k] ?? 0;
    if (into + from <= limit) {
      target.status[indexInStack] = into + from;
      removeObjectFrom(attachment, k);
      k = attachment.count;
    } else {
      attachment.status[k] = from - (limit - into);
      target.status[indexInStack] = limit;
      break;
    }
  }
}

function removeObjectFrom(o: ItemObject, index: number): void {
  if (o.count === 1) {
    deleteObject(o);
    return;
  }
  for (let k = index + 1; k < o.count; k++) o.status[k - 1] = o.status[k] ?? 0;
  o.status[o.count - 1] = 0;
  o.count--;
}

function defaultMerge(target: ItemObject, attachment: ItemObject, merge: MergeOutcome): void {
  target.item = merge.result;
  if (merge.action !== MergeAction.TREAT_ARMOUR) target.status[0] = Math.trunc(((target.status[0] ?? 0) + (attachment.status[0] ?? 0)) / 2);
  deleteObject(attachment);
}

function mergeObjects(
  t: CombatContext,
  s: Soldier,
  target: ItemObject,
  attachment: ItemObject,
  indexInStack: number,
  merge: MergeOutcome,
): AttachResult {
  const items = t.content.items;
  if (merge.action !== MergeAction.COMBINE_POINTS) {
    if (!enoughPoints(t.inCombat, s, AP.MERGE)) return 'noAPs';
    deductPoints(t.inCombat, s, AP.MERGE, 0);
  }
  switch (merge.action) {
    case MergeAction.COMBINE_POINTS:
      combinePoints(items, target, attachment, indexInStack);
      return 'merged';
    case MergeAction.DESTRUCTION:
      deleteObject(target);
      deleteObject(attachment);
      return 'destroyed';
    case MergeAction.ELECTRONIC_MERGE: {
      const margin = skillCheck(t, s, SkillCheckReason.ATTACHING_SPECIAL_ELECTRONIC_ITEM, MERGE_CHECK_MODIFIER);
      if (margin < 0) return failCheck(target, attachment, margin);
      break;
    }
    case MergeAction.EXPLOSIVE: {
      const margin = skillCheck(t, s, SkillCheckReason.ATTACHING_DETONATOR, MERGE_CHECK_MODIFIER);
      if (margin < 0) return failCheck(target, attachment, margin);
      statChange(t, s, StatKind.EXPLOSIVES, EXPLOSIVE_MERGE_EXPERIENCE, StatCause.SUCCESS);
      break;
    }
  }
  defaultMerge(target, attachment, merge);
  return 'merged';
}

export function soldierAttachObject(
  t: CombatContext,
  s: Soldier,
  target: ItemObject,
  attachment: ItemObject,
  indexInStack: number,
): AttachResult {
  const items = t.content.items;
  if (target.item === NOTHING || attachment.item === NOTHING) return 'impossible';
  if (canAttachAsAttachment(items, target, attachment.item)) {
    if (attachmentPosition(items, target, attachment) === NO_ATTACHMENT_POSITION) return 'impossible';
    return attachAsAttachment(t, s, target, attachment);
  }
  const merge = evaluateValidMerge(items, attachment.item, target.item);
  if (!merge) return 'impossible';
  return mergeObjects(t, s, target, attachment, indexInStack, merge);
}

export function attachSucceeded(result: AttachResult): boolean {
  return result === 'attached' || result === 'merged' || result === 'destroyed';
}
