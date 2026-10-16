import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ItemTable, loadItemTable } from '../../src/content/items/items.ts';
import { loadMerchantContent, type MerchantContent } from '../../src/content/strategic/merchant-content.ts';
import {
  createMerchantContext,
  type MerchantContext,
  type MerchantHooks,
  type ShopHours,
} from '../../src/sim/strategic/economy/merchants/context.ts';
import { createMerchantState } from '../../src/sim/strategic/economy/merchants/state.ts';
import type { RollSource } from '../../src/sim/strategic/forces/ports.ts';
import { QueuedRolls, RecordingRolls } from './queen.ts';

const DATA_DIR = join(import.meta.dirname, '../../data');

export interface MerchantTestContent {
  readonly items: ItemTable;
  readonly content: MerchantContent;
}

const readData = async (path: string) => new Uint8Array(readFileSync(join(DATA_DIR, path)));

export async function loadMerchantTestContent(): Promise<MerchantTestContent> {
  const items = await loadItemTable(async (path) => JSON.parse(readFileSync(join(DATA_DIR, path), 'utf8')));
  const content = await loadMerchantContent(readData, items);
  return { items, content };
}

export interface MerchantWorldOptions {
  gunNut: boolean;
  progress: number;
  day: number;
  minutes: number;
}

export interface MerchantFixture {
  readonly ctx: MerchantContext;
  readonly world: MerchantWorldOptions;
  readonly facts: Set<number>;
  readonly setFacts: number[];
  hours: ShopHours | null;
}

export interface MerchantFixtureOptions {
  readonly random?: RollSource;
  readonly preRandom?: RollSource;
  readonly world?: Partial<MerchantWorldOptions>;
  readonly hooks?: Partial<MerchantHooks>;
}

export function merchantFixture(t: MerchantTestContent, options: MerchantFixtureOptions = {}): MerchantFixture {
  const world: MerchantWorldOptions = { gunNut: false, progress: 0, day: 1, minutes: 1500, ...options.world };
  const facts = new Set<number>();
  const setFacts: number[] = [];
  const fixture: MerchantFixture = {
    ctx: null as unknown as MerchantContext,
    world,
    facts,
    setFacts,
    hours: null,
  };
  const ctx = createMerchantContext(
    {
      content: t.content,
      items: t.items,
      hooks: {
        fact: (id) => facts.has(id),
        setFact: (id) => {
          setFacts.push(id);
          facts.add(id);
        },
        shopHours: () => fixture.hours,
        ...options.hooks,
      },
    },
    createMerchantState(),
    { random: options.random ?? RecordingRolls.zeros(), preRandom: options.preRandom ?? RecordingRolls.zeros() },
    {
      gunNut: () => world.gunNut,
      highestProgress: () => world.progress,
      worldDay: () => world.day,
      worldMinutes: () => world.minutes,
    },
  );
  Object.assign(fixture, { ctx });
  return fixture;
}

export function queued(...values: number[]): QueuedRolls {
  return new QueuedRolls().push(...values);
}

export function itemId(t: MerchantTestContent, name: string): number {
  const def = t.items.byName.get(name);
  if (!def) throw new Error(`unknown item ${name}`);
  return def.index;
}
