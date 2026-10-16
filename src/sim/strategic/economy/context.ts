import type { ItemTable } from '../../../content/items/items.ts';
import type { EconomyContent } from '../../../content/strategic/economy-content.ts';
import type { StrategicContext, TacticalWorldPort } from '../forces/ports.ts';
import { onSectorLiberated, onSectorTakenByEnemy, startTownLoyaltyIfFirstTime } from './loyalty.ts';
import {
  type CrewPort,
  defaultEconomyHooks,
  deferringDecisions,
  type EconomyContext,
  type EconomyDecisions,
  type EconomyHooks,
  type PeriodicSlots,
} from './ports.ts';
import { buildTownSectors } from './towns.ts';

export interface EconomySetup {
  readonly economy: EconomyContent;
  readonly items: ItemTable;
  readonly crew: CrewPort;
  readonly hooks?: Partial<EconomyHooks>;
  readonly decisions?: EconomyDecisions;
  readonly slots?: PeriodicSlots;
}

export function createEconomyContext(strategic: StrategicContext, setup: EconomySetup): EconomyContext {
  return {
    ...strategic,
    mercs: setup.crew,
    crew: setup.crew,
    economy: setup.economy,
    items: setup.items,
    hooks: { ...defaultEconomyHooks, ...setup.hooks },
    decisions: setup.decisions ?? deferringDecisions,
    slots: setup.slots ?? {},
    townSectors: buildTownSectors(strategic.content.towns),
    events: [],
  };
}

export function economyWorldPort(base: TacticalWorldPort, economy: () => EconomyContext | null): TacticalWorldPort {
  return {
    ...base,
    startTownLoyalty: (town) => {
      base.startTownLoyalty(town);
      const ctx = economy();
      if (ctx) startTownLoyaltyIfFirstTime(ctx, town);
    },
    sectorLiberated: (event) => {
      base.sectorLiberated(event);
      const ctx = economy();
      if (ctx) onSectorLiberated(ctx, event);
    },
    sectorTakenByEnemy: (sector, wasPlayerControlled) => {
      base.sectorTakenByEnemy(sector, wasPlayerControlled);
      const ctx = economy();
      if (ctx) onSectorTakenByEnemy(ctx, sector, wasPlayerControlled);
    },
  };
}
