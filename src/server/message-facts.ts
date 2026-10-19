import { NO_PROFILE, type Soldier } from '../sim/tactical/soldier.ts';
import type { TacticalSim } from '../sim/tactical/tactical-sim.ts';
import type { MessageFacts } from './message-entries.ts';

export type { MessageFacts } from './message-entries.ts';

export function tacticalMessageFacts(sim: TacticalSim | null, soldierOf: (id: number) => Soldier | null): MessageFacts {
  const content = sim?.state.content ?? null;
  return {
    soldierName: (id) => soldierOf(id)?.name ?? null,
    soldierTeam: (id) => soldierOf(id)?.team ?? null,
    soldierProfile: (id) => {
      const profile = soldierOf(id)?.profile;
      return profile === undefined || profile === NO_PROFILE ? null : profile;
    },
    soldierVisible: (id) => (soldierOf(id)?.visible ?? -1) !== -1,
    profileName: (profile) => content?.profiles[profile]?.nickname ?? null,
    itemIndex: (name) => content?.items.byName.get(name)?.index ?? null,
  };
}
