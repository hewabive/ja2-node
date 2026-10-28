// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-16. See LICENSE (SFI-SCLA).
// @src src/externalized/content/NpcActionParamsModel.cc deserialize, getGridNo, getAmount; DefaultContentManager.cc
// @src getNpcActionParams.

import { asArray, asInt, asObject } from './json-fields.ts';

export const NPC_ACTION_PARAMS_PATH = 'externalized/tactical-npc-action-params.json';

export interface NpcActionParam {
  readonly gridNo?: number;
  readonly amount?: number;
}

export type NpcActionParamTable = ReadonlyMap<number, NpcActionParam>;

export function parseNpcActionParams(json: unknown): NpcActionParamTable {
  const table = new Map<number, NpcActionParam>();
  asArray(json, 'npc action params').forEach((v, i) => {
    const what = `npc action params[${i}]`;
    const o = asObject(v, what);
    const code = asInt(o.actionCode, `${what}.actionCode`);
    table.set(code, {
      ...(o.gridNo !== undefined ? { gridNo: asInt(o.gridNo, `${what}.gridNo`) } : {}),
      ...(o.amount !== undefined ? { amount: asInt(o.amount, `${what}.amount`) } : {}),
    });
  });
  return table;
}
