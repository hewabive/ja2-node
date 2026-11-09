import { animName } from './anim-states.ts';
import type { Soldier } from './soldier.ts';
import type { TacticalState } from './state.ts';

export interface CampaignReach {
  readonly soldier: number;
  readonly name: string;
  readonly animation: string;
  readonly code: number;
  readonly hook: string;
}

type RestartingSoldier = Omit<CampaignReach, 'hook'>;

type RestartOf = (s: Soldier) => void;

const HELICOPTER_SEAT = 'sectorHooks.helicopterSeat';
const IN_MEANWHILE = 'narrative.inMeanwhile';

export function queriesTheRestartMayAsk(meanwhileDueAtTheSavedSecond: boolean): ReadonlySet<string> {
  return new Set(meanwhileDueAtTheSavedSecond ? [HELICOPTER_SEAT] : [HELICOPTER_SEAT, IN_MEANWHILE]);
}

function recording<T extends object>(seam: string, hooks: T, asked: ReadonlySet<string>, record: (hook: string) => void): T {
  return new Proxy(hooks, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      if (typeof value !== 'function' || typeof key !== 'string') return value;
      const hook = `${seam}.${key}`;
      if (asked.has(hook)) return value;
      return (...args: unknown[]) => {
        record(hook);
        return Reflect.apply(value, target, args);
      };
    },
  });
}

export function firstCampaignReach(
  t: TacticalState,
  asked: ReadonlySet<string>,
  restartAll: (restarting: RestartOf) => void,
): CampaignReach | null {
  let restarting: RestartingSoldier | null = null;
  let reach: CampaignReach | null = null;
  const record = (hook: string) => {
    if (!reach && restarting) reach = { ...restarting, hook };
  };
  const { narrative, sectorHooks, experienceHooks } = t;
  t.narrative = recording('narrative', narrative, asked, record);
  t.sectorHooks = recording('sectorHooks', sectorHooks, asked, record);
  t.experienceHooks = recording('experienceHooks', experienceHooks, asked, record);
  try {
    restartAll((s) => {
      restarting = { soldier: s.id, name: s.name, animation: animName(t.content, s.state), code: s.pc };
    });
  } finally {
    t.narrative = narrative;
    t.sectorHooks = sectorHooks;
    t.experienceHooks = experienceHooks;
  }
  return reach;
}

export function campaignReachRefusal(reach: CampaignReach | null): string | null {
  if (!reach) return null;
  const who = reach.name ? `soldier ${reach.soldier} (${reach.name})` : `soldier ${reach.soldier}`;
  return `the restart of ${who}, saved in ${reach.animation} at code ${reach.code}, reaches the campaign through ${reach.hook}`;
}
