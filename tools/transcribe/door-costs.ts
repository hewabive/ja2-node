import { join } from 'node:path';
import { REPO_ROOT } from '../../src/node/repo.ts';
import { readSource, STRACCIATELLA_COMMIT, stripCComments, writeTable } from './c-source.ts';

const DIRECTIONS = ['NORTH', 'NORTHEAST', 'EAST', 'SOUTHEAST', 'SOUTH', 'SOUTHWEST', 'WEST', 'NORTHWEST'];
const START = 'else if (pStructure->fFlags & STRUCTURE_ANYDOOR)';
const END = 'else if (pStructure->fFlags & STRUCTURE_WALLSTUFF )';

const pathHeader = readSource('game/Tactical/PathAI.h');
const travelCosts = new Map<string, number>();
for (const m of pathHeader.matchAll(/#define\s+(TRAVELCOST_\w+)\s+(\d+)\b/g)) travelCosts.set(m[1] as string, Number(m[2]));

const worldDef = readSource('game/TileEngine/WorldDef.cc');
const startAt = worldDef.indexOf(START);
const endAt = worldDef.indexOf(END, startAt);
if (startAt < 0 || endAt < 0) throw new Error('door block not found');
const lines = stripCComments(worldDef.slice(startAt + START.length, endAt))
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l.length > 0);

type Kind = 'DDOOR_LEFT' | 'DDOOR_RIGHT' | 'GARAGEDOOR' | 'STANDARD';
type TileCondition = 'any' | 'base' | 'nonBase';

interface Condition {
  kind?: Kind;
  orientation?: string;
  tile?: TileCondition;
  notSliding?: boolean;
  isSwitch?: boolean;
}

interface Rule {
  kind: Kind;
  orientation: string;
  tile: TileCondition;
  notSliding: boolean;
  set: [number, number, number, number][];
}

const stack: Condition[] = [];
let pending: Condition | null = null;
let lastClosed: Condition | null = null;
let caseOrientation: string | null = null;
const rules: Rule[] = [];

function context(): Rule {
  const merged: Condition = {};
  for (const c of stack) Object.assign(merged, c);
  const orientation = caseOrientation ?? merged.orientation;
  if (!merged.kind || !orientation) throw new Error(`incomplete context for SET: ${JSON.stringify(merged)}`);
  return { kind: merged.kind, orientation, tile: merged.tile ?? 'any', notSliding: merged.notSliding ?? false, set: [] };
}

function offset(expression: string): [number, number] {
  const terms = expression.replace(/\s+/g, '').match(/[+-][^+-]+/g) ?? [];
  let dx = 0;
  let dy = 0;
  for (const t of terms) {
    const sign = t.startsWith('-') ? -1 : 1;
    const body = t.slice(1);
    if (body === 'WORLD_COLS') dy += sign;
    else if (/^\d+$/.test(body)) dx += sign * Number(body);
    else throw new Error(`bad offset term ${t} in ${expression}`);
  }
  return [dx, dy];
}

function direction(name: string): number {
  const d = DIRECTIONS.indexOf(name);
  if (d < 0) throw new Error(`unknown direction ${name}`);
  return d;
}

function cost(name: string): number {
  const v = travelCosts.get(name);
  if (v === undefined) throw new Error(`unknown travel cost ${name}`);
  return v;
}

function emit(dx: number, dy: number, dir: number, value: number): void {
  const ctx = context();
  const last = rules.at(-1);
  if (
    last &&
    last.kind === ctx.kind &&
    last.orientation === ctx.orientation &&
    last.tile === ctx.tile &&
    last.notSliding === ctx.notSliding
  ) {
    last.set.push([dx, dy, dir, value]);
    return;
  }
  ctx.set.push([dx, dy, dir, value]);
  rules.push(ctx);
}

function conditionOf(line: string): Condition | null {
  const body = line.replace(/^(else\s+)?if\s*/, '');
  if (/STRUCTURE_DDOOR_LEFT\)$/.test(body)) return { kind: 'DDOOR_LEFT' };
  if (/STRUCTURE_DDOOR_RIGHT\)$/.test(body)) return { kind: 'DDOOR_RIGHT' };
  if (/STRUCTURE_GARAGEDOOR\)$/.test(body)) return { kind: 'GARAGEDOOR' };
  if (/ubWallOrientation & ORIENT_LEFT\)$/.test(body)) return { orientation: 'LEFT' };
  if (/ubWallOrientation & ORIENT_RIGHT\)$/.test(body)) return { orientation: 'RIGHT' };
  if (/STRUCTURE_BASE_TILE\)$/.test(body)) return { tile: 'base' };
  if (/^\(!\(pStructure->fFlags & STRUCTURE_SLIDINGDOOR\)\)$/.test(body)) {
    return line.startsWith('else') ? { tile: 'nonBase', notSliding: true } : { notSliding: true };
  }
  return null;
}

function elseOf(previous: Condition | null): Condition {
  if (previous?.kind) return { kind: 'STANDARD' };
  if (previous?.tile === 'base') return { tile: 'nonBase' };
  throw new Error(`unsupported else after ${JSON.stringify(previous)}`);
}

for (const raw of lines) {
  const line = raw.replace(/\s*\{$/, '');
  const opensBlock = raw.endsWith('{') && raw !== '{';
  const setHere = line.match(/^SET_CURRMOVEMENTCOST\s*\(\s*(\w+)\s*,\s*(\w+)\s*\);?$/);
  const setNeighbour = line.match(/^SET_MOVEMENTCOST\s*\(\s*usGridNo([^,]*),\s*(\w+)\s*,\s*0\s*,\s*(\w+)\s*\);?$/);
  const caseLabel = line.match(/^case\s+ORIENT_(\w+):$/);
  if (raw === '{') {
    stack.push(pending ?? {});
    pending = null;
  } else if (raw === '}') {
    lastClosed = stack.pop() ?? null;
    if (lastClosed?.isSwitch) caseOrientation = null;
  } else if (setHere) {
    emit(0, 0, direction(setHere[1] as string), cost(setHere[2] as string));
  } else if (setNeighbour) {
    const [dx, dy] = offset(setNeighbour[1] as string);
    emit(dx, dy, direction(setNeighbour[2] as string), cost(setNeighbour[3] as string));
  } else if (caseLabel) {
    caseOrientation = caseLabel[1] as string;
  } else if (/^switch\s*\(\s*pStructure->ubWallOrientation\s*\)$/.test(line)) {
    pending = { isSwitch: true };
  } else if (line === 'default:' || line === 'break;') {
    if (line === 'default:') caseOrientation = null;
  } else if (line === 'else') {
    pending = elseOf(lastClosed);
  } else if (/^(else\s+)?if\s*\(/.test(line)) {
    const c = conditionOf(line);
    if (!c) throw new Error(`unsupported condition: ${line}`);
    pending = c;
  } else {
    throw new Error(`unsupported line: ${raw}`);
  }
  if (opensBlock) {
    stack.push(pending ?? {});
    pending = null;
  }
}

const out = {
  source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: src/game/TileEngine/WorldDef.cc CompileTileMovementCosts (ANYDOOR branch), src/game/Tactical/PathAI.h`,
  license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
  format:
    'rules apply in order to a door structure matching kind, orientation, tile and sliding; set = [dx, dy, direction, cost] raised with SET semantics',
  travelCosts: Object.fromEntries(travelCosts),
  rules,
};
const target = join(REPO_ROOT, 'data/tables/door-costs.json');
writeTable(target, out);
console.log(`${rules.length} door rules, ${rules.reduce((n, r) => n + r.set.length, 0)} entries → ${target}`);
