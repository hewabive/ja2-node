import { expect } from 'vitest';
import type { TacticalWorld } from '../../src/content/world/tactical-world.ts';
import type { CommandEnvelope } from '../../src/protocol/messages.ts';
import { advance as advanceSim, type Steppable, type StopCondition, type StopReport } from '../../src/sim/advance.ts';
import type { CommandResult } from '../../src/sim/command.ts';
import type { SimEvent } from '../../src/sim/events.ts';

export type RunMode = 'plain' | 'reload';

export const RUN_MODES: readonly RunMode[] = ['plain', 'reload'];

const RELOAD_ENV = 'JA2_RELOAD';

const DIFFERENCE_CONTEXT = 300;

export function defaultRunMode(): RunMode | null {
  return process.env[RELOAD_ENV] === '1' ? 'reload' : null;
}

export function worldContentOnce(build: (mapPath: string) => TacticalWorld): (mapPath: string) => TacticalWorld {
  const built = new Map<string, TacticalWorld>();
  return (mapPath) => {
    let world = built.get(mapPath);
    if (!world) {
      world = build(mapPath);
      built.set(mapPath, world);
    }
    return world;
  };
}

export interface Drivable extends Steppable {
  dispatch(cmd: CommandEnvelope): CommandResult;
}

export interface ReloadAdapter<T> {
  snapshot(sim: T): unknown;
  restore(snapshot: unknown, previous: T): T;
  drainBeforeReload(sim: T): boolean;
}

interface Driver<T extends Drivable> {
  current: T;
  readonly mode: RunMode;
  readonly adapter: ReloadAdapter<T>;
  readonly pending: SimEvent[];
  readonly log: string[];
  stepped: boolean;
  reloads: number;
}

const drivers = new WeakMap<object, Driver<Drivable>>();

export function firstDifference(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(a.lastIndexOf('\n', i) + 1, i - DIFFERENCE_CONTEXT);
  const end = (text: string) => {
    const newline = text.indexOf('\n', i);
    return Math.min(newline < 0 ? text.length : newline, i + DIFFERENCE_CONTEXT);
  };
  return `at ${i}:\n  ${a.slice(from, end(a))}\n  ${b.slice(from, end(b))}`;
}

function reload<T extends Drivable>(d: Driver<T>): void {
  if (d.mode !== 'reload') return;
  if (d.adapter.drainBeforeReload(d.current)) d.pending.push(...d.current.drainEvents());
  const json = JSON.stringify(d.adapter.snapshot(d.current));
  const next = d.adapter.restore(JSON.parse(json), d.current);
  const again = JSON.stringify(d.adapter.snapshot(next));
  if (again !== json) throw new Error(`restoring changed the snapshot ${firstDifference(json, again)}`);
  d.current = next;
  d.stepped = false;
  d.reloads++;
}

function driverOf(sim: object): Driver<Drivable> {
  const d = drivers.get(sim);
  if (!d) throw new Error('not a driven sim');
  return d;
}

export function driven<T extends Drivable>(sim: T, adapter: ReloadAdapter<T>, mode: RunMode): T {
  const d: Driver<T> = { current: sim, mode, adapter, pending: [], log: [], stepped: false, reloads: 0 };
  const dispatch = (cmd: CommandEnvelope): CommandResult => {
    if (d.stepped) reload(d);
    const result = d.current.dispatch(cmd);
    d.log.push(JSON.stringify({ dispatch: cmd, result }));
    if (result.ok) reload(d);
    return result;
  };
  const step = (): void => {
    d.current.step();
    d.stepped = true;
  };
  const drainEvents = (): SimEvent[] => {
    const events = [...d.pending.splice(0), ...d.current.drainEvents()];
    if (events.length > 0) d.log.push(JSON.stringify({ events }));
    return events;
  };
  const own: Readonly<Record<string, unknown>> = { dispatch, step, drainEvents };
  const proxy = new Proxy(sim, {
    get(_target, prop) {
      if (typeof prop === 'string' && prop in own) return own[prop];
      const value = Reflect.get(d.current, prop, d.current);
      return typeof value === 'function' ? value.bind(d.current) : value;
    },
    set(_target, prop, value) {
      return Reflect.set(d.current, prop, value, d.current);
    },
    has(_target, prop) {
      return Reflect.has(d.current, prop);
    },
  });
  drivers.set(proxy, d as unknown as Driver<Drivable>);
  return proxy;
}

export function follow<T extends object>(sim: object, pick: (current: never) => T): T {
  const d = driverOf(sim);
  const target = pick(d.current as never);
  return new Proxy(target, {
    get(_target, prop) {
      const current = pick(d.current as never);
      const value = Reflect.get(current, prop, current);
      return typeof value === 'function' ? value.bind(current) : value;
    },
  });
}

export function isDriven(sim: object): boolean {
  return drivers.has(sim);
}

export function reloadPoint(sim: object): void {
  const d = drivers.get(sim);
  if (d) reload(d);
}

export function advance(sim: Steppable, until: StopCondition, budget?: number): StopReport {
  const report = advanceSim(sim, until, budget);
  reloadPoint(sim);
  return report;
}

export function currentSim<T extends Drivable>(sim: T): T {
  return driverOf(sim).current as T;
}

export function reloadCount(sim: object): number {
  return driverOf(sim).reloads;
}

export function transcript(sim: object): string {
  return driverOf(sim).log.join('\n');
}

export function finalSnapshot(sim: object): string {
  const d = driverOf(sim);
  return JSON.stringify(d.adapter.snapshot(d.current));
}

function expectSameText(actual: string, expected: string, what: string): void {
  if (actual !== expected) expect.fail(`the ${what} differs from the uninterrupted run ${firstDifference(expected, actual)}`);
}

export function expectSameRun(plain: object, reloaded: object): void {
  expect(reloadCount(plain)).toBe(0);
  expect(reloadCount(reloaded)).toBeGreaterThan(0);
  expectSameText(transcript(reloaded), transcript(plain), 'event log');
  expectSameText(finalSnapshot(reloaded), finalSnapshot(plain), 'final snapshot');
}

export async function expectReloadsInvisible(scenario: (mode: RunMode) => object | Promise<object>): Promise<void> {
  const plain = await scenario('plain');
  const reloaded = await scenario('reload');
  expectSameRun(plain, reloaded);
}
