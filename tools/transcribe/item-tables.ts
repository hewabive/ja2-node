import { join } from 'node:path';
import { REPO_ROOT } from '../../src/node/repo.ts';
import { bracedBody, readSource, STRACCIATELLA_COMMIT, stripCComments, writeTable } from './c-source.ts';

const items = stripCComments(readSource('game/Tactical/Items.cc'));

function rows(declaration: string): string[][] {
  const body = bracedBody(items, declaration);
  return [...body.matchAll(/\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)].map((m) =>
    (m[1] as string)
      .replace(/[{}]/g, ',')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

const attachmentInfo = rows('static const AttachmentInfoStruct AttachmentInfo[]').map(([item, itemClass, check, mod]) => ({
  item,
  itemClass,
  check,
  mod: Number((mod ?? '0').replace('+', '')),
}));

const attachments = Object.fromEntries(
  [...bracedBody(items, 'g_attachments').matchAll(/\{\s*(\w+)\s*,\s*\{([^}]*)\}\s*\}/g)].map((m) => [
    m[1] as string,
    (m[2] as string).split(',').map((s) => s.trim()),
  ]),
);

const compatibleFaceItems = rows('CompatibleFaceItems');

const merges = rows('static MergeInfo const Merge[]').map(([item1, item2, result, action]) => ({ item1, item2, result, action }));

const comboMerges = rows('static ComboMergeInfoStruct const AttachmentComboMerge[]').map(([item, a1, a2, result]) => ({
  item,
  attachments: [a1, a2],
  result,
}));

const armourModel = stripCComments(readSource('externalized/ArmourModel.cc'));
const platesCanBeAttached = bracedBody(armourModel, 'platesCanBeAttached')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const out = {
  source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: src/game/Tactical/Items.cc AttachmentInfo, g_attachments, CompatibleFaceItems, Merge, AttachmentComboMerge; src/externalized/ArmourModel.cc platesCanBeAttached`,
  license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
  format: 'item names are ITEMDEFINE / internalName values; NOTHING is item 0',
  attachmentInfo,
  attachments,
  compatibleFaceItems,
  merges,
  comboMerges,
  platesCanBeAttached,
};
const target = join(REPO_ROOT, 'data/tables/item-tables.json');
writeTable(target, out);
console.log(
  `${platesCanBeAttached.length} plate vests, ${attachmentInfo.length} attachment infos, ${Object.keys(attachments).length} attachment hosts, ${compatibleFaceItems.length} face pairs, ${merges.length} merges, ${comboMerges.length} combo merges → ${target}`,
);
